// Renderer-side script for the guide overlay window. Listens for IPC
// messages from the main process and updates the DOM (owl position,
// bubble UI, fade in/out).
//
// This file runs in an Electron renderer with nodeIntegration:false.
// It uses a preload-bridged API on window.guideOverlay (set up in
// guide-overlay.ts via webPreferences.preload).

interface ShowPayload {
  target: { x: number; y: number; width: number; height: number };
  fromCursor: { x: number; y: number };
}

interface BubblePayload {
  caption: string;
  options: string[];
  theme: string;
}

declare global {
  interface Window {
    guideOverlay?: {
      onShow: (h: (p: ShowPayload) => void) => void;
      onHide: (h: () => void) => void;
      onLoadingShow: (h: (payload: { text?: string }) => void) => void;
      onLoadingHide: (h: () => void) => void;
      onBubbleShow: (h: (payload: BubblePayload) => void) => void;
      onBubbleHide: (h: () => void) => void;
      onBubbleFade: (h: (payload: { opacity: number }) => void) => void;
      onSetOwlMode: (h: (payload: { mode: "pointing" | "thinking" }) => void) => void;
      sendChoice: (choice: string) => void;
      setIgnoreMouseEvents: (ignore: boolean) => void;
    };
  }
}

const owl = document.getElementById("owl") as HTMLDivElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const bubbleCaption = document.getElementById("bubble-caption") as HTMLDivElement;
const bubbleButtons = document.getElementById("bubble-buttons") as HTMLDivElement;
const bubbleLoading = document.getElementById("bubble-loading") as HTMLDivElement;
const bubbleTail = bubble.querySelector(".guide-bubble-tail") as HTMLDivElement;

// --- Owl pointer (unchanged) ---

const OWL_SIZE = 64;
const OWL_OFFSET_X = 6;
const OWL_OFFSET_Y = 4;
const EDGE_PADDING = 8;

function placeOwl(x: number, y: number) {
  owl.style.left = `${x}px`;
  owl.style.top = `${y}px`;
}

window.guideOverlay?.onShow(({ target, fromCursor }) => {
  placeOwl(fromCursor.x - OWL_SIZE / 2, fromCursor.y - OWL_SIZE / 2);
  void owl.offsetWidth;
  owl.classList.add("visible");
  setTimeout(() => {
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;

    let finalX = targetCenterX + OWL_OFFSET_X;
    let finalY = targetCenterY + OWL_OFFSET_Y;

    finalX = Math.max(EDGE_PADDING, Math.min(finalX, VW - OWL_SIZE - EDGE_PADDING));
    finalY = Math.max(EDGE_PADDING, Math.min(finalY, VH - OWL_SIZE - EDGE_PADDING));

    placeOwl(finalX, finalY);

    setTimeout(() => {
      owl.classList.add("bob");
    }, 650);
  }, 16);
});

window.guideOverlay?.onSetOwlMode(({ mode }) => {
  owl.classList.toggle("thinking", mode === "thinking");
  owl.classList.toggle("pointing", mode === "pointing");
});

window.guideOverlay?.onHide(() => {
  owl.classList.remove("visible", "bob", "thinking", "pointing");
  hideBubble();
});

// --- Bubble UI ---

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let currentOwlX = 0;
let currentOwlY = 0;

function clearInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function startInactivityTimer() {
  clearInactivityTimer();
  inactivityTimer = setTimeout(() => {
    bubble.classList.add("faded");
  }, 5000);
}

function showBubble() {
  bubble.classList.remove("faded");
  bubble.classList.add("visible");
  startInactivityTimer();
}

function hideBubble() {
  clearInactivityTimer();
  bubble.classList.remove("visible", "faded");
  setTimeout(() => {
    if (!bubble.classList.contains("visible")) {
      bubble.style.display = "none";
    }
  }, 300);
}

function positionBubble() {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const bubbleRect = bubble.getBoundingClientRect();

  // Default: to the right of owl
  let bx = currentOwlX + OWL_SIZE + 12;
  let by = currentOwlY + 8;

  // Horizontal edge check
  if (bx + bubbleRect.width > VW - 10) {
    bx = currentOwlX - bubbleRect.width - 12;
  }
  if (bx < 10) bx = 10;

  // Vertical edge check
  if (by + bubbleRect.height > VH - 10) {
    by = currentOwlY - bubbleRect.height - 8;
  }
  if (by < 10) by = 10;

  bubble.style.left = `${bx}px`;
  bubble.style.top = `${by}px`;

  // Calculate centers to determine tail direction
  const bubbleCX = bx + bubbleRect.width / 2;
  const bubbleCY = by + bubbleRect.height / 2;
  const owlCX = currentOwlX + OWL_SIZE / 2;
  const owlCY = currentOwlY + OWL_SIZE / 2;

  // Vector from bubble center to owl center
  const dx = owlCX - bubbleCX;
  const dy = owlCY - bubbleCY;

  // Determine primary direction: tail points from bubble toward owl
  let tailDir;
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal dominant
    tailDir = dx > 0 ? "right" : "left";
  } else {
    // Vertical dominant
    tailDir = dy > 0 ? "bottom" : "top";
  }

  // Apply tail direction class
  bubble.classList.remove("tail-left", "tail-right", "tail-top", "tail-bottom");
  bubble.classList.add(`tail-${tailDir}`);
}

window.guideOverlay?.onBubbleShow(({ caption, options, theme }) => {
  // Update content
  bubbleCaption.textContent = caption;
  bubbleCaption.style.display = caption ? "block" : "none";
  bubbleLoading.style.display = "none";

  // Build buttons
  bubbleButtons.innerHTML = "";
  options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "guide-bubble-btn";
    btn.textContent = opt;

    // Style based on option text
    const lower = opt.toLowerCase();
    if (lower.includes("cancel") || lower.includes("stop") || lower.includes("abort")) {
      btn.classList.add("cancel");
    } else if (idx === 0 && options.length <= 3) {
      btn.classList.add("primary");
    } else {
      btn.classList.add("secondary");
    }

    btn.addEventListener("click", () => {
      window.guideOverlay?.sendChoice(opt);
    });
    bubbleButtons.appendChild(btn);
  });
  bubbleButtons.style.display = options.length > 0 ? "flex" : "none";

  // Apply theme
  bubble.classList.remove("light", "dark");
  bubble.classList.add(theme === "dark" ? "dark" : "light");

  // Show and position
  bubble.style.display = "block";
  // Force layout to get correct size
  void bubble.offsetWidth;
  positionBubble();
  showBubble();
});

window.guideOverlay?.onBubbleHide(() => {
  hideBubble();
});

window.guideOverlay?.onBubbleFade(({ opacity }) => {
  if (opacity <= 0.35) {
    bubble.classList.add("faded");
  } else {
    bubble.classList.remove("faded");
  }
});

// Hover detection for bubble
bubble.addEventListener("mouseenter", () => {
  bubble.classList.remove("faded");
  clearInactivityTimer();
  window.guideOverlay?.setIgnoreMouseEvents(false);
});

bubble.addEventListener("mouseleave", () => {
  startInactivityTimer();
  // Small delay to prevent flickering when moving between bubble elements
  setTimeout(() => {
    if (!bubble.matches(':hover')) {
      window.guideOverlay?.setIgnoreMouseEvents(true);
    }
  }, 50);
});

// Track owl position for bubble positioning
const observer = new MutationObserver(() => {
  const left = parseInt(owl.style.left || "0", 10);
  const top = parseInt(owl.style.top || "0", 10);
  if (left !== currentOwlX || top !== currentOwlY) {
    currentOwlX = left;
    currentOwlY = top;
    if (bubble.classList.contains("visible")) {
      positionBubble();
    }
  }
});
observer.observe(owl, { attributes: true, attributeFilter: ["style"] });

// --- Loading spinner (existing) ---

const loading = document.getElementById("loading") as HTMLDivElement;

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
