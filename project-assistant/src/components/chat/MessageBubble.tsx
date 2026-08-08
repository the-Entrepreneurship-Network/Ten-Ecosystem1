"use client";

/**
 * One turn.
 *
 * The student's own words get the gold: a warm foil-edged surface, right
 * aligned, deliberately narrower than the reply. The assistant's answer is a
 * full-width reading column with no bubble around it, because a long structured
 * answer inside a chat bubble is a worse document than the same answer set as
 * text. The gold hairline on the left is what marks it as the assistant's.
 */

import { useState } from "react";
import { motion, type Variants } from "motion/react";
import { Markdown } from "./Markdown";
import { InfinityMark } from "@/components/brand/InfinityMark";
import { Alert, Check, Copy, Retry } from "@/components/ui/icons";
import { EASE } from "@/lib/motion";
import type { Message } from "@/lib/types";

const enter: Variants = {
  hidden: (mine: boolean) => ({ opacity: 0, y: 12, x: mine ? 10 : -6 }),
  shown: {
    opacity: 1,
    y: 0,
    x: 0,
    transition: { duration: 0.34, ease: EASE.luxe },
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* Clipboard denied. The button simply does not confirm. */
        }
      }}
      aria-label={copied ? "Answer copied" : "Copy answer"}
      className="pressable rounded-inline p-1.5 text-faint hover:bg-white/5 hover:text-gold"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}

export function MessageBubble({
  message,
  streaming,
  onRetry,
}: {
  message: Message;
  streaming?: boolean;
  onRetry?: () => void;
}) {
  const mine = message.role === "user";

  if (message.error) {
    return (
      <motion.div
        custom={false}
        variants={enter}
        initial="hidden"
        animate="shown"
        role="alert"
        className="flex items-start gap-3 rounded-shell border border-gold/25 bg-gold/[0.05] px-4 py-3"
      >
        <Alert className="mt-0.5 size-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-bone">{message.error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="pressable mt-2 inline-flex items-center gap-1.5 rounded-pill border border-gold/30 px-3 py-1 text-xs font-medium text-gold hover:bg-gold/10"
            >
              <Retry className="size-3.5" />
              Try again
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  if (mine) {
    return (
      <motion.div
        custom
        variants={enter}
        initial="hidden"
        animate="shown"
        className="flex justify-end"
      >
        <div className="max-w-[min(38rem,88%)] rounded-shell rounded-br-[6px] border border-gold/30 bg-gradient-to-br from-gold/[0.16] to-gold/[0.06] px-4 py-3 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap text-bone shadow-[inset_0_1px_0_rgba(245,215,110,0.16),0_1px_2px_rgba(0,0,0,0.5)]">
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div custom={false} variants={enter} initial="hidden" animate="shown">
      <div className="mb-2 flex items-center gap-2">
        <InfinityMark className="h-4 w-8" breathe={false} />
        <span className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-faint">
          Project Assistant
        </span>
        {!streaming && message.content.length > 0 && (
          <span className="ml-auto">
            <CopyButton text={message.content} />
          </span>
        )}
      </div>

      <div className="border-l border-gold/20 pl-4 sm:pl-5">
        {message.content ? (
          <>
            <Markdown>{message.content}</Markdown>
            {streaming && <span className="caret" aria-hidden />}
          </>
        ) : (
          <span className="flex items-center gap-1.5 py-1">
            {/* Live regions announce their text content, and three decorative
                spans have none. Without this the reply arrives in silence. */}
            <span className="sr-only">Preparing a reply</span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden
                className="thinking-dot size-1.5 rounded-pill bg-gold"
                style={{ animationDelay: `${i * 140}ms` }}
              />
            ))}
          </span>
        )}
      </div>
    </motion.div>
  );
}
