"use client";

/**
 * The rail.
 *
 * Persistent on wide screens, a drawer below `lg`. It exists for one job: get a
 * student who knows their track into a useful first question in a single click,
 * without making them describe themselves in prose.
 *
 * The drawer traps focus and restores it on close, because a panel you can Tab
 * out of into hidden content behind the scrim is worse than no panel.
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { InfinityMark } from "@/components/brand/InfinityMark";
import { Close, Plus } from "@/components/ui/icons";
import { EASE } from "@/lib/motion";
import { TRACK_GROUPS } from "@/lib/tracks";

function RailBody({
  onPick,
  onNewSession,
  live,
  canReset,
}: {
  onPick: (prompt: string) => void;
  onNewSession: () => void;
  live: boolean | null;
  canReset: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <InfinityMark className="h-6 w-12" />
        <span className="flex flex-col leading-none">
          <span className="text-[0.95rem] font-bold tracking-[0.26em] text-gold">
            TEN
          </span>
          <span className="mt-1 text-[0.58rem] font-medium uppercase tracking-[0.15em] text-faint">
            The Entrepreneurship Network
          </span>
        </span>
      </div>

      <div className="px-4">
        <button
          type="button"
          onClick={onNewSession}
          disabled={!canReset}
          className="pressable flex w-full items-center gap-2 rounded-field border border-gold/20 bg-white/[0.02] px-3 py-2.5 text-sm font-medium text-bone hover:border-gold/40 hover:bg-gold/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-4 text-gold" />
          New session
        </button>
      </div>

      <nav
        aria-label="Internship tracks"
        className="mt-6 min-h-0 flex-1 overflow-y-auto px-4 pb-4"
      >
        {TRACK_GROUPS.map((group) => (
          <div key={group.label} className="mb-5">
            <h2 className="px-1 pb-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-faint">
              {group.label}
            </h2>
            <ul className="flex flex-col">
              {group.tracks.map((t) => (
                <li key={t.name}>
                  <button
                    type="button"
                    onClick={() => onPick(t.prompt)}
                    className="pressable w-full rounded-inline px-1.5 py-[7px] text-left text-[0.85rem] text-muted hover:bg-white/[0.04] hover:text-gold-lift"
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-edge px-5 py-4">
        <p className="text-[0.72rem] leading-relaxed text-faint">
          {live === null
            ? "Loading."
            : live
              ? "Connected to a live model."
              : "Answers are composed from TEN’s published programme data. No model runs here, so nothing is invented, and questions outside the programme cannot be answered."}
        </p>
      </div>
    </div>
  );
}

export function TrackRail(props: {
  onPick: (prompt: string) => void;
  onNewSession: () => void;
  live: boolean | null;
  canReset: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const { drawerOpen, onCloseDrawer } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // Read through a ref so the effect below keys only on `drawerOpen`. Keying it
  // on the callback too would re-run the trap on every parent render, which
  // during a stream means stealing focus back to the close button 16 times a
  // second and overwriting the element focus should return to.
  const closeRef = useRef(onCloseDrawer);
  closeRef.current = onCloseDrawer;

  useEffect(() => {
    if (!drawerOpen) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus?.();
    };
  }, [drawerOpen]);

  return (
    <>
      <aside className="hidden w-[17.5rem] shrink-0 border-r border-edge bg-ink/40 lg:block">
        <RailBody {...props} />
      </aside>

      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              type="button"
              aria-label="Close menu"
              onClick={onCloseDrawer}
              className="absolute inset-0 bg-black/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Internship tracks"
              initial={{ transform: "translateX(-100%)" }}
              animate={{ transform: "translateX(0%)" }}
              exit={{ transform: "translateX(-100%)" }}
              transition={{ duration: 0.28, ease: EASE.luxe }}
              className="absolute inset-y-0 left-0 w-[17.5rem] max-w-[86vw] border-r border-edge bg-ink"
            >
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Close menu"
                className="pressable absolute top-4 right-3 rounded-inline p-2 text-faint hover:text-bone"
              >
                <Close className="size-4" />
              </button>
              <RailBody {...props} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
