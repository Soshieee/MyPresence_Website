"use client";

import { useEffect, useState } from "react";

const SCROLL_THRESHOLD = 300;

// Floating jump-to-top button, bottom-right on every app page. Appears only
// after the user has scrolled down so it never clutters the initial view.
export default function JumpToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SCROLL_THRESHOLD);

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-[#b9cac3] bg-[#2f4e44] text-white shadow-[0_10px_30px_rgba(22,36,31,0.35)] transition-colors hover:bg-[#385b4f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#385b4f] motion-safe:animate-[fadeIn_150ms_ease-out]"
      aria-label="Jump to Top"
      title="Jump to Top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12.5 3.5-3.5 3.5 3.5M12 9v6" />
      </svg>
    </button>
  );
}
