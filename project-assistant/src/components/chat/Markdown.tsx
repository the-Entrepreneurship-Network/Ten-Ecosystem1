"use client";

/**
 * The reading surface.
 *
 * The assistant answers in structured markdown, so this is where most of a
 * student's time is actually spent. Styling lives in `.prose-ten` in globals
 * rather than in per-element classes here, so the type scale stays in one file.
 *
 * Raw HTML is not enabled. react-markdown ignores it by default and that is the
 * correct posture for model output rendered into the page.
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-ten">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="-mx-1 overflow-x-auto px-1">
              <table>{children}</table>
            </div>
          ),
          // `list-style: none` strips the list role in Safari with VoiceOver,
          // and the bullets here are drawn with a pseudo-element. The explicit
          // role puts "list, N items" back.
          ul: ({ children }) => <ul role="list">{children}</ul>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
