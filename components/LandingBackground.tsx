"use client";

/**
 * LandingBackground — a subtle, fixed, decorative background for the
 * MARGINALIA: Vestigia landing page. It visually echoes the app's core
 * features without distracting from the actual UI:
 *
 *   • A horizontal timeline spine with pulsing annotation pins
 *   • Key-moment stars that twinkle
 *   • Scene segments that gently fade
 *   • A transcript waveform (equalizer bars)
 *   • A film-strip cliplist strip
 *   • A moving playhead along the timeline
 *   • Search magnifier, share nodes, and an export arrow
 *
 * It is pointer-events-none and sits behind the app content (z-0).
 */
export default function LandingBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(1200px 600px at 15% -10%, hsl(var(--accent) / 0.08), transparent 60%)," +
          "radial-gradient(1000px 500px at 90% 110%, hsl(var(--accent) / 0.06), transparent 60%)," +
          "linear-gradient(180deg, transparent, hsl(var(--background)))",
      }}
    >
      {/* ── Timeline spine ── */}
      <svg
        className="absolute left-1/2 top-[18%] w-[min(1200px,90vw)] -translate-x-1/2"
        viewBox="0 0 1200 120"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Spine */}
        <line
          x1="0"
          y1="60"
          x2="1200"
          y2="60"
          stroke="hsl(var(--accent) / 0.12)"
          strokeWidth="2"
          strokeDasharray="4 6"
        />

        {/* Scene segments */}
        <rect x="40" y="52" width="180" height="16" rx="8" fill="hsl(var(--accent) / 0.05)" style={{ animation: "lb-scene 6s ease-in-out infinite" }} />
        <rect x="260" y="52" width="220" height="16" rx="8" fill="hsl(var(--accent) / 0.05)" style={{ animation: "lb-scene 7s ease-in-out 1s infinite" }} />
        <rect x="520" y="52" width="160" height="16" rx="8" fill="hsl(var(--accent) / 0.05)" style={{ animation: "lb-scene 5.5s ease-in-out 2s infinite" }} />
        <rect x="720" y="52" width="200" height="16" rx="8" fill="hsl(var(--accent) / 0.05)" style={{ animation: "lb-scene 6.5s ease-in-out 0.5s infinite" }} />
        <rect x="960" y="52" width="180" height="16" rx="8" fill="hsl(var(--accent) / 0.05)" style={{ animation: "lb-scene 7.5s ease-in-out 1.5s infinite" }} />

        {/* Annotation pins */}
        <g style={{ animation: "lb-pin 3s ease-in-out infinite" }}>
          <circle cx="120" cy="60" r="5" fill="hsl(var(--accent) / 0.5)" />
          <circle cx="120" cy="60" r="9" stroke="hsl(var(--accent) / 0.2)" strokeWidth="1" />
        </g>
        <g style={{ animation: "lb-pin 3.4s ease-in-out 0.4s infinite" }}>
          <circle cx="340" cy="60" r="5" fill="hsl(var(--accent) / 0.5)" />
          <circle cx="340" cy="60" r="9" stroke="hsl(var(--accent) / 0.2)" strokeWidth="1" />
        </g>
        <g style={{ animation: "lb-pin 3.8s ease-in-out 0.8s infinite" }}>
          <circle cx="580" cy="60" r="5" fill="hsl(var(--accent) / 0.5)" />
          <circle cx="580" cy="60" r="9" stroke="hsl(var(--accent) / 0.2)" strokeWidth="1" />
        </g>
        <g style={{ animation: "lb-pin 3.2s ease-in-out 1.2s infinite" }}>
          <circle cx="800" cy="60" r="5" fill="hsl(var(--accent) / 0.5)" />
          <circle cx="800" cy="60" r="9" stroke="hsl(var(--accent) / 0.2)" strokeWidth="1" />
        </g>
        <g style={{ animation: "lb-pin 3.6s ease-in-out 1.6s infinite" }}>
          <circle cx="1040" cy="60" r="5" fill="hsl(var(--accent) / 0.5)" />
          <circle cx="1040" cy="60" r="9" stroke="hsl(var(--accent) / 0.2)" strokeWidth="1" />
        </g>

        {/* Key-moment stars */}
        <path d="M200 20l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="hsl(var(--accent) / 0.4)" style={{ animation: "lb-twinkle 4s ease-in-out infinite" }} />
        <path d="M460 30l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="hsl(var(--accent) / 0.35)" style={{ animation: "lb-twinkle 4.5s ease-in-out 0.6s infinite" }} />
        <path d="M680 18l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="hsl(var(--accent) / 0.4)" style={{ animation: "lb-twinkle 3.8s ease-in-out 1.1s infinite" }} />
        <path d="M900 26l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="hsl(var(--accent) / 0.35)" style={{ animation: "lb-twinkle 4.2s ease-in-out 1.7s infinite" }} />
        <path d="M1120 22l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="hsl(var(--accent) / 0.4)" style={{ animation: "lb-twinkle 5s ease-in-out 2.2s infinite" }} />

        {/* Moving playhead */}
        <g style={{ animation: "lb-playhead 14s linear infinite" }}>
          <line x1="0" y1="40" x2="0" y2="80" stroke="hsl(var(--accent) / 0.5)" strokeWidth="2" />
          <circle cx="0" cy="60" r="4" fill="hsl(var(--accent) / 0.6)" />
        </g>
      </svg>

      {/* ── Transcript waveform (equalizer) ── */}
      <div className="absolute right-[8%] top-[12%] flex items-end gap-1 opacity-40">
        {[14, 22, 10, 28, 16, 24, 12, 20, 8, 26, 18, 30, 14, 22, 10].map((h, i) => (
          <div
            key={i}
            className="w-1 rounded-full bg-accent/40"
            style={{
              height: `${h}px`,
              transformOrigin: "bottom",
              animation: `lb-wave ${1.2 + (i % 5) * 0.2}s ease-in-out ${i * 0.08}s infinite`,
            }}
          />
        ))}
      </div>

      {/* ── Film-strip cliplist ── */}
      <div className="absolute left-[6%] top-[30%] flex items-center gap-2 opacity-30">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-10 w-14 rounded-md border border-accent/30 bg-accent/5 p-1"
            style={{ animation: `lb-film ${2.5 + i * 0.3}s ease-in-out ${i * 0.2}s infinite` }}
          >
            <div className="flex h-full items-center justify-center gap-0.5">
              <div className="h-3 w-0.5 rounded bg-accent/40" />
              <div className="h-3 w-0.5 rounded bg-accent/40" />
              <div className="h-3 w-0.5 rounded bg-accent/40" />
            </div>
          </div>
        ))}
      </div>

      {/* ── Search magnifier ── */}
      <svg
        className="absolute left-[12%] top-[8%] opacity-30"
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="hsl(var(--accent) / 0.6)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "lb-drift 6s ease-in-out infinite" }}
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      {/* ── Share nodes ── */}
      <svg
        className="absolute right-[14%] top-[38%] opacity-30"
        width="60"
        height="60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="hsl(var(--accent) / 0.6)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "lb-drift 7s ease-in-out 1s infinite" }}
      >
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>

      {/* ── Export arrow ── */}
      <svg
        className="absolute bottom-[14%] right-[10%] opacity-30"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="hsl(var(--accent) / 0.6)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "lb-drift 6.5s ease-in-out 0.5s infinite" }}
      >
        <path d="M12 3v12" />
        <path d="M7 8l5-5 5 5" />
        <path d="M5 21h14" />
      </svg>

      {/* ── Import / play button ── */}
      <svg
        className="absolute bottom-[16%] left-[10%] opacity-30"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="hsl(var(--accent) / 0.6)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "lb-drift 7.5s ease-in-out 1.5s infinite" }}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5v7l6-3.5z" fill="hsl(var(--accent) / 0.4)" stroke="none" />
      </svg>
    </div>
  );
}