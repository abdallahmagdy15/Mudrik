# Screenshot Enhancement Plan

## Problem
When Mudrik auto-attaches a screenshot for Chromium/Electron apps, the AI prompt doesn't tell the model:
1. What screen resolution + DPI scale the image was captured at
2. That it should estimate pixel coordinates from the screenshot
3. That for non-Chromium apps with manual screenshots, it should also be told to use image coords as fallback
4. Area selection (Ctrl+Space) lacks coordinate/resolution context and doesn't handle Chromium apps

## Solution: 3-tier prompt system for screenshots

### Tier 1: Chromium auto-screenshot
**When**: `shouldAutoScreenshot=true` (window class matches Chrome/Mozilla/CEF/Edge)
**Prompt**: "Screenshot IS the primary source. UIA tree may miss web content. Screen: W×H @scale×. left≈0, right≈W, top≈0, bottom≈H. Estimate pixel coordinates from screenshot for any element you reference."

### Tier 2: Manual screenshot (autoAttachImage ON, non-Chromium)
**When**: User toggled autoAttachImage ON, window is NOT Chromium
**Prompt**: "Screenshot attached for visual reference. If a target element isn't in the UIA tree above, estimate its approximate pixel coordinates from the image. Screen: W×H @scale×."

### Tier 3: Area selection
**Always**: Include area coordinates, area dimensions, screen resolution, DPI scale
**Chromium bonus**: Capture full-screen screenshot alongside area screenshot, add Tier 1 guidance
**Non-Chromium**: Just area screenshot with Tier 2 guidance about coordinate estimation

## Implementation

### State tracking (ipc-handlers.ts)
Replace `chromiumAutoScreenshot: boolean` + `chromiumScreenInfo` with:
```
screenshotMode: "none" | "chromium-auto" | "manual" | "area-chromium" | "area"
screenInfo: { logicalWidth, logicalHeight, scaleFactor } | null
```

### Files to change

1. **`ipc-handlers.ts`**
   - Replace `chromiumAutoScreenshot`/`chromiumScreenInfo` with unified `screenshotMode`/`screenInfo`
   - Export `setScreenshotMode(mode, screenInfo)` and `resetScreenshotMode()`
   - Update SEND_PROMPT prompt builder to use 3-tier messaging
   - Update area context block to include coordinates + resolution

2. **`index.ts`** (handlePointerActivate)
   - `autoAttachImage ON` path: also capture screen info, call `setScreenshotMode("manual", screenInfo)`
   - `shouldAutoScreenshot` path: call `setScreenshotMode("chromium-auto", screenInfo)` (already mostly done)
   - `else` path: call `setScreenshotMode("none", null)`

3. **`index.ts`** (handleAreaActivate)
   - After scanArea, capture full-screen screenshot if `lastShouldAutoScreenshot` (module-level flag from pointer context)
   - Pass `area-chromium` or `area` mode accordingly
   - Store screen info during area activation

4. **`index.ts`** (area context prompt)
   - Add area coordinates `(x1,y1)-(x2,y2)`, area size, screen resolution, DPI scale
   - For Chromium area: add "full-screen screenshot also attached, UIA may miss web content"

5. **`context-reader.ts`**
   - Already returns `shouldAutoScreenshot` — no changes needed
   - Bump SCRIPT_NAME to v31 (already done)

### Prompt templates

**Chromium auto (pointer):**
> [A full-screen screenshot is attached. This is a Chromium/Electron app — the UIA tree may NOT show web content (chat, scroll areas, pages). THE SCREENSHOT IS THE PRIMARY SOURCE for what's on screen. Screen: 1920×1080 @1.5× (left≈0, right≈1920, top≈0, bottom≈1080). Estimate pixel coordinates from the screenshot for any element you reference.]

**Manual screenshot (pointer, non-Chromium):**
> [A screenshot is attached. If a target element isn't listed in the UIA tree above, you can estimate its approximate pixel position from the image. Screen: 1920×1080 @1.5×.]

**Area selection (non-Chromium):**
> [A screenshot of the selected area is attached. Area: (380,420) to (1200,890), size 820×470 pixels. Full screen: 1920×1080 @1.5×. If a target element isn't in the list above, estimate its position from the image.]

**Area selection (Chromium):**
> [A screenshot of the selected area AND a full-screen screenshot are attached. This is a Chromium/Electron app — the UIA tree may NOT show web content. THE FULL-SCREEN SCREENSHOT IS THE PRIMARY SOURCE. Area: (380,420) to (1200,890), size 820×470 pixels. Full screen: 1920×1080 @1.5× (left≈0, right≈1920, top≈0, bottom≈1080). Estimate pixel coordinates from the screenshots for any element you reference.]

## Open questions
- Should we also include DPI scale factor info so AI can convert between physical/logical pixels? — Yes, included as `@1.5×`
- Should area selection for Chromium capture a full-screen screenshot synchronously (adds ~1-2s latency)? — Yes, worth it for content visibility

---

## Phase 2: Coordinate Resolution Strategy (NEW)

### Problem
The current `resolveElementBounds` mechanism has a fatal flaw: when the AI provides a selector that doesn't match the UIA tree (common with screenshots), the PowerShell script falls back to `FindClosestSpatial` — picking the nearest clickable element to the AI's `boundsHint`. This produces completely wrong results (e.g., cursor goes to x=18 when target is at x=1085).

### Requirements

1. **Dual Bounds System**: AI must provide BOTH:
   - `uiaBounds`: `{x, y, width, height}` — bounds copied from the UIA tree (high confidence, pixel-perfect)
   - `guessBounds`: `{x, y, width, height}` — coordinates estimated from screenshot (for Chromium/web content where UIA is blind)

2. **Resolution Priority** (hardcoded in code, not AI choice):
   - **Step 1**: Search UIA tree for exact match using `selector`/`automationId`
   - **Step 2**: If exact match found with score ≥ 85 → use UIA bounds (pixel-perfect)
   - **Step 3**: If no exact match AND `guessBounds` provided → use `guessBounds`
   - **Step 4**: If neither → return `null` (no cursor/guide). **Better no guide than wrong guide.**

3. **NO Spatial Fallback**: Remove the `FindClosestSpatial` PowerShell function that picks arbitrary nearby elements. If UIA can't find the element by name/ID, we don't guess spatially.

4. **Prompt Requirements**:
   - When UIA tree is available: AI must copy exact bounds from the UIA candidate list into `uiaBounds`
   - When screenshot is primary source: AI must estimate coordinates into `guessBounds`
   - AI should set `target.uiaBounds` when confident from tree, `target.guessBounds` when from screenshot
   - If neither available → set `target: null` (no pointer)

5. **Per-Action-Type Behavior**:
   - `guide_to`: Uses dual bounds resolution. Shows owl pointer only when valid bounds found.
   - `click_element`: Uses same resolution. Clicks exact UIA element or falls back to guess.
   - All other actions (type, paste, invoke): unaffected — they target by selector/name.

### Implementation

1. **Type changes** (`shared/types.ts`):
   - Add `uiaBounds` and `guessBounds` optional fields to `Action` interface
   - Add `uiaBounds` and `guessBounds` optional fields to `GuideStepPayload.target`

2. **Prompt changes** (`shared/prompts.ts`):
   - Update guide mode contract to require dual bounds
   - Update action examples to show both `uiaBounds` and `guessBounds`
   - Emphasize: "If you copied bounds from UIA tree → uiaBounds. If you estimated from screenshot → guessBounds."

3. **PowerShell script** (`action-executor-heavy.ts`):
   - Remove `FindClosestSpatial` function entirely
   - Keep `FindElement` for exact name/ID matching
   - Score threshold: only return matches with score ≥ 85
   - If no matches ≥ 85 → return empty (not spatial fallback)

4. **Resolution logic** (`action-executor-heavy.ts`):
   - `resolveElementBounds()` new algorithm:
     ```
     1. Try UIA exact match (findElementBounds with score ≥ 85)
     2. If found → return UIA bounds
     3. If not found AND guessBounds exists → return guessBounds
     4. Return null
     ```
   - Remove `MIN_ACCEPTABLE_MATCH_SCORE = 75` (now 85, or use UIA directly)

5. **Validation** (`action-executor.ts`):
   - Accept both `uiaBounds` and `guessBounds` in parsed actions
   - Normalize `left`/`top` → `x`/`y` for both fields

### Success Criteria
- Pointing at Chromium app + asking "click the send button" → AI estimates coordinates from screenshot, provides `guessBounds`, cursor lands near send button
- Pointing at native app + asking "click Save" → AI copies `uiaBounds` from UIA tree, cursor lands pixel-perfect on Save button
- Pointing at any app + asking "click NonExistentWidget" → UIA search fails, no `guessBounds`, action fails gracefully (no cursor, error message)
- Old behavior (single `boundsHint`) still works backward-compatibly
