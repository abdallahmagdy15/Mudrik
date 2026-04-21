import React, { useEffect, useRef, useState } from "react";

/**
 * Animated owl mascot — refined to match the character reference
 * (`assets/mascot.png`): soft steel-blue body, golden eyes, two layered
 * folded wings, gentle smile on the belly.
 *
 *   - Eyes (pupils+iris+highlights) track the cursor within the window,
 *     clamped so they stay inside the eye white.
 *   - Blinks every ~2 seconds (both eyes shut for ~120ms).
 *   - Head does a slow "restless" tilt a few degrees at unpredictable
 *     intervals (2–7s), always eases back to vertical.
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

// Eye centres in the SVG viewBox. The WHITE container stays big (r=30) —
// that's the face feature. Only the inner eyeball (iris + pupil) is
// smaller so there's more white visible around it, like real cartoon owl
// eyes. Travel cap 14 keeps the shrunken eyeball well inside the white.
const EYE_L = { cx: 100, cy: 94 };
const EYE_R = { cx: 156, cy: 94 };
const EYE_WHITE_R = 30;
const PUPIL_TRAVEL = 14;

// Palette keyed to the reference mascot PNG. A slightly dustier, steelier
// blue than the app's cyan accent — character identity, not the UI brand
// (those remain cyan in global.css).
const C = {
  body:      "#7499C2",  // primary feather blue
  bodyDeep:  "#4F7399",  // wing shading / feather tips
  bodyLight: "#9DB8D6",  // subtle highlights
  line:      "#2D4A63",  // outline ink
  belly:     "#E8EEF5",  // chest / belly off-white
  bellyShade:"#C9D5E4",  // belly edge shading
  iris:      "#F2C94C",  // golden yellow
  irisRing:  "#D99A1E",  // iris outer rim
  pupil:     "#1C1C1C",
  beak:      "#F2A93A",  // orange
  beakHi:    "#FFC06A",  // beak warm highlight
  hi:        "#FFFFFF",
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
      let idx = Math.floor(Math.random() * THINK_POSES.length);
      if (idx === lastIdx) idx = (idx + 1) % THINK_POSES.length;
      lastIdx = idx;
      setThinkPose(THINK_POSES[idx]);
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
      {/* Soft cast shadow on the floor so the owl feels grounded */}
      <ellipse cx="128" cy="246" rx="70" ry="4.5" fill={C.line} opacity="0.18" />

      {/* Feet — three small orange toes per side, peeking under the body */}
      <g fill={C.beak} stroke={C.line} strokeWidth="2" strokeLinejoin="round">
        <path d="M 100 234 Q 102 244 108 244 L 114 244 Q 118 244 116 238 Z" />
        <path d="M 118 234 Q 120 245 126 245 L 132 245 Q 136 244 134 238 Z" />
        <path d="M 138 234 Q 140 245 146 245 L 152 245 Q 156 244 154 238 Z" />
      </g>

      {/* Body — unified pear silhouette, slightly wider than head */}
      <path
        fill={C.body}
        stroke={C.line}
        strokeWidth="4"
        strokeLinejoin="round"
        d="M 128 86
           C 74 86, 40 128, 40 172
           C 40 218, 80 238, 128 238
           C 176 238, 216 218, 216 172
           C 216 128, 182 86, 128 86 Z"
      />

      {/* ─── Left wing (tucked, layered feathers) ─── */}
      <g>
        {/* Base wing — wraps the left body curve */}
        <path
          fill={C.bodyDeep}
          stroke={C.line}
          strokeWidth="3"
          strokeLinejoin="round"
          d="M 52 148
             C 40 180, 48 214, 74 226
             L 92 222
             L 88 150
             Z"
        />
        {/* Inner feather layer — slightly lighter */}
        <path
          fill={C.body}
          opacity="0.85"
          d="M 60 158
             C 52 184, 58 210, 78 220
             L 86 218
             L 84 162 Z"
        />
        {/* Feather lines — three curved strokes */}
        <g stroke={C.line} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7">
          <path d="M 74 172 Q 70 192 78 210" />
          <path d="M 64 166 Q 60 190 72 214" />
        </g>
      </g>

      {/* ─── Right wing (mirror) ─── */}
      <g>
        <path
          fill={C.bodyDeep}
          stroke={C.line}
          strokeWidth="3"
          strokeLinejoin="round"
          d="M 204 148
             C 216 180, 208 214, 182 226
             L 164 222
             L 168 150
             Z"
        />
        <path
          fill={C.body}
          opacity="0.85"
          d="M 196 158
             C 204 184, 198 210, 178 220
             L 170 218
             L 172 162 Z"
        />
        <g stroke={C.line} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7">
          <path d="M 182 172 Q 186 192 178 210" />
          <path d="M 192 166 Q 196 190 184 214" />
        </g>
      </g>

      {/* Belly patch — rounded oval */}
      <ellipse
        cx="128"
        cy="186"
        rx="46"
        ry="50"
        fill={C.belly}
        stroke={C.line}
        strokeWidth="2"
      />
      {/* Belly shade along the bottom edge for softness */}
      <ellipse
        cx="128"
        cy="212"
        rx="38"
        ry="18"
        fill={C.bellyShade}
        opacity="0.55"
      />
      {/* Little chest ruffle (V at top of belly) */}
      <path
        d="M 116 158 Q 128 170 140 158"
        fill="none"
        stroke={C.body}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Gentle smile curve on the belly — subtle personality hint */}
      <path
        d="M 116 198 Q 128 208 140 198"
        fill="none"
        stroke={C.bodyDeep}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.6"
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
        {/* Head dome with two curved ear tufts — outer edges bulge outward
            the way real owl/cat tufts do, not pointy triangular horns. Each
            tuft is an outward C-curve up to a soft peak, then a gentler
            inward curve back down to the forehead. */}
        <path
          fill={C.body}
          stroke={C.line}
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
          d="M 54 108
             C 54 80, 66 60, 82 50
             C 72 40, 66 28, 72 20
             C 82 26, 92 38, 100 46
             C 110 40, 118 36, 128 36
             C 138 36, 146 40, 156 46
             C 164 38, 174 26, 184 20
             C 190 28, 184 40, 174 50
             C 190 60, 202 80, 202 108
             L 54 108 Z"
        />

        {/* Subtle head highlight — hint of the lighter feather tone on the top-left */}
        <path
          d="M 76 54 C 92 46, 108 42, 122 42"
          fill="none"
          stroke={C.bodyLight}
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Eye whites (big face feature — kept large for that wide-eyed
            cartoon-owl look) */}
        <circle cx={EYE_L.cx} cy={EYE_L.cy} r={EYE_WHITE_R} fill={C.hi} stroke={C.line} strokeWidth="3" />
        <circle cx={EYE_R.cx} cy={EYE_R.cy} r={EYE_WHITE_R} fill={C.hi} stroke={C.line} strokeWidth="3" />

        {/* Inner eyeball (iris + pupil + highlights) — smaller than the white
            so there's visible sclera around it, like real cartoon owl eyes.
            Translates together to track the cursor, CLIPPED to the eye-white
            circle so it can never escape the container. */}
        <defs>
          <clipPath id="eyeClipL">
            <circle cx={EYE_L.cx} cy={EYE_L.cy} r={EYE_WHITE_R} />
          </clipPath>
          <clipPath id="eyeClipR">
            <circle cx={EYE_R.cx} cy={EYE_R.cy} r={EYE_WHITE_R} />
          </clipPath>
        </defs>
        <g
          style={{
            transform: `translate(${effectiveDx}px, ${effectiveDy}px)`,
            transition: "transform 80ms linear",
          }}
        >
          <g clipPath="url(#eyeClipL)">
            <circle cx={EYE_L.cx} cy={EYE_L.cy} r="18" fill={C.irisRing} />
            <circle cx={EYE_L.cx} cy={EYE_L.cy} r="15" fill={C.iris} />
            <circle cx={EYE_L.cx} cy={EYE_L.cy} r="8" fill={C.pupil} />
            <circle cx={EYE_L.cx + 3} cy={EYE_L.cy - 4} r="3" fill={C.hi} />
            <circle cx={EYE_L.cx - 4} cy={EYE_L.cy + 5} r="1.4" fill={C.hi} />
          </g>
          <g clipPath="url(#eyeClipR)">
            <circle cx={EYE_R.cx} cy={EYE_R.cy} r="18" fill={C.irisRing} />
            <circle cx={EYE_R.cx} cy={EYE_R.cy} r="15" fill={C.iris} />
            <circle cx={EYE_R.cx} cy={EYE_R.cy} r="8" fill={C.pupil} />
            <circle cx={EYE_R.cx + 3} cy={EYE_R.cy - 4} r="3" fill={C.hi} />
            <circle cx={EYE_R.cx - 4} cy={EYE_R.cy + 5} r="1.4" fill={C.hi} />
          </g>
        </g>

        {/* Eyelids — circle the EXACT same size as the white container (r=30)
            so the blink covers the eye perfectly: no visible white gap at the
            rim, no overshoot onto the face. */}
        <g fill={C.body} stroke={C.line} strokeWidth="3">
          <circle
            cx={EYE_L.cx} cy={EYE_L.cy} r={EYE_WHITE_R}
            style={{
              transformOrigin: `${EYE_L.cx}px ${EYE_L.cy - EYE_WHITE_R}px`,
              transformBox: "fill-box",
              transform: blink ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 60ms ease-in-out",
            }}
          />
          <circle
            cx={EYE_R.cx} cy={EYE_R.cy} r={EYE_WHITE_R}
            style={{
              transformOrigin: `${EYE_R.cx}px ${EYE_R.cy - EYE_WHITE_R}px`,
              transformBox: "fill-box",
              transform: blink ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 60ms ease-in-out",
            }}
          />
        </g>

        {/* Beak — small orange triangle with a subtle highlight */}
        <path
          fill={C.beak}
          stroke={C.line}
          strokeWidth="2.5"
          strokeLinejoin="round"
          d="M 128 120 L 118 134 Q 128 140 138 134 Z"
        />
        <path
          d="M 123 124 L 126 130"
          fill="none"
          stroke={C.beakHi}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.85"
        />
      </g>
    </svg>
  );
}
