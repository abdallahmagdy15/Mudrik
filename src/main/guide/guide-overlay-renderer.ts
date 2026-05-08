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

const OWL_SIZE = 64;
const OWL_OFFSET_X = 18;   // owl placed below-right of target so wing tip lands near target center
const OWL_OFFSET_Y = 18;

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
  // 4. After a tick, animate owl to its final spot (below-right of target)
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
});

export {};
