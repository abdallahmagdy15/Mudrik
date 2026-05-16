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
  onLoadingShow: (h: (payload: { text?: string }) => void) => void;
  onLoadingHide: (h: () => void) => void;
    };
  }
}

const owl = document.getElementById("owl") as HTMLDivElement;
const loading = document.getElementById("loading") as HTMLDivElement;

// --- Owl pointer (unchanged) ---

const OWL_SIZE = 64;
// Default placement: owl below-right of target so the up-left wing tip
// lands near target center. Tightened from (18,18) to (6,4) so the wing
// sits on the target itself rather than below-right of it.
const OWL_OFFSET_X = 6;
const OWL_OFFSET_Y = 4;
// Margin so the owl never butts right against a screen edge — also lets
// the bob animation's -4px translate stay fully visible.
const EDGE_PADDING = 8;

function placeOwl(x: number, y: number) {
  owl.style.left = `${x}px`;
  owl.style.top = `${y}px`;
}

window.guideOverlay?.onShow(({ target, fromCursor }) => {
  // 1. Position owl at the cursor's start position (pre-animation)
  placeOwl(fromCursor.x - OWL_SIZE / 2, fromCursor.y - OWL_SIZE / 2);
  // 2. Force layout flush so the next style change animates from the start position
  void owl.offsetWidth;
  // 3. Fade in
  owl.classList.add("visible");
  // 4. After a tick, animate owl to its final spot. Always below-right of
  //    the target (wing tip points up-left, lands on target). User feedback
  //    explicitly rejected the previous flip-on-edge behavior — they want
  //    the owl to stay in ONE orientation always, even when that means the
  //    wing tip overshoots a near-edge target slightly. The clamp below
  //    keeps the owl on-screen; the wing won't perfectly land on a
  //    bottom-right corner target, but no rotation is shown.
  setTimeout(() => {
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;

    let finalX = targetCenterX + OWL_OFFSET_X;
    let finalY = targetCenterY + OWL_OFFSET_Y;

    // Clamp the owl to the viewport (never butt against a screen edge,
    // and leave room for the bob animation's -4px translate). When the
    // target is near an edge, the wing tip will be slightly off-target —
    // accepted tradeoff per user preference for fixed orientation.
    finalX = Math.max(EDGE_PADDING, Math.min(finalX, VW - OWL_SIZE - EDGE_PADDING));
    finalY = Math.max(EDGE_PADDING, Math.min(finalY, VH - OWL_SIZE - EDGE_PADDING));

    placeOwl(finalX, finalY);

    // Start the bob animation after the slide-in completes.
    setTimeout(() => {
      owl.classList.add("bob");
    }, 650);
  }, 16);
});

window.guideOverlay?.onHide(() => {
  owl.classList.remove("visible", "bob");
});

window.guideOverlay?.onLoadingShow((payload) => {
  const textEl = loading.querySelector(".loading-text") as HTMLElement;
  if (payload.text) textEl.textContent = payload.text;
  else textEl.textContent = "Scanning screen…";
  loading.classList.add("active");
});

window.guideOverlay?.onLoadingHide(() => {
  loading.classList.remove("active");
});

export {};
