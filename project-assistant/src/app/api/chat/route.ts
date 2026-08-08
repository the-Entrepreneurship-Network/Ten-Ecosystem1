import { NextRequest } from "next/server";
import { TEN_SYSTEM_PROMPT } from "@/lib/system-prompt";
import { answerFor } from "@/lib/answers";
import type { ChatRequest } from "@/lib/types";

/**
 * Chat endpoint.
 *
 * Streams plain UTF-8 text. Not SSE, not a framed protocol: the client only
 * ever needs "append these characters", so anything more is protocol for its
 * own sake. The Anthropic SSE frames are unwrapped here and the text deltas are
 * forwarded straight through.
 *
 * With no API key configured the route composes replies locally instead of
 * failing, so the interface is demonstrable before anyone provisions a key.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const MAX_TOKENS = 4096;
const MAX_TURNS = 24;
const MAX_CHARS = 12_000;

function textStream(body: string, chunk = 18, delayMs = 12) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= body.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(body.slice(i, i + chunk)));
      i += chunk;
      await new Promise((r) => setTimeout(r, delayMs));
    },
  });
}

export async function POST(req: NextRequest) {
  let payload: ChatRequest;
  try {
    payload = await req.json();
  } catch {
    return new Response("Could not read that request.", { status: 400 });
  }

  // Validate the shape before touching it. Only `req.json()` was guarded, so a
  // body of `null` or `{"messages":"hi"}` threw a 500 whose stack the client
  // rendered straight into the transcript.
  if (!Array.isArray(payload?.messages)) {
    return new Response("Could not read that request.", { status: 400 });
  }
  if (payload.messages.length > 500) {
    return new Response("That conversation is too long to send.", { status: 413 });
  }

  const messages = payload.messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content.slice(0, MAX_CHARS),
    }));

  if (messages.length === 0) {
    return new Response("Send at least one message.", { status: 400 });
  }

  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const last = messages[messages.length - 1].content;
    return new Response(textStream(answerFor(last)), {
      headers: { ...headers, "X-TEN-Mode": "local" },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: TEN_SYSTEM_PROMPT,
        messages,
        stream: true,
      }),
    });
  } catch {
    return new Response(
      "The assistant could not be reached. Check your connection and try again.",
      { status: 502, headers },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    const known: Record<number, string> = {
      401: "The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.",
      429: "Rate limit reached. Wait a moment and send that again.",
      529: "The model is overloaded right now. Try again shortly.",
    };
    return new Response(
      known[upstream.status] ??
        `The assistant failed to respond (${upstream.status}). ${detail.slice(0, 300)}`,
      { status: upstream.status, headers },
    );
  }

  // Unwrap the SSE frames and forward only the text deltas.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstream.body.getReader();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            controller.enqueue(encoder.encode(evt.delta.text));
          } else if (evt.type === "error") {
            controller.enqueue(
              encoder.encode(`\n\n**The reply stopped early.** ${evt.error?.message ?? ""}`),
            );
          }
        } catch {
          /* A partial frame. The next chunk completes it. */
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, { headers: { ...headers, "X-TEN-Mode": "live" } });
}
