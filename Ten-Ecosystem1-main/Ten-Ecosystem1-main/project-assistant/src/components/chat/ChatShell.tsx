"use client";

/**
 * The workspace.
 *
 * Owns the transcript, the stream, and the scroll. Three details here matter
 * more than they look:
 *
 *   Throttled paint. Tokens arrive faster than markdown can usefully re-parse.
 *   They are accumulated in a ref and flushed on a 60ms cadence, so a long
 *   answer costs a bounded number of renders instead of one per token.
 *
 *   Honest autoscroll. The view follows the stream only while the student is
 *   already at the bottom. Scroll up to re-read something and the page stays
 *   where you put it, which is the whole reason to scroll up.
 *
 *   Recoverable failures. A failed turn becomes an inline error with a retry,
 *   never a silent empty bubble and never a lost question.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { OpeningScreen } from "./OpeningScreen";
import { TrackRail } from "./TrackRail";
import { InfinityMark } from "@/components/brand/InfinityMark";
import { Menu } from "@/components/ui/icons";
import { newId, type Message } from "@/lib/types";

const FLUSH_MS = 60;

export function ChatShell() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  /**
   * The transcript is mirrored into a ref and every write goes through
   * `commit`. Sending needs to read the current transcript AND kick off a
   * request, and doing that inside a `setMessages` updater means starting the
   * request during the render phase: React then discards the placeholder the
   * request just enqueued, and the reply silently never appears.
   */
  const messagesRef = useRef<Message[]>([]);
  const commit = useCallback(
    (next: Message[] | ((prev: Message[]) => Message[])) => {
      const value = typeof next === "function" ? next(messagesRef.current) : next;
      messagesRef.current = value;
      setMessages(value);
    },
    [],
  );

  /* ----------------------------------------------------------- scrolling */

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const stickToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el || !pinned.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    stickToBottom();
  }, [messages, stickToBottom]);

  /* -------------------------------------------------------------- stream */

  const run = useCallback(
    async (history: Message[]) => {
      const replyId = newId("a");
      setStreamingId(replyId);
      setBusy(true);
      commit([...history, { id: replyId, role: "assistant", content: "" }]);

      const controller = new AbortController();
      abort.current = controller;

      let pending = "";
      let flushTimer: number | null = null;
      const flush = () => {
        flushTimer = null;
        if (!pending) return;
        const add = pending;
        pending = "";
        commit((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, content: m.content + add } : m)),
        );
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
          }),
        });

        // Only success paths carry the mode. Reading it off a 429 would pin the
        // rail to "offline" for the rest of a perfectly live session.
        const mode = res.headers.get("X-TEN-Mode");
        if (mode) setLive(mode === "live");

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `The assistant returned ${res.status}.`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (flushTimer === null) flushTimer = window.setTimeout(flush, FLUSH_MS);
        }
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        flush();
      } catch (err) {
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        flush();
        const aborted = err instanceof DOMException && err.name === "AbortError";
        // Either way an empty placeholder is dropped. Left in place it renders
        // the thinking dots forever, and it rides along in every later request
        // as a blank turn that the route then strips, silently rewriting the
        // conversation the model sees.
        commit((prev) => {
          const reply = prev.find((m) => m.id === replyId);
          const kept = reply?.content ? prev : prev.filter((m) => m.id !== replyId);
          if (aborted) return kept;
          const detail = err instanceof Error ? err.message : "Something went wrong.";
          return [
            ...kept,
            { id: newId("e"), role: "assistant", content: "", error: detail },
          ];
        });
      } finally {
        setStreamingId(null);
        abort.current = null;
        setBusy(false);
      }
    },
    [commit],
  );

  const send = useCallback(
    (text: string) => {
      pinned.current = true;
      const history = [
        ...messagesRef.current.filter((m) => !m.error),
        { id: newId("u"), role: "user" as const, content: text },
      ];
      commit(history);
      void run(history);
    },
    [commit, run],
  );

  const retry = useCallback(() => {
    const history = messagesRef.current.filter((m) => !m.error);
    if (history.length === 0) return;
    commit(history);
    void run(history);
  }, [commit, run]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const newSession = useCallback(() => {
    abort.current?.abort();
    commit([]);
    setDrawerOpen(false);
    pinned.current = true;
  }, [commit]);

  const pick = useCallback((prompt: string) => {
    setSeed(prompt);
    setDrawerOpen(false);
  }, []);

  // Stable identities. Passed to effects downstream, where a new function every
  // render re-runs the drawer's focus trap and the composer's seed effect on
  // every streamed token.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const clearSeed = useCallback(() => setSeed(null), []);

  useEffect(() => () => abort.current?.abort(), []);

  const empty = messages.length === 0;

  /* --------------------------------------------------------------- view */

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-void">
      <TrackRail
        onPick={pick}
        onNewSession={newSession}
        live={live}
        canReset={!empty}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 flex h-16 shrink-0 items-center gap-3 border-b border-edge px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open tracks menu"
            className="pressable -ml-1.5 rounded-inline p-2 text-muted hover:text-bone lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          <span className="flex items-center lg:hidden">
            <InfinityMark className="h-7 w-14" />
          </span>

          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-[0.95rem] font-semibold tracking-[-0.01em] text-bone">
              Project Assistant
            </span>
            <span className="mt-1 hidden truncate text-[0.68rem] text-faint sm:block">
              Built for TEN interns. Research depth, real deliverables, daily momentum.
            </span>
          </span>

        </header>

        <div
          ref={scroller}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto w-full max-w-[46rem] px-4 pt-6 pb-8 sm:px-6">
            {empty ? (
              <OpeningScreen onPick={pick} />
            ) : (
              <motion.div className="flex flex-col gap-7">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    streaming={busy && m.id === streamingId}
                    onRetry={m.error ? retry : undefined}
                  />
                ))}
              </motion.div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-edge bg-void/90 px-4 pt-3 pb-4 backdrop-blur-sm sm:px-6">
          <div className="mx-auto w-full max-w-[46rem]">
            <Composer
              onSend={send}
              onStop={stop}
              busy={busy}
              seed={seed}
              onSeedConsumed={clearSeed}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
