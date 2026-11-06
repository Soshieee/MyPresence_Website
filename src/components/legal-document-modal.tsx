"use client";

import { useRef, useState } from "react";
import type { LegalSection } from "@/lib/legal-content";

type LegalDocumentModalProps = {
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
  onClose: () => void;
  /** Fired once the reader has reached the end of the document. */
  onReachedEnd: () => void;
};

const END_THRESHOLD_PX = 48;

// In-page reader for the Terms and Conditions / Privacy Notice. Registration
// requires opening and scrolling each document to the end before the consent
// checkbox unlocks, so agreement is an explicit, informed action.
export default function LegalDocumentModal({
  title,
  lastUpdated,
  sections,
  onClose,
  onReachedEnd
}: LegalDocumentModalProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const markedRef = useRef(false);
  const [reachedEnd, setReachedEnd] = useState(false);

  const markReachedEnd = () => {
    if (markedRef.current) return;
    markedRef.current = true;
    setReachedEnd(true);
    onReachedEnd();
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - END_THRESHOLD_PX) {
      markReachedEnd();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#16241f]/70 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#c3d0cb] bg-[#f8fbfa] shadow-[0_24px_80px_rgba(22,36,31,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#d6e1dd] bg-gradient-to-br from-[#e9f3ef] to-[#f8fbfa] px-5 py-4">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">{title}</h2>
            <p className="mt-0.5 text-xs text-[#5d7269]">Last updated {lastUpdated}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full border border-[#b9cac3] bg-white/80 px-3 py-1 text-xs font-semibold text-[#35564a] hover:bg-white"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div
          ref={(element) => {
            scrollRef.current = element;
            // Short documents that fit without scrolling count as read.
            if (element && element.scrollHeight <= element.clientHeight + END_THRESHOLD_PX) {
              markReachedEnd();
            }
          }}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          onScroll={handleScroll}
        >
          {sections.map((section) => (
            <section key={section.id} className="mt-4 first:mt-0">
              <h3 className="font-[var(--font-heading)] text-base text-[#23332d]">{section.title}</h3>
              {section.paragraphs?.map((paragraph, index) => (
                <p key={index} className="mt-2 text-sm leading-6 text-[#425b52]">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[#425b52]">
                  {section.bullets.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {section.content?.map((block, index) =>
                block.type === "paragraph" ? (
                  <p key={index} className="mt-2 text-sm leading-6 text-[#425b52]">
                    {block.text}
                  </p>
                ) : (
                  <ul key={index} className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[#425b52]">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>{item}</li>
                    ))}
                  </ul>
                )
              )}
            </section>
          ))}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#d6e1dd] bg-[#eef4f1] px-5 py-3">
          <p className={`text-xs font-semibold ${reachedEnd ? "text-[#315349]" : "text-[#7a5a17]"}`}>
            {reachedEnd ? "✓ End of document reached." : "Scroll to the end of the document, then close."}
          </p>
          <button
            type="button"
            className={reachedEnd ? "btn-primary px-4 py-1.5 text-xs" : "btn-ghost px-4 py-1.5 text-xs"}
            onClick={onClose}
          >
            {reachedEnd ? "Done reading" : "Close"}
          </button>
        </footer>
      </div>
    </div>
  );
}
