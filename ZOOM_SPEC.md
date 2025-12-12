# Mobile Zoom & Pan Implementation Specification

## Problem Statement

Current cell sizes on mobile (20-24px) are below the WCAG 44x44px guideline for comfortable touch targets. For larger puzzles (15x15+), precise cell selection becomes difficult. The solution is pinch-to-zoom with pan, allowing users to zoom in for comfortable interaction while maintaining the ability to see the full puzzle.

## Critical Constraint: Large Clue Sets

Puzzles can have up to **15 clues per row/column** (checkerboard patterns). This creates a space problem:

| Clue Count | Row Clue Width | Column Clue Height |
|------------|----------------|-------------------|
| 5 clues | ~80px | ~70px |
| 10 clues | ~160px | ~140px |
| 15 clues | ~240px | ~210px |

On a 375px phone screen with 15 clues:
- Row clues: 240px → only 135px left for grid
- At 2x zoom (48px cells): only ~2.8 cells visible
- **Sticky clues would defeat the purpose of zooming**

This constraint fundamentally shapes our approach.

## Design Principles

1. **Native feel** - Gestures should feel like standard iOS/Android zoom behavior
2. **Grid takes priority when zoomed** - Maximize cell visibility, clues are secondary
3. **Contextual clue access** - Show relevant clues on demand, not all clues always
4. **Drawing takes priority** - Single-finger gestures on cells = drawing, not panning
5. **Minimal UI intrusion** - Floating controls should be subtle, not distracting
6. **Cozy aesthetic preserved** - No jarring transitions or aggressive UI

---

## UX Journey Analysis

### Discovery Problem

**Issue:** Users may never discover zoom exists, continuing to struggle with small cells.

**User expectations:**
- Pinch-to-zoom is familiar from Photos/Maps apps
- But users might not think to try it in a puzzle game
- They might assume small cells are "just how it is"

**Solutions:**
1. **Gentle onboarding hint** - On first large puzzle (>10x10), show a subtle toast:
   "Tip: Pinch to zoom for easier tapping"
2. **Show hint after struggle** - If user taps same cell 3+ times rapidly (mis-tap detection), show hint
3. **Always-visible zoom controls** - Even at 1.0x, show zoom buttons at reduced opacity (40%)

**Recommendation:** Option 3 (always-visible controls) + Option 1 (first-time hint) for large puzzles.

### Tooltip Positioning Problem

**Issue:** Tooltip at fixed bottom position may obscure cells user is working on.

```
Scenario: User working on bottom rows while zoomed

┌──────────────────────────────────┐
│         (scrolled up)            │
│    ┌──────────────────────┐      │
│    │  row 12  [x][x][ ]   │      │
│    │  row 13  [ ][x][x]   │ ← Working here
│    │  row 14  [x][ ][x]   │
│    └──────────────────────┘      │
│  ┌─────────────────────────┐     │
│  │ Row 14: 1 1 1           │ ← Tooltip covers row 14!
│  │ Col 5:  2 1             │
│  └─────────────────────────┘     │
└──────────────────────────────────┘
```

**Solution:** Dynamic tooltip positioning based on touch location.

```javascript
function positionTooltip(touchY, containerRect) {
  const tooltip = document.getElementById('clue-tooltip');
  const containerMidpoint = containerRect.top + containerRect.height / 2;

  if (touchY > containerMidpoint) {
    // Touch in bottom half → show tooltip at TOP
    tooltip.classList.add('position-top');
    tooltip.classList.remove('position-bottom');
  } else {
    // Touch in top half → show tooltip at BOTTOM
    tooltip.classList.remove('position-top');
    tooltip.classList.add('position-bottom');
  }
}
```

```css
.clue-tooltip.position-bottom {
  bottom: calc(var(--safe-area-bottom) + 160px);
  top: auto;
}

.clue-tooltip.position-top {
  top: calc(var(--safe-area-top) + 120px); /* Below palette/mode toggle */
  bottom: auto;
}
```

### Tooltip During Drag Problem

**Issue:** During drag-to-fill, tooltip updates rapidly as finger crosses cells, causing visual noise.

**Scenario:**
1. User touches cell (5,3) → tooltip shows Row 5, Col 3
2. User drags to (5,4) → tooltip updates to Col 4
3. User drags to (5,5) → tooltip updates to Col 5
4. ... rapid updates, distracting

**Solution:** Freeze tooltip during drag, only update on new touch.

```javascript
let isDragging = false;
let tooltipLocked = false;

cell.ontouchstart = (e) => {
  isDragging = false;
  tooltipLocked = false;
  updateTooltip(row, col);  // Show tooltip for initial cell
  showTooltip();
};

cell.ontouchmove = (e) => {
  isDragging = true;
  tooltipLocked = true;  // Lock tooltip to initial cell during drag
  // Don't call updateTooltip during drag
};

cell.ontouchend = () => {
  isDragging = false;
  tooltipLocked = false;
  startTooltipDismissTimer();
};
```

**Alternative:** Fade tooltip to 30% opacity during drag, restore on touchend.

### Accidental Pan vs Draw Problem

**Issue:** User wants to draw but accidentally pans, or wants to pan but accidentally draws.

**Scenario A - Accidental Pan:**
- User's finger lands slightly outside cell boundary
- System interprets as pan gesture
- Grid scrolls unexpectedly

**Scenario B - Accidental Draw:**
- User wants to pan
- Finger touches edge of a cell
- Cell gets filled unexpectedly

**Current design mitigations:**
- Cells capture touch events with `stopPropagation()`
- Only non-cell areas trigger pan
- Two-finger always pans (regardless of where fingers land)

**Additional safeguard:**
```javascript
// Require intentional movement before committing to pan
let panStartX, panStartY;
let panThreshold = 10; // pixels
let isPanning = false;

container.ontouchmove = (e) => {
  if (e.touches.length === 1 && !e.target.classList.contains('cell')) {
    const dx = Math.abs(e.touches[0].clientX - panStartX);
    const dy = Math.abs(e.touches[0].clientY - panStartY);

    if (!isPanning && (dx > panThreshold || dy > panThreshold)) {
      isPanning = true;  // Now commit to pan mode
    }

    if (isPanning) {
      // Actually scroll
    }
  }
};
```

### Zoom State on Game Events

**Issue:** What happens to zoom when victory, reset, or solution is triggered?

| Event | Current Zoom | Expected Behavior |
|-------|--------------|-------------------|
| Victory | 2.0x | Reset to 1.0x, show full completed puzzle |
| Reset | 2.0x | Reset to 1.0x, fresh start |
| Show Solution | 2.0x | Reset to 1.0x, reveal full picture |
| Navigate Away | 2.0x | Reset to 1.0x |
| Switch Puzzle | 2.0x | Reset to 1.0x |

**Implementation:**
```javascript
// In game.js victory handler
function handleVictory() {
  if (window.CozyZoom?.isZoomed()) {
    window.CozyZoom.resetZoom(true);  // Animated reset
  }
  // Then show victory animation
}

// In game.js reset handler
function resetPuzzle() {
  if (window.CozyZoom) {
    window.CozyZoom.resetZoom(false);  // Instant reset
  }
  // Then clear grid
}
```

### One-Handed Use Consideration

**Issue:** Pinch-to-zoom requires two hands or awkward grip.

**Current mitigations:**
- Double-tap zoom (one-handed)
- Zoom buttons (one-handed)
- One-finger pan on non-cell areas

**Additional consideration:** Button placement for thumb reach.

```
Right-handed user's thumb reach zone:
┌─────────────────────────────────┐
│ Hard        │ Medium │  Hard   │
│ to reach    │        │ to reach│
├─────────────┼────────┼─────────┤
│             │        │         │
│   Medium    │  Easy  │ Medium  │
│             │        │         │
├─────────────┼────────┼─────────┤
│ Medium      │  Easy  │  Easy   │  ← Bottom-right is good for
│             │        │   [+]   │     right-handed users
│             │        │   [-]   │
│             │        │   [⊡]   │
└─────────────┴────────┴─────────┘
```

Bottom-right placement works for right-handed majority. Left-handed users can still reach (less ideal but functional). Buttons are 44px, adequate touch targets.

### Large Puzzle Initial View Problem

**Issue:** A 15x15 puzzle at 1.0x might not fully fit on screen, causing confusion.

**Scenario:**
1. User opens 15x15 puzzle
2. At 24px cells: 360px grid width + ~150px clues = 510px
3. On 375px phone: grid is clipped
4. User might not realize they can scroll OR zoom

**Solutions:**

**Option A - Auto-fit:** Calculate zoom that fits entire puzzle, start there.
```javascript
function calculateFitZoom(puzzle, containerWidth, containerHeight) {
  const baseCellSize = 24;
  const clueWidth = estimateClueWidth(puzzle);
  const clueHeight = estimateClueHeight(puzzle);

  const availableWidth = containerWidth - clueWidth - 20;
  const availableHeight = containerHeight - clueHeight - 20;

  const fitZoomX = availableWidth / (puzzle.width * baseCellSize);
  const fitZoomY = availableHeight / (puzzle.height * baseCellSize);

  return Math.min(fitZoomX, fitZoomY, 1.0);  // Never exceed 1.0 on initial
}
```

**Option B - Scroll indicators:** Show subtle gradient/shadow at edges where content continues.

**Recommendation:** Option A (auto-fit) with MIN_ZOOM adjusted to 0.7 for large puzzles. This ensures user always sees full puzzle initially, can zoom in as needed.

### Returning to Overview Problem

**Issue:** User is zoomed in, wants to see full puzzle to assess progress.

**Current options:**
- Pinch out to 1.0x (two hands)
- Double-tap non-cell area (might be hard to find)
- Tap fit button (if they know it exists)

**Improvement:** Make fit button more prominent when zoomed.

```css
/* Normal state */
.zoom-btn.zoom-fit {
  opacity: 0.6;
}

/* When zoomed, emphasize fit button */
.zoom-container.is-zoomed ~ .zoom-controls .zoom-btn.zoom-fit {
  opacity: 1;
  background: var(--color-primary-light);
  animation: gentle-pulse 2s infinite;
}

@keyframes gentle-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
```

### Information Overload in Tooltip

**Issue:** Tooltip with 10+ colored clue numbers might be overwhelming.

**Example of complex tooltip:**
```
Row 8:  [3][2][1][1][2][3][1][2][1][1]  ← 10 clue numbers with colors
Col 12: [1][4][2][1][1][2]              ← 6 clue numbers with colors
```

**Mitigations:**
1. Keep tooltip compact - single row per line, horizontal scroll if needed
2. Use color backgrounds subtly (pastel, not saturated)
3. Satisfaction strikethrough reduces visual weight
4. Consider: Only show first/last N clues with "..." if > 8 clues

**Recommendation:** Keep full clues (users need all info), but:
- Horizontal scroll for overflow
- Subtle color indicators (border or dot, not full background)
- Larger font (14-16px) for readability

### Muscle Memory and Consistency

**Issue:** Users have zoom expectations from other apps.

**iOS Photos app behavior:**
- Pinch zooms centered on fingers ✓
- Double-tap toggles between fit and "smart zoom" ✓
- Two-finger pan while zoomed ✓
- Single-finger pan while zoomed ✓

**Our differences:**
- Single-finger on grid = DRAW, not pan
- This is necessary but might surprise users initially

**Mitigation:** The behavior is intuitive once understood (tap/drag on cells to fill), and matches drawing app conventions (Procreate, etc.) rather than photo viewing conventions.

---

### UX Decisions Summary

| Issue | Decision |
|-------|----------|
| Discovery | Always-visible zoom controls (40% opacity) + first-time hint |
| Tooltip position | Dynamic: top when touching bottom half, bottom when touching top half |
| Tooltip during drag | Freeze content, fade to 40% opacity |
| Accidental pan | Require 10px movement threshold before committing to pan |
| Game events | Reset zoom on victory/reset/solution/navigate (animated where appropriate) |
| Button placement | Bottom-right (optimal for right-handed majority) |
| Large puzzles | Auto-fit to show entire puzzle on load |
| Return to overview | Fit button pulses when zoomed to draw attention |
| Long clue tooltips | Horizontal scroll, subtle color indicators |
| Drawing vs Photos conventions | Accept difference, matches drawing apps |

---

## Architecture Decision: CSS Transform vs Cell Resize

### Option A: CSS Transform (scale)
```javascript
grid.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
```
**Pros:** Simple, GPU-accelerated, smooth animations
**Cons:** Touch coordinates require translation, clue alignment complex, everything scales (including clues)

### Option B: Dynamic Cell Resize + Native Scroll
```javascript
document.documentElement.style.setProperty('--cell-size', `${baseSize * zoom}px`);
// Container becomes scrollable, native scroll handles panning
```
**Pros:** Native scroll momentum, CSS sticky works, no coordinate translation needed
**Cons:** May cause layout thrashing on rapid zoom, larger DOM reflows

### **Recommendation: Hybrid Approach**

Use **CSS Transform for zoom gestures** (smooth, no layout thrashing during pinch), then on gesture end, **apply the zoom as cell size change** for native scroll behavior.

```javascript
// During pinch gesture:
gridContainer.style.transform = `scale(${gestureZoom})`;

// On gesture end:
gridContainer.style.transform = '';
applyZoomLevel(currentZoom * gestureZoom);  // Updates --cell-size
```

This gives smooth pinch feedback while maintaining native scroll behavior.

---

## Zoom Mechanics

### Zoom Levels
| Level | Cell Size | Use Case |
|-------|-----------|----------|
| 1.0x (default) | 20-24px | Full puzzle view |
| 1.5x | 30-36px | Moderate zoom |
| 2.0x | 40-48px | Comfortable touch (~44px target) |
| 3.0x | 60-72px | Maximum zoom for precision |

```javascript
const MIN_ZOOM = 1.0;
const MAX_ZOOM = 3.0;
const COMFORTABLE_ZOOM = 2.0;  // ~44px cells
```

### Pinch-to-Zoom
- Standard two-finger pinch gesture
- Zoom center = midpoint between fingers (not screen center)
- Smooth scaling during gesture
- Snap to nearest 0.5x increment on release (optional, may feel jarring)

### Double-Tap Zoom
- Double-tap toggles between:
  - Current zoom → COMFORTABLE_ZOOM (2.0x), centered on tap point
  - Any zoom > 1.0 → 1.0x (fit to view)
- 300ms timeout between taps
- Animated transition (200-300ms)

### Zoom Controls (Accessibility)
Floating buttons for users who struggle with pinch:
```
[+] [-] [fit]
```
- Position: Bottom-right corner
- Opacity: 60% when idle, 100% on hover/focus
- Size: 44x44px each (touch-friendly)

---

## Pan Mechanics

### The Fundamental Tension
Single-finger touch must serve two purposes:
1. **Drawing** - filling/marking cells
2. **Panning** - moving the viewport when zoomed

### Solution: Context-Aware Touch Handling

| Gesture | On Cell | On Clue Area | On Empty Space |
|---------|---------|--------------|----------------|
| Single tap | Fill cell | No action | No action |
| Single drag | Draw continuous line | Pan | Pan |
| Two-finger drag | Pan | Pan | Pan |
| Pinch | Zoom | Zoom | Zoom |

**Key insight:** Drawing (drag on cells) takes priority. Users can pan by:
1. Two-finger drag anywhere
2. Single-finger drag on clue areas
3. Single-finger drag starting outside the grid

### Implementation
```javascript
// In cell touch handlers:
cell.ontouchstart = (e) => {
  if (e.touches.length > 1) return; // Let zoom handler take over
  e.stopPropagation(); // Prevent pan from starting
  // ... existing fill logic
};

// On zoom container (parent of board-wrapper):
zoomContainer.ontouchstart = (e) => {
  if (e.touches.length === 1 && !e.target.classList.contains('cell')) {
    startPan(e);
  }
};
```

### Native Scroll Approach
When using cell resize + overflow: auto:
- Browser handles pan/scroll natively
- Momentum scrolling built-in
- No custom pan tracking needed
- `overflow: auto` on zoom container when zoomed > 1.0

---

## Clue Behavior When Zoomed

### The Sticky Clue Problem

The naive approach (sticky clues) fails for large puzzles:

```
At 1.0x zoom:                    At 2.0x zoom with sticky clues:
┌─────────┬────────────┐         ┌─────────────────┬──────┐
│ corner  │ col clues  │         │     corner      │ col  │
├─────────┼────────────┤         ├─────────────────┤clues │
│  row    │            │         │                 │      │
│  clues  │   GRID     │         │   row clues     │ GRID │ ← Only 2-3 cells visible!
│         │            │         │                 │      │
└─────────┴────────────┘         └─────────────────┴──────┘
```

Sticky clues consume fixed viewport space while the grid scales up, leaving almost no room for cells.

### Solution: Scrolling Clues + Contextual Tooltip

**At 1.0x zoom:** Standard layout, clues fully visible alongside grid.

**At >1.0x zoom:**
1. Clues scroll WITH the grid (not sticky)
2. A **floating clue tooltip** shows the current row/column clues
3. Tooltip appears when touching cells or near the active area
4. Shows clue satisfaction state (strikethrough)

```
┌──────────────────────────────────┐
│ [Palette] [Pen/Pencil]           │
├──────────────────────────────────┤
│                                  │
│    ┌──────────────────────┐      │
│    │                      │      │
│    │        GRID          │      │  ← Full viewport for grid
│    │      (scrolls)       │      │
│    │                      │      │
│    └──────────────────────┘      │
│                                  │
│  ┌─────────────────────────┐     │
│  │ Row 5: 3 2 1 2 ✓        │     │  ← Floating clue tooltip
│  │ Col 8: 1 1 3 1          │     │
│  └─────────────────────────┘     │
│                                  │
│         [+] [-] [fit]            │
└──────────────────────────────────┘
```

### Clue Tooltip Behavior

**Trigger:** Shows when user touches a cell (appears after ~100ms to avoid flicker)

**Position:** Fixed at bottom of zoom container, above zoom controls

**Content:**
- Row clue for the touched cell's row
- Column clue for the touched cell's column
- Clue numbers with color indicators
- Strikethrough for satisfied clues

**Dismissal:** Fades out 1.5 seconds after touch ends

```javascript
// Example tooltip content
"Row 7:  3  2  1̶  2  3"   // 1 is struck through (satisfied)
"Col 12: 1  1  3̶  1"
```

### Clue Container Sizing

Even when scrolling, clues must align with their rows/columns. This means:

**Row clues:** Height matches `--cell-size` (scales with zoom)
**Column clues:** Width matches `--cell-size` (scales with zoom)
**Clue text:** Stays readable size, container scales

```css
.row-clues {
  height: var(--cell-size);  /* Matches grid row height */
  min-width: 60px;           /* Minimum for readability */
  /* Content uses flexbox to align clue numbers */
}

.col-clue {
  width: var(--cell-size);   /* Matches grid column width */
  min-height: 40px;          /* Minimum for readability */
}

/* Clue numbers don't scale excessively */
.clue-cell, .row-clue-cell {
  font-size: clamp(9px, calc(var(--cell-size) * 0.4), 14px);
}
```

### Alternative: Constrained Sticky (Fallback Option)

If tooltip approach proves too complex, a constrained sticky approach:

```css
.row-clues-wrapper {
  position: sticky;
  left: 0;
  max-width: 30vw;           /* Never exceed 30% of viewport */
  overflow-x: auto;          /* Scroll internally if needed */
}

.col-clues-wrapper {
  position: sticky;
  top: 0;
  max-height: 20vh;          /* Never exceed 20% of viewport */
  overflow-y: auto;          /* Scroll internally if needed */
}
```

With visual indicators (gradient fade) showing more clues exist:

```css
.row-clues-wrapper::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 20px;
  background: linear-gradient(to right, transparent, var(--color-bg-start));
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
}

.row-clues-wrapper.has-overflow::after {
  opacity: 1;
}
```

### Recommendation

**Primary approach:** Scrolling clues + contextual tooltip
- Maximizes grid space when zoomed
- Provides relevant information on demand
- Familiar pattern (many drawing/editing apps use contextual info panels)

**Fallback:** Constrained sticky with internal scroll
- More traditional, less implementation risk
- Still respects viewport constraints
- May feel cramped on complex puzzles

---

## Floating UI Elements

### Elements That Float (Fixed Position)

1. **Color Palette**
   - Position: Top of puzzle area, below header
   - Behavior: Always visible, not affected by zoom/pan
   - State: Full palette visible (current design works well)

2. **Mode Toggle (Pen/Pencil)**
   - Position: Below palette
   - Behavior: Always visible

3. **Zoom Controls** (new)
   - Position: Bottom-right corner
   - Design: Vertical stack of circular buttons
   ```
   [+]
   [-]
   [⊡] (fit to view)
   ```

4. **Undo/Redo**
   - Position: Bottom-left corner OR keep in current location
   - Behavior: Always visible

### Elements That Scroll With Content

1. **The entire board-wrapper** (grid + clues)
2. **Status message** - moves below grid, scrolls away when zoomed

### Elements Hidden When Zoomed (Optional)

1. **Instructions text** - already hidden on small screens
2. **Reset/Solution buttons** - could move to a menu

---

## DOM Structure Changes

### Current Structure
```html
<div class="game-container">
  <div class="palette">...</div>
  <div class="mode-toggle">...</div>
  <div class="board-wrapper">
    <div class="corner"></div>
    <div class="col-clues"></div>
    <div class="row-clues-container"></div>
    <div class="grid"></div>
  </div>
  <div class="status">...</div>
  <div class="controls">...</div>
</div>
```

### Proposed Structure
```html
<div class="game-container">
  <!-- Fixed UI (not affected by zoom) -->
  <div class="palette">...</div>
  <div class="mode-toggle">...</div>

  <!-- Zoomable/Scrollable area -->
  <div class="zoom-container" id="zoom-container">
    <div class="board-wrapper">
      <div class="corner"></div>
      <div class="col-clues"></div>
      <div class="row-clues-container"></div>
      <div class="grid"></div>
    </div>
  </div>

  <!-- Contextual clue tooltip (shown when zoomed and touching cells) -->
  <div class="clue-tooltip" id="clue-tooltip" aria-live="polite" aria-atomic="true">
    <div class="clue-tooltip-row">
      <span class="clue-tooltip-label">Row:</span>
      <span class="clue-tooltip-clues" id="tooltip-row-clues"></span>
    </div>
    <div class="clue-tooltip-col">
      <span class="clue-tooltip-label">Col:</span>
      <span class="clue-tooltip-clues" id="tooltip-col-clues"></span>
    </div>
  </div>

  <!-- Floating zoom controls -->
  <div class="zoom-controls" id="zoom-controls">
    <button class="zoom-btn zoom-in" aria-label="Zoom in">+</button>
    <button class="zoom-btn zoom-out" aria-label="Zoom out">−</button>
    <button class="zoom-btn zoom-fit" aria-label="Fit to view">⊡</button>
  </div>

  <div class="status">...</div>
  <div class="controls">...</div>
</div>
```

**Note:** No wrapper divs around clues - they scroll naturally with the board. The clue tooltip is a separate floating element.

---

## JavaScript Module: zoom.js

### Public API
```javascript
window.CozyZoom = {
  // Get current zoom level
  getZoom(): number,

  // Set zoom level (clamped to MIN/MAX)
  setZoom(level: number, animate?: boolean): void,

  // Zoom in by increment (default 0.5)
  zoomIn(increment?: number): void,

  // Zoom out by increment
  zoomOut(increment?: number): void,

  // Reset to 1.0x
  resetZoom(animate?: boolean): void,

  // Initialize zoom system for current puzzle
  init(): void,

  // Cleanup when leaving puzzle screen
  destroy(): void,

  // Check if currently zoomed
  isZoomed(): boolean,
};
```

### Internal State
```javascript
let currentZoom = 1.0;
let isPinching = false;
let pinchStartDistance = 0;
let pinchStartZoom = 1.0;
let lastTapTime = 0;
```

### Gesture Handlers

```javascript
function getDistance(touch1, touch2) {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(touch1, touch2) {
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  };
}

// Pinch start
container.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    isPinching = true;
    pinchStartDistance = getDistance(e.touches[0], e.touches[1]);
    pinchStartZoom = currentZoom;
    e.preventDefault();
  }
}, { passive: false });

// Pinch move
container.addEventListener('touchmove', (e) => {
  if (isPinching && e.touches.length === 2) {
    const distance = getDistance(e.touches[0], e.touches[1]);
    const scale = distance / pinchStartDistance;
    const newZoom = clamp(pinchStartZoom * scale, MIN_ZOOM, MAX_ZOOM);

    // Apply visual feedback (CSS transform)
    const visualScale = newZoom / currentZoom;
    boardWrapper.style.transform = `scale(${visualScale})`;
    boardWrapper.style.transformOrigin = getPinchOrigin(e);

    e.preventDefault();
  }
}, { passive: false });

// Pinch end
container.addEventListener('touchend', (e) => {
  if (isPinching) {
    isPinching = false;

    // Calculate final zoom
    const transform = boardWrapper.style.transform;
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    if (scaleMatch) {
      const visualScale = parseFloat(scaleMatch[1]);
      const newZoom = clamp(currentZoom * visualScale, MIN_ZOOM, MAX_ZOOM);

      // Reset transform and apply as cell size
      boardWrapper.style.transform = '';
      setZoom(newZoom, false);
    }
  }
});

// Double-tap detection
container.addEventListener('touchend', (e) => {
  if (e.touches.length === 0 && !isPinching) {
    const now = Date.now();
    if (now - lastTapTime < 300) {
      handleDoubleTap(e.changedTouches[0]);
      lastTapTime = 0;
    } else {
      lastTapTime = now;
    }
  }
});
```

### Applying Zoom
```javascript
function setZoom(level, animate = true) {
  const newZoom = clamp(level, MIN_ZOOM, MAX_ZOOM);
  const oldZoom = currentZoom;
  currentZoom = newZoom;

  // Calculate new cell size
  const baseCellSize = getBaseCellSize(); // 20-24px depending on viewport
  const newCellSize = Math.round(baseCellSize * newZoom);

  // Apply with optional animation
  if (animate) {
    zoomContainer.style.transition = 'all 0.2s ease-out';
  }

  document.documentElement.style.setProperty('--cell-size', `${newCellSize}px`);

  // Enable/disable scroll based on zoom
  zoomContainer.style.overflow = newZoom > 1 ? 'auto' : 'hidden';

  // Update button states
  updateZoomButtons();

  // Remove transition after animation
  if (animate) {
    setTimeout(() => {
      zoomContainer.style.transition = '';
    }, 200);
  }

  // Dispatch event for other modules
  window.dispatchEvent(new CustomEvent('zoomchange', {
    detail: { zoom: newZoom, oldZoom }
  }));
}
```

---

## CSS Changes

### New Styles for Zoom Container
```css
/* Zoom container wraps the board */
.zoom-container {
  position: relative;
  max-width: 100%;
  max-height: calc(var(--vh, 1vh) * 55); /* ~55% of viewport, leave room for tooltip */
  overflow: hidden; /* Changes to 'auto' when zoomed */
  touch-action: pan-x pan-y pinch-zoom;

  /* Smooth scroll on iOS */
  -webkit-overflow-scrolling: touch;

  /* Hide scrollbars but keep functionality */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.zoom-container::-webkit-scrollbar {
  display: none;
}

/* Zoomed state */
.zoom-container.is-zoomed {
  overflow: auto;
}

/* Board wrapper - no sticky positioning, everything scrolls together */
.zoom-container .board-wrapper {
  /* Existing grid layout preserved */
  /* Clues scroll with grid naturally */
}
```

### Clue Tooltip Styles
```css
/* Contextual clue tooltip - shows current row/column clues when zoomed */
.clue-tooltip {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-surface);
  border-radius: 12px;
  padding: 10px 16px;
  box-shadow: 0 4px 20px var(--color-shadow);
  z-index: 100;
  min-width: 200px;
  max-width: calc(100vw - 32px);

  /* Hidden by default */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease-out, top 0.15s ease-out, bottom 0.15s ease-out;
}

.clue-tooltip.visible {
  opacity: 1;
}

/* Dynamic positioning based on touch location */
.clue-tooltip.position-bottom {
  bottom: calc(var(--safe-area-bottom) + 160px);
  top: auto;
}

.clue-tooltip.position-top {
  top: calc(var(--safe-area-top) + 140px); /* Below palette + mode toggle */
  bottom: auto;
}

/* Reduce opacity during active drag to minimize distraction */
.clue-tooltip.dragging {
  opacity: 0.4;
}

.clue-tooltip-row,
.clue-tooltip-col {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.clue-tooltip-row + .clue-tooltip-col {
  border-top: 1px solid var(--color-cell-hover);
  margin-top: 4px;
  padding-top: 8px;
}

.clue-tooltip-label {
  font-size: 11px;
  color: var(--color-text-muted);
  min-width: 32px;
}

.clue-tooltip-clues {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}

/* Individual clue number in tooltip */
.clue-tooltip-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 22px;
  padding: 0 4px;
  border-radius: 4px;
  /* Color set dynamically via inline style */
}

/* Satisfied clue in tooltip */
.clue-tooltip-num.satisfied {
  opacity: 0.4;
  text-decoration: line-through;
}

/* Dark mode adjustments */
html[data-theme="dark"] .clue-tooltip {
  background: var(--color-surface);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}
```

### Zoom Control Buttons
```css
.zoom-controls {
  position: fixed;
  bottom: calc(var(--safe-area-bottom) + 100px);
  right: calc(var(--safe-area-right) + 16px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

/* Show zoom controls when zoomed or on hover */
.zoom-container.is-zoomed ~ .zoom-controls,
.zoom-controls:hover,
.zoom-controls:focus-within {
  opacity: 1;
  pointer-events: auto;
}

/* Always show on non-touch devices for accessibility */
@media (hover: hover) {
  .zoom-controls {
    opacity: 0.6;
    pointer-events: auto;
  }

  .zoom-controls:hover {
    opacity: 1;
  }
}

.zoom-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 20px;
  font-weight: bold;
  cursor: pointer;
  box-shadow: 0 2px 8px var(--color-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, background 0.2s;
}

.zoom-btn:hover {
  background: var(--color-cell-hover);
}

.zoom-btn:active {
  transform: scale(0.95);
}

.zoom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

---

## Integration Points

### game.js Changes
1. Call `CozyZoom.init()` in `loadPuzzle()`
2. Call `CozyZoom.destroy()` when leaving puzzle screen
3. Cells already have `e.stopPropagation()` on touch events (good)

### screens.js Changes
1. Call `CozyZoom.resetZoom()` when navigating to puzzle
2. Call `CozyZoom.destroy()` when navigating away

### index.html Changes
1. Wrap board-wrapper in zoom-container
2. Add col-clues-wrapper and row-clues-wrapper divs
3. Add zoom-controls element

### sw.js Changes
- Already includes `/js/zoom.js` in cache (needs the file to exist)

---

## Mobile Considerations

### iOS Safari
- `touch-action: pan-x pan-y pinch-zoom` allows zoom gesture
- `-webkit-overflow-scrolling: touch` for momentum scroll
- Beware of viewport meta tag conflicts

### Android Chrome
- Generally more permissive with touch gestures
- Test on various devices for scroll behavior

### PWA Fullscreen
- Safe areas must be respected for controls
- `env(safe-area-inset-*)` already in use

---

## Accessibility

1. **Zoom buttons** have proper `aria-label`
2. **Keyboard shortcuts**:
   - `+` or `=` to zoom in
   - `-` to zoom out
   - `0` to reset zoom
3. **Focus management**: When zoomed, ensure focused cell stays visible
4. **Reduced motion**: Respect `prefers-reduced-motion`
   ```css
   @media (prefers-reduced-motion: reduce) {
     .zoom-container {
       transition: none !important;
     }
   }
   ```

---

## Implementation Order

### Phase 1: Core Zoom Infrastructure
1. Create `js/zoom.js` with basic structure and API
2. Add zoom-container wrapper to HTML
3. Implement `setZoom()` with cell size change via CSS variable
4. Add zoom control buttons (+/-/fit)
5. Enable overflow:auto when zoomed
6. Test cell interaction still works at all zoom levels
7. Test drag-to-fill works at all zoom levels

### Phase 2: Gesture Recognition
1. Implement pinch-to-zoom with CSS transform during gesture
2. Apply cell size change on gesture end
3. Implement double-tap toggle (on non-cell areas only)
4. Add scroll position preservation on zoom change
5. Test on real iOS and Android devices

### Phase 3: Clue Tooltip
1. Add tooltip HTML structure to index.html
2. Implement tooltip CSS (positioning, styling, dark mode)
3. Create tooltip update logic (show current row/col clues)
4. Hook into cell touch events to trigger tooltip
5. Show clue satisfaction state in tooltip (strikethrough)
6. Auto-dismiss after touch ends (1.5s delay)
7. Only show tooltip when zoom > 1.0x
8. Dynamic positioning (top/bottom based on touch location)
9. Freeze tooltip during drag, fade opacity
10. Handle long clue sets with horizontal scroll

### Phase 4: Clue Alignment
1. Ensure row clue height matches `--cell-size`
2. Ensure column clue width matches `--cell-size`
3. Clamp clue text size to readable range
4. Test alignment at various zoom levels

### Phase 5: Game State Integration
1. Reset zoom on victory (animated)
2. Reset zoom on puzzle reset (instant)
3. Reset zoom on show solution (animated)
4. Reset zoom when changing puzzles
5. Reset zoom when navigating away

### Phase 6: Discoverability & Onboarding
1. Show zoom controls at 40% opacity even at 1.0x
2. Highlight fit button when zoomed (gentle pulse)
3. Auto-fit large puzzles (>10x10) on initial load
4. First-time hint toast for large puzzles
5. Optional: Mis-tap detection to suggest zoom

### Phase 7: Polish & Edge Cases
1. Add keyboard shortcuts (+/-/0)
2. Handle landscape orientation (tooltip repositioning)
3. Performance optimization (debounce rapid zoom)
4. Accessibility audit (focus management, reduced motion)
5. Handle small puzzles (MIN_ZOOM = 0.8 for ≤8x8)
6. Test edge scrolling behavior (iOS bounce, Android stop)
7. Pan threshold to prevent accidental pan (10px movement required)

---

## Testing Checklist

### Core Zoom
- [ ] Pinch zoom works smoothly (visual feedback during gesture)
- [ ] Double-tap toggles zoom (only on non-cell areas)
- [ ] Zoom buttons (+/-/fit) work correctly
- [ ] Zoom respects MIN_ZOOM (1.0) and MAX_ZOOM (3.0) limits
- [ ] Scroll position preserved when zooming in/out

### Cell Interaction
- [ ] Cell taps work at all zoom levels
- [ ] Cell drag-to-fill works at all zoom levels
- [ ] Long-press for X works at all zoom levels
- [ ] Touch targets feel comfortable at 2x zoom (~44px)

### Clue Tooltip
- [ ] Tooltip appears when touching cells while zoomed
- [ ] Tooltip shows correct row and column clues
- [ ] Clue colors display correctly in tooltip
- [ ] Satisfied clues show strikethrough in tooltip
- [ ] Tooltip dismisses after touch ends (~1.5s)
- [ ] Tooltip does NOT appear when zoom is 1.0x
- [ ] Long clue sets scroll horizontally in tooltip
- [ ] Tooltip positions at TOP when touching bottom half of grid
- [ ] Tooltip positions at BOTTOM when touching top half of grid
- [ ] Tooltip freezes (doesn't update) during drag-to-fill
- [ ] Tooltip fades during drag, restores after

### Clue Alignment
- [ ] Row clues stay aligned with grid rows when scrolling
- [ ] Column clues stay aligned with grid columns when scrolling
- [ ] Clue text remains readable at all zoom levels

### UI Elements
- [ ] Palette stays visible (not affected by zoom)
- [ ] Mode toggle stays visible
- [ ] Undo/redo stays accessible
- [ ] Zoom controls visible when zoomed
- [ ] Status message scrolls with grid (acceptable)

### Platform Testing
- [ ] Works on iOS Safari
- [ ] Works on Android Chrome
- [ ] Works in PWA fullscreen mode
- [ ] Landscape orientation handled correctly
- [ ] No performance issues on large puzzles (15x15)
- [ ] No performance issues on old devices (3+ years)

### State Management
- [ ] Zoom resets when changing puzzles
- [ ] Zoom resets when navigating away from puzzle screen
- [ ] Zoom state doesn't persist between sessions
- [ ] Zoom resets to 1.0x on victory (animated)
- [ ] Zoom resets to 1.0x on puzzle reset (instant)
- [ ] Zoom resets to 1.0x on show solution (animated)

### Discoverability
- [ ] Zoom controls visible at 40% opacity even at 1.0x
- [ ] Fit button pulses/highlights when zoomed in
- [ ] First-time hint shown on large puzzles (>10x10)
- [ ] Large puzzles auto-fit to show entire puzzle initially

### Accessibility
- [ ] Keyboard shortcuts work (+/-/0)
- [ ] Zoom controls have proper aria-labels
- [ ] Reduced motion preference respected
- [ ] Focus management works when zoomed

---

## Edge Cases & Special Handling

### Small Puzzles (≤8x8)
- At default zoom, these puzzles already have comfortable cell sizes
- Zoom is still available but less necessary
- Consider: Auto-fit to ensure full puzzle visible at 1.0x

```javascript
function getEffectiveMinZoom(puzzle) {
  // For small puzzles, allow zooming out slightly to fit everything
  const maxDimension = Math.max(puzzle.width, puzzle.height);
  if (maxDimension <= 8) return 0.8;
  return 1.0;
}
```

### Double-Tap on Cells
- Double-tap on a cell could conflict with cell interaction
- Solution: Only recognize double-tap zoom on non-cell areas OR use timing

```javascript
// Double-tap detection with cell awareness
container.addEventListener('touchend', (e) => {
  const target = e.target;
  const isCell = target.classList.contains('cell');

  if (isCell) {
    // Don't process double-tap on cells - let cell handlers manage it
    lastTapTime = 0;
    return;
  }

  // Process double-tap for zoom on non-cell areas
  const now = Date.now();
  if (now - lastTapTime < 300) {
    handleDoubleTap(e.changedTouches[0]);
    lastTapTime = 0;
  } else {
    lastTapTime = now;
  }
});
```

### Scroll Position Preservation
When changing zoom level, maintain the visual center point:

```javascript
function setZoom(level, animate = true, centerPoint = null) {
  const container = document.getElementById('zoom-container');
  const oldZoom = currentZoom;
  const newZoom = clamp(level, MIN_ZOOM, MAX_ZOOM);

  // Calculate center point to preserve
  if (!centerPoint) {
    centerPoint = {
      x: container.scrollLeft + container.clientWidth / 2,
      y: container.scrollTop + container.clientHeight / 2
    };
  }

  // Calculate new scroll position to maintain center
  const scale = newZoom / oldZoom;
  const newScrollLeft = centerPoint.x * scale - container.clientWidth / 2;
  const newScrollTop = centerPoint.y * scale - container.clientHeight / 2;

  currentZoom = newZoom;
  applyZoomStyles(newZoom);

  // Restore scroll position after DOM updates
  requestAnimationFrame(() => {
    container.scrollLeft = Math.max(0, newScrollLeft);
    container.scrollTop = Math.max(0, newScrollTop);
  });
}
```

### Landscape Mode
- More horizontal space available
- Row clues have more room, column clues may be constrained
- Consider adjusting max-height of zoom container

```css
@media (orientation: landscape) {
  .zoom-container {
    max-height: calc(var(--vh, 1vh) * 70); /* More vertical space in landscape */
  }

  .clue-tooltip {
    /* Position to side instead of bottom in landscape */
    bottom: auto;
    top: 50%;
    right: 16px;
    left: auto;
    transform: translateY(-50%);
  }
}
```

### Very Long Clue Sets (10+ clues)
Even in the tooltip, long clue sets may overflow:

```css
.clue-tooltip-clues {
  max-width: calc(100vw - 100px);
  overflow-x: auto;
  flex-wrap: nowrap; /* Allow horizontal scroll for very long clue sets */
  -webkit-overflow-scrolling: touch;
}

/* Visual indicator for scrollable clues */
.clue-tooltip-clues.scrollable::after {
  content: '→';
  position: sticky;
  right: 0;
  color: var(--color-text-muted);
  background: linear-gradient(to right, transparent, var(--color-surface));
  padding-left: 16px;
}
```

### Performance: Rapid Zoom/Pan
- Debounce cell size changes during rapid pinch
- Use CSS transform during gesture, apply cell size on gesture end
- Avoid layout thrashing

```javascript
let zoomDebounceTimer = null;

function applyZoomDebounced(level) {
  clearTimeout(zoomDebounceTimer);
  zoomDebounceTimer = setTimeout(() => {
    applyZoomStyles(level);
  }, 50);
}
```

### Accessibility: Zoom for Motor Impairments
Some users need zoom not for small cells, but for motor control:
- Ensure zoom controls are always reachable (not hidden when not zoomed)
- Consider adding a "lock zoom" feature for users who always want 2x

---

## Open Questions

1. **Should zoom level persist per puzzle?**
   - Recommendation: No, always start at 1.0x
   - Rationale: Consistent experience, user can quickly zoom if needed

2. **Snap to grid lines when panning?**
   - Recommendation: No, feels restrictive
   - Native scroll provides smooth, natural panning

3. **Mini-map when zoomed?**
   - Recommendation: Not for v1, evaluate based on user feedback
   - Would show overall puzzle with current viewport highlighted
   - Adds complexity, may not be necessary with good pan UX

4. **Hide instructions when zoomed?**
   - Already hidden on mobile via CSS
   - No additional logic needed

5. **Should tooltip show on every touch or only when zoomed?**
   - Recommendation: Only when zoomed (>1.0x)
   - At 1.0x, clues are already visible in the UI

6. **Tooltip positioning: center vs near touch?**
   - Recommendation: Fixed center position
   - Near-touch positioning could obscure cells user is about to tap

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Touch coordinate translation errors | High | Use native scroll (no translation needed) |
| iOS Safari gesture conflicts | Medium | Test early, use standard touch-action values |
| Performance on old devices | Medium | CSS transforms during gesture, cell resize on end |
| Breaking existing touch behavior | High | Preserve e.stopPropagation() in cell handlers |
| Tooltip obscuring important UI | Medium | Fixed position, semi-transparent, auto-dismiss |
| Clue alignment breaks at zoom | Medium | Clue container height/width uses --cell-size |
| Double-tap conflicts with cell tap | Medium | Only recognize double-tap on non-cell areas |
| Scroll position jumps on zoom | Medium | Preserve center point calculation |

---

## Success Metrics

After implementation, validate:

1. **Touch accuracy**: Users can reliably tap intended cells at 2x zoom
2. **Clue visibility**: Users report they can see relevant clues when needed
3. **Performance**: No perceptible lag during zoom/pan on 3-year-old devices
4. **Discoverability**: Users find and use zoom without instruction
5. **Completion rate**: No decrease in puzzle completion rate after adding zoom

---

## Pre-Implementation Checklist

### Critical Issues to Resolve

**1. Hybrid Zoom Approach Complexity**

The hybrid approach (CSS transform during gesture → cell resize after) has a hidden complexity:
- During transform: scroll position is in "unscaled" coordinates
- After cell resize: scroll container is actually larger
- Transition requires precise scroll position recalculation

**Recommendation:** Start with cell-resize-only for v1. If smoothness is insufficient, add transform as v2 enhancement. This reduces implementation complexity significantly.

```javascript
// Simpler v1 approach - no transform
function handlePinch(scale) {
  const newZoom = clamp(currentZoom * scale, MIN_ZOOM, MAX_ZOOM);
  setZoom(newZoom, false);  // Immediate cell resize
}
```

**2. zoom.js Already in Service Worker**

`sw.js` line 19 includes `/js/zoom.js` but the file doesn't exist. This will cause service worker installation to fail.

**Action required:** Either:
- Create a placeholder `zoom.js` before any deployment, OR
- Remove from sw.js until implementation is complete

**3. Zoom Controls CSS Contradicts UX Decision**

UX Decision says: "Always-visible zoom controls (40% opacity)"
Current CSS says: `opacity: 0; pointer-events: none;` (hidden by default)

**Fix required in CSS section:**
```css
.zoom-controls {
  /* ... */
  opacity: 0.4;              /* Always visible at 40% */
  pointer-events: auto;      /* Always interactive */
}

.zoom-container.is-zoomed ~ .zoom-controls {
  opacity: 0.8;              /* More visible when zoomed */
}

.zoom-controls:hover,
.zoom-controls:focus-within {
  opacity: 1;
}
```

**4. Auto-Fit Math Contradiction**

UX says: "Auto-fit large puzzles to show entire puzzle initially"
Code says: `return Math.min(fitZoomX, fitZoomY, 1.0);` (caps at 1.0)

If puzzle doesn't fit at 1.0x, this doesn't help. Fix:
```javascript
function calculateFitZoom(puzzle, containerWidth, containerHeight) {
  // ... calculate fitZoomX, fitZoomY ...
  const fitZoom = Math.min(fitZoomX, fitZoomY);
  return Math.max(fitZoom, 0.7);  // Allow down to 0.7x, not capped at 1.0
}
```

**5. Clue Cell Sizing Doesn't Scale**

Spec addresses clue container scaling but not clue cell elements:
```css
/* Current - fixed sizes */
.row-clue-cell {
  min-width: 16px;
  height: 20px;
}
```

At 2x zoom, row container is 48px tall but clue cells are still 20px = misalignment.

**Fix required:**
```css
.row-clue-cell {
  min-width: calc(var(--cell-size) * 0.65);
  height: calc(var(--cell-size) * 0.85);
  font-size: clamp(9px, calc(var(--cell-size) * 0.4), 14px);
}

.clue-cell {
  width: calc(var(--cell-size) * 0.7);
  height: clamp(14px, calc(var(--cell-size) * 0.6), 20px);
  font-size: clamp(9px, calc(var(--cell-size) * 0.4), 14px);
}
```

### Important Clarifications Needed

**6. Tooltip Data Access**

The spec doesn't clarify how tooltip gets clue data and satisfaction state.

**Recommendation:** game.js exposes a method:
```javascript
// Add to CozyGarden public API
getClueInfo(row, col) {
  const puzzle = getPuzzles()[currentPuzzle];
  return {
    rowClues: puzzle.row_clues[row],
    colClues: puzzle.col_clues[col],
    rowSatisfied: isRowSatisfied(row),  // existing logic
    colSatisfied: isColSatisfied(col),  // existing logic
  };
}
```

zoom.js calls `CozyGarden.getClueInfo(row, col)` to populate tooltip.

**7. Script Loading Order**

zoom.js depends on:
- DOM elements (zoom-container, clue-tooltip)
- CozyGarden.getClueInfo() from game.js

**Required order in index.html:**
```html
<script src="js/storage.js"></script>
<script src="js/history.js"></script>
<script src="js/game.js"></script>
<script src="js/zoom.js"></script>      <!-- After game.js -->
<script src="js/collection.js"></script>
<script src="js/screens.js"></script>
<script src="js/app.js"></script>
```

**8. First-Time Hint Storage**

Hint shown once per user. Storage key needed:
```javascript
const HINT_SHOWN_KEY = 'cozy_garden_zoom_hint_shown';

function maybeShowZoomHint(puzzle) {
  if (puzzle.width > 10 || puzzle.height > 10) {
    if (!localStorage.getItem(HINT_SHOWN_KEY)) {
      showToast('Tip: Pinch to zoom for easier tapping');
      localStorage.setItem(HINT_SHOWN_KEY, 'true');
    }
  }
}
```

**9. Graceful Degradation**

If zoom.js fails to load, game should still work:
```javascript
// In game.js, check before calling zoom
if (window.CozyZoom) {
  CozyZoom.init();
}

// Victory handler
function handleVictory() {
  window.CozyZoom?.resetZoom(true);  // Safe optional chaining
  // ... rest of victory logic
}
```

### Minor Items (Can Address During Implementation)

10. **Dark mode testing** - Add to checklist: verify all new elements in dark mode
11. **Screen reader testing** - Add: VoiceOver/TalkBack verification
12. **Performance thresholds** - Debounce: 50ms for zoom, 16ms for tooltip updates
13. **Touch device detection** - Zoom controls can be hidden on desktop (mouse users don't need them)

---

## Final Recommendation

**The spec is 90% ready.** Before implementation:

1. ✅ Remove `/js/zoom.js` from sw.js (or create placeholder)
2. ✅ Fix zoom controls CSS (40% opacity default)
3. ✅ Fix calculateFitZoom math (allow < 1.0)
4. ✅ Add clue cell scaling CSS
5. ✅ Decide: hybrid vs cell-resize-only (recommend cell-resize-only for v1)
6. ✅ Add getClueInfo() to game.js API
7. ✅ Document script loading order

Once these are addressed, implementation can proceed phase by phase.
