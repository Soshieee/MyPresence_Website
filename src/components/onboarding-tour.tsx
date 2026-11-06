"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ONBOARDING_RESTART_EVENT, ONBOARDING_STORAGE_KEY } from "@/lib/onboarding";

type TourStep = {
  title: string;
  description: string;
  hint: string;
  page?: string;
  target?: string;
};

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TooltipPosition = {
  top: number;
  left: number;
};

const tourSteps: TourStep[] = [
  {
    title: "Welcome to MyPresence",
    description:
      "MyPresence helps your church manage members, events, and attendance in one place. This short tour shows where the main tools live.",
    hint: "You can skip at any time. The tour can be restarted later from the Help Center."
  },
  {
    title: "Dashboard",
    description:
      "Home is the central overview. It summarizes attendance, upcoming events, and quick links so you can see what is happening at a glance.",
    hint: "Use the sidebar on desktop or the shortcut row on mobile to switch pages.",
    page: "/",
    target: "[data-tour='nav-home']"
  },
  {
    title: "Member Management",
    description:
      "The Members page is where you view and manage registered members, including their profile details, status, and attendance history.",
    hint: "Use the search and status filters to find a member quickly.",
    page: "/members",
    target: "[data-tour='members-overview']"
  },
  {
    title: "Attendance Scanning",
    description:
      "The Scan page records attendance. Choose the attendance type and date, then use the camera to check in members.",
    hint: "Camera access is required. The scanner compares a member's face with the enrolled face descriptor.",
    page: "/attendance",
    target: "[data-tour='attendance-scanner']"
  },
  {
    title: "Attendance Records",
    description:
      "Records shows attendance history and analytics. Filter by date, attendance type, event, or network to review and verify entries.",
    hint: "Use the date presets or a custom range to narrow the results.",
    page: "/records",
    target: "[data-tour='records-overview']"
  },
  {
    title: "Events",
    description:
      "Event Manager is where you create and update events, attach details, and review recent events and polls.",
    hint: "Events connect attendance records to the right service or gathering.",
    page: "/events-manager",
    target: "[data-tour='events-recent']"
  },
  {
    title: "You're all set",
    description:
      "You've seen the main parts of MyPresence. You can revisit any page from the sidebar or mobile shortcuts, and restart this walkthrough anytime from the Help Center.",
    hint: "Open Help whenever you need step-by-step guides or troubleshooting.",
    page: "/"
  }
];

const TARGET_PADDING = 8;
const VIEWPORT_MARGIN = 16;

function visibleElement(selector?: string) {
  if (!selector) return null;

  try {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    return candidates.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? null;
  } catch {
    return null;
  }
}

export default function OnboardingTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const markComplete = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    } catch {
      // The tour still closes if browser storage is unavailable.
    }
    setOpen(false);
    setStepIndex(0);
    setTargetRect(null);
    setTargetMissing(false);
    setTooltipPosition(null);
  }, []);

  useEffect(() => {
    let initialTimer = 0;

    try {
      if (!window.localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
        initialTimer = window.setTimeout(() => setOpen(true), 0);
      }
    } catch {
      initialTimer = window.setTimeout(() => setOpen(true), 0);
    }

    const restart = () => {
      setStepIndex(0);
      setTargetRect(null);
      setTargetMissing(false);
      setTooltipPosition(null);
      setOpen(true);
    };

    window.addEventListener(ONBOARDING_RESTART_EVENT, restart);
    return () => {
      if (initialTimer) window.clearTimeout(initialTimer);
      window.removeEventListener(ONBOARDING_RESTART_EVENT, restart);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 60);

    return () => window.clearTimeout(focusTimer);
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        markComplete();
        return;
      }

      if (event.key === "Tab") {
        const tooltip = tooltipRef.current;
        if (tooltip && !tooltip.contains(document.activeElement)) {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [markComplete, open]);

  useEffect(() => {
    if (!open) return;

    const step = tourSteps[stepIndex];
    if (!step) return;

    targetRef.current = null;

    let cancelled = false;
    let intervalId = 0;
    let attempts = 0;
    let resizeObserver: ResizeObserver | null = null;

    const resetTarget = () => {
      if (cancelled) return;
      targetRef.current = null;
      setTargetRect(null);
      setTargetMissing(false);
    };

    const disconnectObserver = () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    };

    const updateTargetRect = () => {
      const element = targetRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const next = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };

      setTargetRect((previous) => {
        if (
          previous &&
          Math.abs(previous.top - next.top) < 0.5 &&
          Math.abs(previous.left - next.left) < 0.5 &&
          Math.abs(previous.width - next.width) < 0.5 &&
          Math.abs(previous.height - next.height) < 0.5
        ) {
          return previous;
        }
        return next;
      });
    };

    const stopSearch = () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = 0;
      }
    };

    const findTarget = () => {
      const element = visibleElement(step.target);
      if (!element) {
        attempts += 1;
        if (attempts >= 50) {
          stopSearch();
          if (!cancelled) {
            targetRef.current = null;
            setTargetRect(null);
            setTargetMissing(true);
          }
        }
        return;
      }

      stopSearch();
      targetRef.current = element;
      disconnectObserver();

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(updateTargetRect);
        resizeObserver.observe(element);
      }

      if (!cancelled) setTargetMissing(false);
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      updateTargetRect();
    };

    if (!step.target) {
      const resetTimer = window.setTimeout(resetTarget, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(resetTimer);
      };
    }

    if (step.page && pathname !== step.page) {
      const resetTimer = window.setTimeout(resetTarget, 0);
      router.push(step.page);
      return () => {
        cancelled = true;
        window.clearTimeout(resetTimer);
      };
    }

    const initialTimer = window.setTimeout(findTarget, 80);
    intervalId = window.setInterval(findTarget, 120);

    const onViewportChange = () => updateTargetRect();
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      stopSearch();
      disconnectObserver();
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, pathname, router, stepIndex]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (!targetRect) {
        setTooltipPosition({
          top: Math.max(VIEWPORT_MARGIN, (viewportHeight - tooltipRect.height) / 2),
          left: Math.max(VIEWPORT_MARGIN, (viewportWidth - tooltipRect.width) / 2)
        });
        return;
      }

      const targetTop = targetRect.top - TARGET_PADDING;
      const targetBottom = targetRect.top + targetRect.height + TARGET_PADDING;
      const targetLeft = targetRect.left - TARGET_PADDING;
      const targetWidth = targetRect.width + TARGET_PADDING * 2;

      const spaceBelow = viewportHeight - targetBottom;
      const spaceAbove = targetTop;

      let top: number;
      if (spaceBelow >= tooltipRect.height + VIEWPORT_MARGIN) {
        top = targetBottom + VIEWPORT_MARGIN;
      } else if (spaceAbove >= tooltipRect.height + VIEWPORT_MARGIN) {
        top = targetTop - tooltipRect.height - VIEWPORT_MARGIN;
      } else {
        top = Math.max(
          VIEWPORT_MARGIN,
          Math.min(viewportHeight - tooltipRect.height - VIEWPORT_MARGIN, targetBottom + VIEWPORT_MARGIN)
        );
      }

      const centeredLeft = targetLeft + (targetWidth - tooltipRect.width) / 2;
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(viewportWidth - tooltipRect.width - VIEWPORT_MARGIN, centeredLeft)
      );

      setTooltipPosition({ top, left });
    };

    const initialTimer = window.setTimeout(updatePosition, 0);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, stepIndex, targetRect, targetMissing]);

  const goToStep = (next: number) => {
    setTargetRect(null);
    setTargetMissing(false);
    setTooltipPosition(null);
    setStepIndex(next);
  };

  const handleTooltipKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const focusable = tooltipRef.current?.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );

    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const currentStep = tourSteps[Math.min(stepIndex, tourSteps.length - 1)];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === tourSteps.length - 1;

  const spotlightStyle: CSSProperties | undefined = targetRect
    ? {
        position: "fixed",
        top: targetRect.top - TARGET_PADDING,
        left: targetRect.left - TARGET_PADDING,
        width: targetRect.width + TARGET_PADDING * 2,
        height: targetRect.height + TARGET_PADDING * 2,
        borderRadius: 18,
        border: "2px solid rgba(255, 255, 255, 0.92)",
        boxShadow: "0 0 0 9999px rgba(22, 36, 31, 0.68)",
        pointerEvents: "none",
        transition: "top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease",
        zIndex: 55
      }
    : undefined;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: targetRect ? "transparent" : "rgba(22, 36, 31, 0.68)" }}
        aria-hidden="true"
      />
      {spotlightStyle ? <div style={spotlightStyle} aria-hidden="true" /> : null}

      <div
        ref={tooltipRef}
        className="fixed z-[60] w-[min(calc(100vw-2rem),380px)] overflow-hidden rounded-3xl border border-[#c3d0cb] bg-[#f8fbfa] shadow-[0_24px_80px_rgba(22,36,31,0.35)]"
        style={{
          top: tooltipPosition?.top ?? 0,
          left: tooltipPosition?.left ?? 0,
          visibility: tooltipPosition ? "visible" : "hidden"
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={handleTooltipKeyDown}
      >
        <div className="border-b border-[#d6e1dd] bg-gradient-to-br from-[#e9f3ef] to-[#f8fbfa] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#527064]">
                MyPresence tour
              </p>
              <h2 id="onboarding-title" className="mt-1 font-[var(--font-heading)] text-xl text-[#1f2f29]">
                {currentStep.title}
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="shrink-0 rounded-full border border-[#b9cac3] bg-white/80 px-3 py-1 text-xs font-semibold text-[#35564a] hover:bg-white"
              onClick={markComplete}
              aria-label="Skip the walkthrough"
            >
              Skip
            </button>
          </div>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm leading-6 text-[#425b52]">{currentStep.description}</p>

          {currentStep.target && targetMissing ? (
            <p className="mt-3 status-info text-xs">
              We could not highlight this section on this screen, but the information below still applies.
            </p>
          ) : null}

          <p className="mt-4 rounded-xl border border-[#c8d6d1] bg-white/75 px-4 py-3 text-xs leading-5 text-[#5d7269]">
            {currentStep.hint}
          </p>

          <div className="mt-5 flex items-center gap-2" aria-label={`Step ${stepIndex + 1} of ${tourSteps.length}`}>
            {tourSteps.map((step, index) => (
              <span
                key={step.title}
                className={`h-1.5 rounded-full transition-all ${
                  index === stepIndex ? "w-7 bg-[#385b4f]" : "w-2.5 bg-[#c8d6d1]"
                }`}
              />
            ))}
            <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">
              {stepIndex + 1} / {tourSteps.length}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => goToStep(Math.max(0, stepIndex - 1))}
              disabled={isFirst}
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              {isLast ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    markComplete();
                    router.push("/help");
                  }}
                >
                  Open Help Center
                </button>
              ) : null}
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (isLast) {
                    markComplete();
                  } else {
                    goToStep(Math.min(tourSteps.length - 1, stepIndex + 1));
                  }
                }}
              >
                {isLast ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
