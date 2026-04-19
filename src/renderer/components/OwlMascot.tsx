import React, { useEffect, useRef, useState } from "react";

/**
 * Animated owl mascot.
 *
 *   - Eyes (pupils+iris+highlights) track the cursor within the window,
 *     clamped so they stay inside the eye white.
 *   - Blinks every ~2 seconds (both eyes shut for ~120ms).
 *   - Head does a slow "restless" tilt a few degrees left or right at
 *     unpredictable intervals (2–7s), always eases back to vertical.
 *   - `state` prop drives extra effects:
 *       idle      → default behaviour (blink + tilt + eye tracking)
 *       thinking  → quick human-like eye darts, head is still
 *       replying  → one-shot scale-pop (600ms)
 */

export type OwlState = "idle" | "thinking" | "replying";

interface Props {
  state?: OwlState;
  size?: number;
}

// Eye centres in the SVG viewBox. White radius 28, iris 22, pupil 10 —
// travel cap 14 keeps the pupil (r=10) + iris (r=22) inside the white.
const EYE_L = { cx: 100, cy: 92 };
const EYE_R = { cx: 156, cy: 92 };
const PUPIL_TRAVEL = 14;

// Colour palette — matches the reference cartoon owl (chubby blue body,
// tan irises, warm orange beak/feet, navy outline).
const C = {
  body:   "#5B90BF",
  wing:   "#4A7CA8",
  line:   "#2D4A63",
  belly:  "#EAF2F8",
  iris:   "#D4A574",
  pupil:  "#1C1C1C",
  beak:   "#F2A93A",
  hi:     "#FFFFFF",
};

export function OwlMascot({ state = "idle", size = 40 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pupilOffset, setPupilOffset] = useState({ dx: 0, dy: 0 });
  const [blink, setBlink] = useState(false);
  const [headTilt, setHeadTilt] = useState(0); // degrees
  const [replyPop, setReplyPop] = useState(false);

  // ─── Eye tracking ────────────────────────────────────────────────────
  useEffect(() => {
    const applyClientCoords = (clientX: number, clientY: number) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
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

  // ─── Reply pop ───────────────────────────────────────────────────────
  useEffect(() => {
    if (state === "replying") {
      setReplyPop(true);
      const t = setTimeout(() => setReplyPop(false), 600);
      return () => clearTimeout(t);
    }
  }, [state]);

  const thinking = state === "thinking";

  // ─── "Thinking" eye darts ────────────────────────────────────────────
  // Pick a random direction each step (never repeat the same one twice in a
  // row) and hold it for either ~1s or ~1.5s (chosen at random). This breaks
  // the old repetitive 4-pose cycle so the owl reads as actually mulling
  // something over rather than performing a canned loop.
  const THINK_POSES: Array<{ dx: number; dy: number }> = [
    { dx:  PUPIL_TRAVEL * 0.85, dy: -PUPIL_TRAVEL * 0.7 },  // up-right
    { dx: -PUPIL_TRAVEL * 0.85, dy: -PUPIL_TRAVEL * 0.7 },  // up-left
    { dx:  PUPIL_TRAVEL * 0.9,  dy:  0                  },  // right
    { dx: -PUPIL_TRAVEL * 0.9,  dy:  0                  },  // left
    { dx:  PUPIL_TRAVEL * 0.55, dy:  PUPIL_TRAVEL * 0.55 }, // down-right
    { dx: -PUPIL_TRAVEL * 0.55, dy:  PUPIL_TRAVEL * 0.55 }, // down-left
    { dx:  0,                   dy: -PUPIL_TRAVEL * 0.8 },  // up
    { dx:  0,                   dy:  PUPIL_TRAVEL * 0.4 },  // down
    { dx:  0,                   dy:  0                  },  // centre
  ];
  const [thinkPose, setThinkPose] = useState(THINK_POSES[THINK_POSES.length - 1]);
  useEffect(() => {
    if (!thinking) {
      setThinkPose({ dx: 0, dy: 0 });
      return;
    }
    let cancelled = false;
    let lastIdx = -1;
    const step = () => {
      if (cancelled) return;
      // Pick a random pose that isn't the one we're currently on.
      let idx = Math.floor(Math.random() * THINK_POSES.length);
      if (idx === lastIdx) idx = (idx + 1) % THINK_POSES.length;
      lastIdx = idx;
      setThinkPose(THINK_POSES[idx]);
      // Hold for either ~1s or ~1.5s — picked randomly, with a tiny jitter
      // (±100ms) so consecutive same-duration holds don't land on identical
      // frames.
      const base = Math.random() < 0.5 ? 1000 : 1500;
      const hold = base + (Math.random() - 0.5) * 200;
      setTimeout(step, hold);
    };
    const kick = setTimeout(step, 200);
    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, [thinking]);

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
      {/* Soft cast shadow */}
      <ellipse cx="128" cy="244" rx="72" ry="5" fill={C.line} opacity="0.15" />

      {/* Feet — three little toe-bumps per side */}
      <g fill={C.beak} stroke={C.line} strokeWidth="2.5" strokeLinejoin="round">
        <ellipse cx="94"  cy="236" rx="7" ry="7" />
        <ellipse cx="107" cy="237" rx="7" ry="7" />
        <ellipse cx="120" cy="236" rx="7" ry="7" />
        <ellipse cx="136" cy="236" rx="7" ry="7" />
        <ellipse cx="149" cy="237" rx="7" ry="7" />
        <ellipse cx="162" cy="236" rx="7" ry="7" />
      </g>

      {/* Body — unified pear silhouette */}
      <path
        fill={C.body}
        stroke={C.line}
        strokeWidth="4"
        strokeLinejoin="round"
        d="M 128 86
           C 74 86, 42 126, 42 170
           C 42 216, 80 236, 128 236
           C 176 236, 214 216, 214 170
           C 214 126, 182 86, 128 86 Z"
      />

      {/* Wing shading — darker blue wrapping the sides */}
      <path
        fill={C.wing}
        opacity="0.55"
        d="M 58 150 C 44 180, 52 214, 80 228 L 80 170 Z"
      />
      <path
        fill={C.wing}
        opacity="0.55"
        d="M 198 150 C 212 180, 204 214, 176 228 L 176 170 Z"
      />

      {/* Belly patch */}
      <ellipse
        cx="128"
        cy="188"
        rx="44"
        ry="48"
        fill={C.belly}
        stroke={C.line}
        strokeWidth="2"
      />
      {/* Little chest ruffle (V at top of belly) */}
      <path
        d="M 118 162 Q 128 172 138 162"
        fill="none"
        stroke={C.body}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* ─── Head group (tiltable) ─── */}
      <g
        style={{
          transformOrigin: "128px 100px",
          transformBox: "fill-box",
          transition: "transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          transform: `rotate(${headTilt}deg)`,
        }}
      >
        {/* Head dome with two ear tufts — wider at the bottom so it
            sits flush against the body silhouette even when tilted. */}
        <path
          fill={C.body}
          stroke={C.line}
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
          d="M 52 108
             C 52 80, 66 58, 84 50
             L 70 28
             L 96 46
             C 106 36, 118 32, 128 32
             C 138 32, 150 36, 160 46
             L 186 28
             L 172 50
             C 190 58, 204 80, 204 108
             L 52 108 Z"
        />

        {/* Cream face mask — softens the area behind the eyes */}
        <ellipse
          cx="128"
          cy="94"
          rx="64"
          ry="36"
          fill={C.belly}
          opacity="0.75"
        />

        {/* Eye whites */}
        <circle
          cx={EYE_L.cx}
          cy={EYE_L.cy}
          r="28"
          fill={C.hi}
          stroke={C.line}
          strokeWidth="3"
        />
        <circle
          cx={EYE_R.cx}
          cy={EYE_R.cy}
          r="28"
          fill={C.hi}
          stroke={C.line}
          strokeWidth="3"
        />

        {/* Iris + pupil + highlights — translate together to track the cursor */}
        <g
          style={{
            transform: `translate(${effectiveDx}px, ${effectiveDy}px)`,
            transition: "transform 80ms linear",
          }}
        >
          {/* Tan iris */}
          <circle cx={EYE_L.cx} cy={EYE_L.cy} r="22" fill={C.iris} />
          <circle cx={EYE_R.cx} cy={EYE_R.cy} r="22" fill={C.iris} />
          {/* Dark pupil */}
          <circle cx={EYE_L.cx} cy={EYE_L.cy} r="11" fill={C.pupil} />
          <circle cx={EYE_R.cx} cy={EYE_R.cy} r="11" fill={C.pupil} />
          {/* Primary highlight */}
          <circle cx={EYE_L.cx + 4} cy={EYE_L.cy - 5} r="4" fill={C.hi} />
          <circle cx={EYE_R.cx + 4} cy={EYE_R.cy - 5} r="4" fill={C.hi} />
          {/* Tiny secondary highlight */}
          <circle cx={EYE_L.cx - 5} cy={EYE_L.cy + 6} r="1.5" fill={C.hi} />
          <circle cx={EYE_R.cx - 5} cy={EYE_R.cy + 6} r="1.5" fill={C.hi} />
        </g>

        {/* Eyelashes — three short strokes above each eye */}
        <g stroke={C.line} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M 74 68 L 70 58" />
          <path d="M 82 63 L 80 52" />
          <path d="M 90 61 L 90 50" />
          <path d="M 166 61 L 166 50" />
          <path d="M 174 63 L 176 52" />
          <path d="M 182 68 L 186 58" />
        </g>

        {/* Eyelids — collapse-to-zero rects that drop for blinks */}
        <g fill={C.body}>
          <rect
            x={EYE_L.cx - 30}
            y={EYE_L.cy - 30}
            width="60"
            height="60"
            style={{
              transformOrigin: `${EYE_L.cx}px ${EYE_L.cy - 30}px`,
              transformBox: "fill-box",
              transform: blink ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 60ms ease-in-out",
            }}
          />
          <rect
            x={EYE_R.cx - 30}
            y={EYE_R.cy - 30}
            width="60"
            height="60"
            style={{
              transformOrigin: `${EYE_R.cx}px ${EYE_R.cy - 30}px`,
              transformBox: "fill-box",
              transform: blink ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 60ms ease-in-out",
            }}
          />
        </g>

        {/* Beak — small orange triangle, slightly rounded */}
        <path
          fill={C.beak}
          stroke={C.line}
          strokeWidth="2.5"
          strokeLinejoin="round"
          d="M 128 118 L 118 132 Q 128 137 138 132 Z"
        />
      </g>
    </svg>
  );
}
