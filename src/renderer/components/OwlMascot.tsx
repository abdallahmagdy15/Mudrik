import React, { useEffect, useRef, useState } from "react";

/**
 * Animated owl mascot matching assets/icon.svg.
 *
 *   - Eyes (pupils) track the cursor within the window, clamped so they
 *     stay inside the eye circle.
 *   - Blinks every ~2 seconds (both eyes shut for ~120ms).
 *   - Head does a slow "restless" tilt a few degrees left or right at
 *     unpredictable intervals (2–7s), always eases back to vertical.
 *   - `state` prop drives extra effects:
 *       idle      → default behaviour (blink + tilt + eye tracking)
 *       thinking  → pupils gently pulse, head is still
 *       replying  → one-shot brow-raise + wing-wiggle (600ms)
 */

export type OwlState = "idle" | "thinking" | "replying";

interface Props {
  state?: OwlState;
  size?: number;
}

// Pupil centres in the SVG viewBox, used as the "rest" position. The eye
// whites are radius-24 circles; the pupil's centre is clamped to stay
// inside a radius-12 travel zone so the pupil (r=10) never leaves the eye.
const EYE_L = { cx: 102, cy: 88 };
const EYE_R = { cx: 154, cy: 88 };
const PUPIL_TRAVEL = 12;

export function OwlMascot({ state = "idle", size = 40 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pupilOffset, setPupilOffset] = useState({ dx: 0, dy: 0 });
  const [blink, setBlink] = useState(false);
  const [headTilt, setHeadTilt] = useState(0); // degrees
  const [replyPop, setReplyPop] = useState(false);

  // ─── Eye tracking ────────────────────────────────────────────────────
  // Two input sources, in preference order:
  //
  //   1. Desktop-wide cursor pushed from the main process via IPC
  //      (`window.hoverbuddy.onCursorPos`). Values are SCREEN coordinates,
  //      so we convert to this window's client coords using `window.screenX/Y`.
  //      Used whenever the panel is visible — lets the eyes track the cursor
  //      even when it's over another window.
  //
  //   2. Fallback: plain `mousemove` events inside the panel, used if the
  //      IPC stream isn't running yet (first few frames after mount).
  //
  // Whichever lands last wins; we don't need to de-duplicate.
  useEffect(() => {
    const applyClientCoords = (clientX: number, clientY: number) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      // Saturate travel at ~240px — beyond that the pupil is already
      // fully shifted toward that corner.
      const scale = Math.min(1, dist / 240) * PUPIL_TRAVEL;
      const nx = (dx / (dist || 1)) * scale;
      const ny = (dy / (dist || 1)) * scale;
      setPupilOffset({ dx: nx, dy: ny });
    };

    const onLocalMove = (e: MouseEvent) => applyClientCoords(e.clientX, e.clientY);
    window.addEventListener("mousemove", onLocalMove);

    const hb: any = (window as any).hoverbuddy;
    if (hb?.onCursorPos) {
      hb.onCursorPos((pos: { x: number; y: number }) => {
        // Screen coords → window-local client coords.
        applyClientCoords(pos.x - window.screenX, pos.y - window.screenY);
      });
    }

    return () => window.removeEventListener("mousemove", onLocalMove);
  }, []);

  // ─── Blink every ~2s ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      setBlink(true);
      setTimeout(() => setBlink(false), 120);
      // Jitter the next blink by ±400ms so it doesn't look mechanical.
      const next = 2000 + (Math.random() - 0.5) * 800;
      setTimeout(loop, next);
    };
    const startDelay = setTimeout(loop, 1200);
    return () => {
      cancelled = true;
      clearTimeout(startDelay);
    };
  }, []);

  // ─── Restless head tilts ─────────────────────────────────────────────
  // Every 2–7s, pick a small angle (-12°..+12°), hold 600–1100ms, then
  // return to 0°. Skip tilts while the owl is "thinking" to avoid
  // distracting the user.
  useEffect(() => {
    if (state === "thinking") {
      setHeadTilt(0);
      return;
    }
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const wait = 2000 + Math.random() * 5000;
      setTimeout(() => {
        if (cancelled) return;
        const angle = (Math.random() * 24 - 12);
        setHeadTilt(angle);
        const hold = 600 + Math.random() * 500;
        setTimeout(() => {
          if (cancelled) return;
          setHeadTilt(0);
          schedule();
        }, hold);
      }, wait);
    };
    schedule();
    return () => { cancelled = true; };
  }, [state]);

  // ─── Reply pop: one-shot when state transitions to replying ──────────
  useEffect(() => {
    if (state === "replying") {
      setReplyPop(true);
      const t = setTimeout(() => setReplyPop(false), 600);
      return () => clearTimeout(t);
    }
  }, [state]);

  const thinking = state === "thinking";

  // ─── "Thinking" eye darts ────────────────────────────────────────────
  // When the model is working we replace the cursor-tracking pupils with
  // a quick human-like glance cycle: up-right → pause → up-left → pause
  // → center → pause → repeat. The cycle is driven by a ticking state
  // counter so the transition between positions is animated by the same
  // 80ms CSS transition used for cursor tracking, giving a natural snap.
  const [darkTick, setDarkTick] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      setDarkTick((t) => t + 1);
      // Vary the hold a little so it doesn't feel metronomic.
      const hold = 420 + Math.random() * 260;
      setTimeout(step, hold);
    };
    const kick = setTimeout(step, 200);
    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, [thinking]);

  // 4-phase loop: 0 = up-right, 1 = up-left, 2 = center-low, 3 = center.
  // PUPIL_TRAVEL caps horizontal excursion; vertical goes 60–80% of that
  // so the pupils don't clip the eyelid when blinking.
  const THINK_POSES: Array<{ dx: number; dy: number }> = [
    { dx:  PUPIL_TRAVEL * 0.85, dy: -PUPIL_TRAVEL * 0.7 },
    { dx: -PUPIL_TRAVEL * 0.85, dy: -PUPIL_TRAVEL * 0.7 },
    { dx:  0,                   dy:  PUPIL_TRAVEL * 0.35 },
    { dx:  0,                   dy:  0 },
  ];
  const thinkPose = THINK_POSES[darkTick % THINK_POSES.length];

  const effectiveDx = thinking ? thinkPose.dx : pupilOffset.dx;
  const effectiveDy = thinking ? thinkPose.dy : pupilOffset.dy;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 256 256"
      width={size}
      height={size}
      style={{
        display: "block",
        transition: "transform 200ms ease",
        transform: replyPop ? "scale(1.08)" : "scale(1)",
      }}
      aria-hidden="true"
    >
      {/* Feet */}
      <g fill="#F2A93A">
        <path d="M92 218 L78 238 L90 238 L96 226 Z"/>
        <path d="M108 220 L98 238 L110 238 L114 228 Z"/>
        <path d="M148 220 L146 238 L158 238 L162 228 Z"/>
        <path d="M164 218 L166 238 L178 238 L180 226 Z"/>
      </g>

      {/* Back wing */}
      <path fill="#0FA8C9" d="M198 130 C 210 168 198 208 166 220 L 166 160 Z"/>

      {/* Body */}
      <path
        fill="#18BFE1"
        d="M128 88 C 74 88 48 136 48 172 C 48 210 80 232 128 232 C 176 232 208 210 208 172 C 208 136 182 88 128 88 Z"
      />
      <ellipse cx="128" cy="186" rx="40" ry="40" fill="#FFFFFF" opacity="0.95" />

      {/* Head group — rotates around the neck for the tilt animation */}
      <g
        style={{
          transformOrigin: "128px 92px",
          transformBox: "fill-box",
          transition: "transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          transform: `rotate(${headTilt}deg)`,
        }}
      >
        <path
          fill="#18BFE1"
          d="M128 22
             C 94 22 66 46 60 82
             L 72 64
             L 92 82
             C 104 72 120 68 128 68
             C 136 68 152 72 164 82
             L 184 64
             L 196 82
             C 190 46 162 22 128 22 Z"
        />

        {/* Eye whites */}
        <circle cx={EYE_L.cx} cy={EYE_L.cy} r="24" fill="#FFFFFF" />
        <circle cx={EYE_R.cx} cy={EYE_R.cy} r="24" fill="#FFFFFF" />

        {/* Pupils (translate to follow cursor) */}
        <g
          style={{
            transform: `translate(${effectiveDx}px, ${effectiveDy}px)`,
            transition: "transform 80ms linear",
          }}
        >
          <circle cx={EYE_L.cx} cy={EYE_L.cy} r="10" fill="#1C1C1C" />
          <circle cx={EYE_R.cx} cy={EYE_R.cy} r="10" fill="#1C1C1C" />
          <circle cx={EYE_L.cx + 4} cy={EYE_L.cy - 4} r="3" fill="#FFFFFF" />
          <circle cx={EYE_R.cx + 4} cy={EYE_R.cy - 4} r="3" fill="#FFFFFF" />
        </g>

        {/* Eyelids — drawn as filled rects over each eye that collapse to
            zero height when not blinking. Using SVG transforms so the
            animation is GPU-accelerated. */}
        <g fill="#18BFE1">
          <rect
            x={EYE_L.cx - 24}
            y={EYE_L.cy - 24}
            width="48"
            height="48"
            style={{
              transformOrigin: `${EYE_L.cx}px ${EYE_L.cy - 24}px`,
              transformBox: "fill-box",
              transform: blink ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 60ms ease-in-out",
            }}
          />
          <rect
            x={EYE_R.cx - 24}
            y={EYE_R.cy - 24}
            width="48"
            height="48"
            style={{
              transformOrigin: `${EYE_R.cx}px ${EYE_R.cy - 24}px`,
              transformBox: "fill-box",
              transform: blink ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 60ms ease-in-out",
            }}
          />
        </g>

        {/* Beak */}
        <path fill="#F2A93A" d="M128 104 L 120 118 L 136 118 Z" />
      </g>
    </svg>
  );
}
