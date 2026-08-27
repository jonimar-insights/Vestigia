"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export interface TourStep {
  target: string;
  title: string;
  description: string;
  placement?: "top" | "bottom" | "left" | "right";
}

interface Props {
  steps: TourStep[];
  storageKey: string;
  onComplete: () => void;
}

interface Position {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function GuidedTour({ steps, storageKey: _storageKey, onComplete }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetPos, setTargetPos] = useState<Position | null>(null);
  const [visible, setVisible] = useState(true);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const skippedRef = useRef(false);

  // Some pages mount their tour targets asynchronously (e.g. the video page's
  // player/annotate/timeline appear only after data loads). Re-check the DOM on
  // a short interval so targets that arrive late are picked up instead of being
  // mistaken for missing.
  const [domTick, setDomTick] = useState(0);

  // Skip steps whose target doesn't exist (recomputed whenever the DOM may have
  // changed, e.g. async targets mounting).
  const effectiveIndex = useMemo(() => {
    let idx = stepIndex;
    while (idx < steps.length && !document.querySelector(steps[idx].target)) idx++;
    return idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, steps, domTick]);

  const step = steps[effectiveIndex];

  // Re-poll the DOM briefly so async-mounted targets can appear.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      setDomTick((v) => v + 1);
    }, 400);
    const stop = setTimeout(() => clearInterval(interval), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [visible, effectiveIndex]);

  // Only auto-complete once targets have had a chance to mount. If every
  // remaining step's target is genuinely absent (after the grace window), end
  // the tour rather than blocking it.
  useEffect(() => {
    if (!visible || effectiveIndex < steps.length) return;
    const t = setTimeout(() => onComplete(), 600);
    return () => clearTimeout(t);
  }, [visible, effectiveIndex, steps.length, onComplete]);

  const measureTarget = useCallback(() => {
    if (!step) return null;
    const el = document.querySelector(step.target);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    };
  }, [step]);

  // Measure + scroll into view when step changes
  useEffect(() => {
    if (!visible || !step) return;
    const el = document.querySelector(step.target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const timer = setTimeout(() => {
      const pos = measureTarget();
      if (pos) setTargetPos(pos);
    }, 350);
    return () => clearTimeout(timer);
  }, [effectiveIndex, visible, step, measureTarget]);

  // Reposition on resize/scroll
  useEffect(() => {
    if (!visible) return;
    const reposition = () => {
      const pos = measureTarget();
      if (pos) setTargetPos(pos);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [visible, measureTarget]);

  const advance = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      skippedRef.current = false;
      setStepIndex((i) => i + 1);
    } else {
      setVisible(false);
      onComplete();
    }
  }, [stepIndex, steps.length, onComplete]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) {
      skippedRef.current = false;
      setStepIndex((i) => i - 1);
    }
  }, [stepIndex]);

  const skip = useCallback(() => {
    setVisible(false);
    onComplete();
  }, [onComplete]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setVisible(false); onComplete(); }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onComplete, advance]);

  if (!visible || !step || !targetPos) return null;

  const placement = step.placement ?? "bottom";
  const gap = 12;
  const tooltipWidth = 320;

  let tooltipTop: number;
  let tooltipLeft: number;
  let arrowStyle: React.CSSProperties = {};

  if (placement === "bottom") {
    tooltipTop = targetPos.top + targetPos.height + gap;
    tooltipLeft = targetPos.left + targetPos.width / 2 - tooltipWidth / 2;
    arrowStyle = { top: -6, left: tooltipWidth / 2 - 6, borderRight: "6px solid transparent", borderBottom: "6px solid var(--color-surface)", borderLeft: "6px solid transparent" };
  } else if (placement === "top") {
    tooltipTop = targetPos.top - gap - 140;
    tooltipLeft = targetPos.left + targetPos.width / 2 - tooltipWidth / 2;
    arrowStyle = { bottom: -6, left: tooltipWidth / 2 - 6, borderTop: "6px solid var(--color-surface)", borderRight: "6px solid transparent", borderLeft: "6px solid transparent" };
  } else if (placement === "left") {
    tooltipTop = targetPos.top + targetPos.height / 2 - 70;
    tooltipLeft = targetPos.left - tooltipWidth - gap;
    arrowStyle = { top: 70 - 6, right: -6, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: "6px solid var(--color-surface)" };
  } else {
    tooltipTop = targetPos.top + targetPos.height / 2 - 70;
    tooltipLeft = targetPos.left + targetPos.width + gap;
    arrowStyle = { top: 70 - 6, left: -6, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderRight: "6px solid var(--color-surface)" };
  }

  tooltipLeft = Math.max(16, Math.min(tooltipLeft, window.innerWidth - tooltipWidth - 16));
  tooltipTop = Math.max(16, tooltipTop);

  return (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-black/40 transition-opacity"
        onClick={skip}
      />

      <div
        className="fixed z-[9999] rounded-lg ring-2 ring-accent ring-offset-2 ring-offset-transparent pointer-events-none transition-all duration-300"
        style={{
          top: targetPos.top - 4,
          left: targetPos.left - 4,
          width: targetPos.width + 8,
          height: targetPos.height + 8,
        }}
      />

      <div
        ref={tooltipRef}
        className="fixed z-[9999] w-[320px] rounded-xl border border-border bg-surface shadow-2xl overflow-hidden"
        style={{ top: tooltipTop, left: tooltipLeft }}
      >
        <div className="absolute" style={arrowStyle} />

        <div className="h-0.5 bg-border">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((effectiveIndex + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-[10px] font-medium text-accent uppercase tracking-wider mb-1">
                {effectiveIndex + 1} / {steps.length}
              </p>
              <h3 className="text-sm font-semibold">{step.title}</h3>
            </div>
            <button
              onClick={skip}
              className="text-muted hover:text-foreground transition-colors shrink-0 p-0.5"
              title="Skip tour"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-xs text-muted leading-relaxed mb-4">{step.description}</p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {effectiveIndex > 0 && (
                <button
                  onClick={goBack}
                  className="px-3 py-1.5 text-[10px] font-medium rounded-lg border border-border text-muted hover:text-foreground hover:border-accent/30 transition-colors"
                >
                  Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={skip}
                className="px-3 py-1.5 text-[10px] font-medium text-muted hover:text-foreground transition-colors"
              >
                Skip
              </button>
              <button
                onClick={advance}
                className="px-4 py-1.5 text-[10px] font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                {effectiveIndex === steps.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Check if the tour has been completed for a given storage key */
export function isTourCompleted(storageKey: string): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(storageKey) === "done";
}

/** Mark the tour as completed */
export function completeTour(storageKey: string) {
  localStorage.setItem(storageKey, "done");
}
