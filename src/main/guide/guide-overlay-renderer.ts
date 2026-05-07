// Renderer-side script for the guide overlay window. Listens for IPC
// messages from the main process and updates the DOM (owl position,
// circle position+size, fade in/out).
//
// This file runs in an Electron renderer with nodeIntegration:false.
// It uses a preload-bridged API on window.guideOverlay (set up in
// guide-overlay.ts via webPreferences.preload).

interface ShowPayload {
  target: { x: number; y: number; width: number; height: number };
  fromCursor: { x: number; y: number };
}

declare global {
  interface Window {
    guideOverlay?: {
      onShow: (h: (p: ShowPayload) => void) => void;
      onHide: (h: () => void) => void;
    };
  }
}

const owl = document.getElementById("owl") as HTMLDivElement;
const circle = document.getElementById("circle") as HTMLDivElement;

const OWL_SIZE = 64;
const OWL_OFFSET_X = 18;   // owl placed below-right of target so wing tip lands near target center
const OWL_OFFSET_Y = 18;
const CIRCLE_PADDING = 6;
const CIRCLE_MAX = 70;     // cap so a large bounds (e.g. whole "Library" tile) doesn't render a giant ring
const CIRCLE_MIN = 28;     // floor so a 1px element isn't invisible

function placeCircle(t: ShowPayload["target"]) {
  const raw = Math.max(t.width, t.height) + CIRCLE_PADDING * 2;
  const size = Math.max(CIRCLE_MIN, Math.min(CIRCLE_MAX, raw));
  // Center the (capped) circle on the target's centroid so it stays anchored
  // even when the AI sent a huge boundsHint.
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  circle.style.left = `${cx - size / 2}px`;
  circle.style.top = `${cy - size / 2}px`;
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;
}

function placeOwl(x: number, y: number) {
  owl.style.left = `${x}px`;
  owl.style.top = `${y}px`;
}

window.guideOverlay?.onShow(({ target, fromCursor }) => {
  // 1. Position owl at the cursor's start position (pre-animation)
  placeOwl(fromCursor.x - OWL_SIZE / 2, fromCursor.y - OWL_SIZE / 2);
  // 2. Position circle on target (will fade in)
  placeCircle(target);
  // 3. Force layout flush so the next style change animates from the start position
  void owl.offsetWidth;
  // 4. Fade in owl + circle
  owl.classList.add("visible");
  circle.classList.add("visible");
  // 5. After a tick, animate owl to its final spot (below-right of target)
  setTimeout(() => {
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    placeOwl(targetCenterX + OWL_OFFSET_X, targetCenterY + OWL_OFFSET_Y);
    // Start the bob animation after the slide-in completes
    setTimeout(() => owl.classList.add("bob"), 650);
  }, 16);
});

window.guideOverlay?.onHide(() => {
  owl.classList.remove("visible", "bob");
  circle.classList.remove("visible");
});

export {};
