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

function applyFlips(flipX: boolean, flipY: boolean) {
  // Flip the asset so the wing tip still points TOWARD the target when
  // we have to place the owl above/left instead of below-right (taskbar
  // / right-edge targets). Bob animation also writes to .owl's transform,
  // so we only enable bob when not flipped — the slide-in motion alone
  // is enough visual life on flipped edges.
  const t: string[] = [];
  if (flipX) t.push("scaleX(-1)");
  if (flipY) t.push("scaleY(-1)");
  owl.style.transform = t.length ? t.join(" ") : "";
}

window.guideOverlay?.onShow(({ target, fromCursor }) => {
  // 1. Position owl at the cursor's start position (pre-animation)
  placeOwl(fromCursor.x - OWL_SIZE / 2, fromCursor.y - OWL_SIZE / 2);
  applyFlips(false, false);
  // 2. Force layout flush so the next style change animates from the start position
  void owl.offsetWidth;
  // 3. Fade in
  owl.classList.add("visible");
  // 4. After a tick, animate owl to its final spot (default below-right;
  //    flips to above/left if the screen edge would clip it).
  setTimeout(() => {
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;

    let finalX = targetCenterX + OWL_OFFSET_X;
    let finalY = targetCenterY + OWL_OFFSET_Y;
    let flipX = false;
    let flipY = false;

    // Bottom edge: target near taskbar → owl would render off-screen
    // beneath the bottom. Place owl ABOVE target instead and flip
    // vertically so the wing tip points DOWN at the target.
    if (finalY + OWL_SIZE > VH - EDGE_PADDING) {
      finalY = target.y - OWL_SIZE - OWL_OFFSET_Y;
      flipY = true;
    }
    // Right edge: same idea, flip horizontally so wing tip points right.
    if (finalX + OWL_SIZE > VW - EDGE_PADDING) {
      finalX = target.x - OWL_SIZE - OWL_OFFSET_X;
      flipX = true;
    }

    // Final clamp guards against tiny screens / unusual targets where
    // the flip-fallback ALSO doesn't fit (target spans most of the
    // viewport). Better to show a slightly off-target owl than nothing.
    finalX = Math.max(EDGE_PADDING, Math.min(finalX, VW - OWL_SIZE - EDGE_PADDING));
    finalY = Math.max(EDGE_PADDING, Math.min(finalY, VH - OWL_SIZE - EDGE_PADDING));

    placeOwl(finalX, finalY);
    applyFlips(flipX, flipY);

    // Start the bob animation after the slide-in completes — only when
    // not flipped (bob animates transform on .owl which would override
    // the flip; the slide-in motion is enough visual life on flipped
    // edges).
    setTimeout(() => {
      if (!flipX && !flipY) owl.classList.add("bob");
    }, 650);
  }, 16);
});

window.guideOverlay?.onHide(() => {
  owl.classList.remove("visible", "bob");
  owl.style.transform = "";
});

export {};
