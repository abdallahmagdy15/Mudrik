# Stage 2: Cursor-Based Guide Mode — Design Spec

**Date:** 2026-05-24  
**Branch:** `feat/guide-stage-2-cursor-ui`  
**Goal:** Move guide interaction from the panel to a speech bubble near the owl cursor, keeping the panel as an optional fallback.

---

## 1. Overview

The current guide mode shows action buttons inside the Mudrik panel (`ChatInputOptions`). This requires the user to look away from the target element to the panel (often on another monitor or far away).

**Stage 2 introduces a speech bubble** anchored to the owl cursor that appears near the target element. The user can interact with the guide without looking away from their screen.

The panel remains available as a mirror — same options, same state — but is no longer the primary interaction surface during guide steps.

---

## 2. User Experience

### 2.1 Phases

| Phase | What User Sees | Bubble? | Panel? |
|-------|----------------|---------|--------|
| `idle` | Nothing | No | Hidden |
| `offer` | Panel shows offer summary + "Start" / "Cancel" | No | Visible |
| `step-active` | Owl animates to target, **bubble appears** with caption + buttons | **Yes** | Auto-hidden |
| `waiting` | Bubble shrinks to loading dots ("...") | Compact | Hidden |
| `recapturing` | Bubble shows "Scanning..." or loading spinner | Compact | Hidden |
| `awaiting-ai` | Bubble shows loading dots | Compact | Hidden |
| `idle` (complete/abort) | Bubble disappears, panel may show final message | No | Visible if open |

### 2.2 Speech Bubble Layout

```
┌──────────────────────────────┐
│  Click the "Save" button     │  ← caption (small, readable)
│                              │
│  [Done]  [Skip]  [Help]      │  ← buttons (rounded pill)
└──────────────┘
               ↑
            (tail pointer)
```

**Default position:** Below-right of owl cursor  
**Smart flipping:**
- No space below → flip above
- No space right → flip left
- Both constrained → center on screen, minimize size

### 2.3 Inactivity Behavior

- After **5 seconds** without hover: bubble fades to **30% opacity**
- Hover: bubble restores to **100% opacity**
- During `waiting`/`recapturing`/`awaiting-ai`: bubble shrinks to compact loading state

### 2.4 Loading State

```
┌────────┐
│  ...   │  ← three animated dots
└────┘
```

### 2.5 Clicking the Owl

- **Left-click** on owl character → opens full Mudrik panel
- Panel shows the same options as the bubble (mirrored state)
- User can interact via panel OR bubble — both work

### 2.6 Theme Support

Bubble follows Mudrik's current theme:
- **Light theme**: White background, dark text, subtle shadow
- **Dark theme**: Dark semi-transparent background, white text, subtle border
- Tail pointer matches bubble background

---

## 3. Architecture

### 3.1 Components

| File | Role | Changes |
|------|------|---------|
| `guide-overlay.html` | Overlay DOM | Add bubble container, caption, button row, tail element |
| `guide-overlay-renderer.ts` | Overlay logic | Handle `guide-overlay-show-bubble` IPC, render buttons, manage hover/fade |
| `guide-overlay.ts` | Main overlay | Enable hit-testing for bubble region; keep rest click-through |
| `guide-controller.ts` | State machine | Push caption+options to overlay in addition to panel |
| `ipc-handlers.ts` | IPC wiring | Mirror `guide-state-update` to overlay; no breaking changes |

### 3.2 IPC Events

**New:**
- `guide-overlay-show-bubble` → `{ caption, options, stepIndex?, estStepsLeft? }`
- `guide-overlay-hide-bubble` → `{}`
- `guide-overlay-set-loading` → `{ text? }`
- `guide-overlay-fade` → `{ opacity: number }`

**Existing (unchanged):**
- `guide-overlay-show` / `guide-overlay-hide` (owl animation)
- `guide-state-update` (panel)
- `guide-user-choice` (renderer → main)

### 3.3 Hit-Testing Strategy

The overlay window covers the entire virtual desktop and is normally click-through (`setIgnoreMouseEvents(true)`).

For the bubble:
- Calculate bubble bounds in screen coordinates
- Call `setIgnoreMouseEvents(false)` when mouse is over bubble bounds
- Call `setIgnoreMouseEvents(true)` when mouse leaves bubble bounds
- This is done via a **mouse-move listener** in the overlay renderer that polls mouse position and calls `window.electron.setIgnoreMouseEvents(shouldIgnore)`

Alternative: Use `setIgnoreMouseEvents(true, { forward: true })` and let the renderer handle all clicks, forwarding non-bubble clicks to the underlying app. Simpler but requires the renderer to know what's clickable.

**Decision:** Use the polling approach — it's more reliable and doesn't require the renderer to understand the underlying app's hit regions.

---

## 4. Visual Design

### 4.1 Bubble CSS

```css
.guide-bubble {
  position: absolute;
  padding: 10px 14px;
  border-radius: 12px;
  font-family: -apple-system, Segoe UI, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  max-width: 280px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  transition: opacity 300ms ease, transform 300ms ease;
  pointer-events: auto; /* bubble is clickable */
}

/* Light theme */
.guide-bubble.light {
  background: rgba(255, 255, 255, 0.95);
  color: #1a1a1a;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

/* Dark theme */
.guide-bubble.dark {
  background: rgba(30, 30, 30, 0.92);
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.guide-bubble-buttons {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.guide-bubble-btn {
  padding: 5px 12px;
  border-radius: 16px; /* pill shape */
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 100ms, opacity 150ms;
}

.guide-bubble-btn:hover {
  transform: scale(1.05);
}

.guide-bubble-btn:active {
  transform: scale(0.95);
}

/* Tail pointer */
.guide-bubble-tail {
  position: absolute;
  width: 12px;
  height: 12px;
  background: inherit;
  transform: rotate(45deg);
}
```

### 4.2 Button Colors

- **Primary** ("Done", "Start"): Accent color `#18BFE1` background, white text
- **Secondary** ("Skip", "Help"): Transparent background, themed text + border
- **Cancel** ("Cancel", "Stop"): Subtle red tint or gray

### 4.3 Animations

- Bubble entrance: `translateY(8px) → translateY(0)`, `opacity: 0 → 1`, 250ms ease-out
- Bubble exit: `opacity: 1 → 0`, 200ms ease-in
- Button hover: `scale(1.05)`, 100ms
- Loading dots: pulsing animation, 1.2s loop

---

## 5. State Synchronization

The bubble and panel must show the **same options** and be in the **same phase**.

**Approach:** Single source of truth in `guide-controller.ts`. When the controller transitions to `step-active`, it:
1. Sends `guide-state-update` to the panel (existing)
2. Sends `guide-overlay-show-bubble` to the overlay (new)

When the user clicks a bubble button, the overlay renderer sends `guide-user-choice` via IPC — **same event** as panel buttons. The controller doesn't know or care where the click came from.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|----------|
| User clicks panel button while bubble is visible | Both work — controller handles `guide-user-choice` regardless of source |
| User clicks owl during step | Opens panel; bubble stays visible; user can use either |
| Screen edge clips bubble | Smart flip to available space; if none, center on screen |
| Bubble would cover target element | Flip to opposite side of target |
| AI takes >5s to respond | Bubble shows loading dots; doesn't auto-hide during loading |
| User hovers bubble during inactivity fade | Immediate restore to 100% opacity |
| User opens panel manually during guide | Bubble stays visible; both interfaces active |

---

## 7. Implementation Phases

### Phase 1: Bubble UI Foundation
- Add bubble HTML/CSS to `guide-overlay.html`
- Add bubble rendering logic to `guide-overlay-renderer.ts`
- Support show/hide/fade/loading states
- **Test:** Bubble appears, disappears, fades correctly

### Phase 2: Button Integration
- Add button rendering and click handlers
- Wire button clicks to `guide-user-choice` IPC
- Support theme switching
- **Test:** Clicking bubble buttons advances guide

### Phase 3: Smart Positioning
- Implement edge detection and flip logic
- Calculate bubble bounds relative to owl and screen edges
- **Test:** Bubble never clips off-screen

### Phase 4: Hit-Testing
- Enable selective interactivity for bubble region
- Implement mouse polling for hit-test
- **Test:** Clicks on bubble work; clicks outside pass through to app

### Phase 5: Mirror with Panel
- Ensure panel still receives `guide-state-update`
- Ensure owl-click opens panel
- **Test:** Panel and bubble are synchronized

### Phase 6: Polish
- Add loading dot animation
- Add entrance/exit transitions
- Test on multi-monitor setup
- Test with different DPI scales

---

## 8. Testing Checklist

- [ ] Bubble appears on `step-active` phase
- [ ] Bubble shows correct caption and buttons
- [ ] Clicking bubble button advances guide
- [ ] Bubble fades after 5s inactivity, restores on hover
- [ ] Loading state appears during `waiting`/`awaiting-ai`
- [ ] Smart positioning: never clips screen edge
- [ ] Theme-aware: correct colors in light/dark mode
- [ ] Hit-testing: bubble is clickable, rest is click-through
- [ ] Owl-click opens panel
- [ ] Panel buttons still work (mirror)
- [ ] Multi-monitor: bubble appears on correct display
- [ ] High-DPI: bubble scales correctly

---

## 9. Open Questions

1. **Should the bubble auto-advance if the user clicks the target element directly?** (e.g., clicks the "Save" button being guided) — This would require re-enabling the mouse hook or adding a click listener. Defer to Stage 3.

2. **Should the bubble show a progress bar or step counter?** ("Step 3 of 5") — Currently not in design; can be added later if user requests.

3. **Should there be keyboard shortcuts for bubble buttons?** (e.g., Enter = first button, Esc = cancel) — Nice-to-have for accessibility; defer to Stage 3.

---

**Status:** ✅ Design approved. Ready for implementation planning.
