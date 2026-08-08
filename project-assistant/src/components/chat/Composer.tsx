"use client";

/**
 * The composer.
 *
 * Deliberately the most solid object on the page: it is the one control a
 * student touches every single turn. Auto-growing to eight lines, then it
 * scrolls, so a long pasted brief never pushes the send control off screen.
 *
 * Enter sends, Shift+Enter breaks the line. On coarse pointers Enter always
 * breaks the line, because on a phone keyboard the return key is how people
 * write paragraphs and a message sent by accident is worse than an extra tap.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Stop } from "@/components/ui/icons";
import { ASSISTANT_TAGLINE } from "@/lib/system-prompt";

const MAX_ROWS_PX = 200;

export function Composer({
  onSend,
  onStop,
  busy,
  seed,
  onSeedConsumed,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  /** A prompt handed over from a quick start entry, ready to edit or send. */
  seed?: string | null;
  onSeedConsumed: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  };

  useEffect(resize, [value]);

  useEffect(() => {
    if (!seed) return;
    // Never overwrite work in progress. A student who has typed half a question
    // and then taps a track to see the wording would lose the lot, and a
    // programmatic replace is not undoable in a controlled textarea.
    if (ref.current?.value.trim()) {
      onSeedConsumed();
      ref.current?.focus();
      return;
    }
    setValue(seed);
    onSeedConsumed();
    const el = ref.current;
    if (el) {
      el.focus();
      // Caret at the end so a prompt ending in "here it is: " is ready to type into.
      requestAnimationFrame(() => el.setSelectionRange(seed.length, seed.length));
    }
  }, [seed, onSeedConsumed]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  };

  const coarse =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative"
    >
      <div className="surface flex items-end gap-2 rounded-shell p-2 pl-4 transition-colors duration-200 focus-within:border-gold/35">
        <label htmlFor="ten-composer" className="sr-only">
          Message the TEN Project Assistant
        </label>
        <textarea
          id="ten-composer"
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !coarse) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe your task, paste your brief, or ask what to do next"
          aria-describedby="ten-composer-hint"
          className="max-h-[200px] flex-1 resize-none bg-transparent py-2.5 text-[0.9375rem] leading-relaxed text-bone outline-none placeholder:text-muted"
        />

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="pressable mb-0.5 grid size-10 shrink-0 place-items-center rounded-field border border-gold/30 text-gold hover:bg-gold/10"
          >
            <Stop className="size-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send message"
            className="foil pressable mb-0.5 grid size-10 shrink-0 place-items-center rounded-field disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
          >
            <ArrowUp className="size-[18px]" />
          </button>
        )}
      </div>

      <p
        id="ten-composer-hint"
        className="mt-2 px-1 text-center text-[0.7rem] leading-relaxed text-faint"
      >
        {ASSISTANT_TAGLINE}
      </p>
    </form>
  );
}
