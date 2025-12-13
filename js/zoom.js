// Cozy Garden - Zoom & Pan System
// Provides pinch-to-zoom and pan for mobile puzzle interaction

(function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG } = window.Cozy.Utils;

  // === Constants ===
  const ABSOLUTE_MIN_ZOOM = 0.35; // Absolute floor for zoom (safety)
  const DEFAULT_ZOOM = 1.0;       // Starting zoom level
  const FIT_ZOOM_BUFFER = 0.97;   // 3% buffer so fit isn't too tight
  const DOUBLE_TAP_DELAY = 300;   // ms between taps for double-tap
  const TOOLTIP_DISMISS_DELAY = 1500;  // ms after touch ends
  const TOOLTIP_SHOW_DELAY = 100; // ms before showing tooltip
  const PAN_THRESHOLD = 10;       // pixels of movement before pan commits
  // Zoom hint flag now stored in CozyStorage.flags.zoomHintShown

  // === State ===
  let currentZoom = DEFAULT_ZOOM;
  let baseZoom = DEFAULT_ZOOM;    // Zoom level at start of pinch gesture
  let isPinching = false;
  let pinchStartDistance = 0;
  let lastTapTime = 0;
  let lastTapTarget = null;
  let tooltipDismissTimer = null;
  let tooltipShowTimer = null;
  let tooltipLocked = false;      // Lock tooltip during drag
  let currentTooltipRow = -1;
  let currentTooltipCol = -1;
  let initialized = false;

  // === DOM References (cached on init) ===
  let zoomContainer = null;
  let boardWrapper = null;
  let tooltip = null;
  let tooltipRowClues = null;
  let tooltipColClues = null;
  let zoomInBtn = null;
  let zoomOutBtn = null;
  let zoomFitBtn = null;

  // === Utility Functions ===

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

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

  function getBaseCellSize() {
    // Get the base cell size from CSS (before zoom modifications)
    const width = window.innerWidth;
    if (width <= 360) return 20;
    if (width >= 768) return 28;
    if (width >= 1200) return 32;
    return 24;
  }

  // === Zoom Application ===

  function applyZoom(level, preserveCenter = true) {
    const container = zoomContainer;
    if (!container) return;

    const oldZoom = currentZoom;
    const effectiveMinZoom = getEffectiveMinZoom();
    const newZoom = clamp(level, effectiveMinZoom, CONFIG.MAX_ZOOM);

    // Calculate center point to preserve scroll position
    let centerX, centerY;
    if (preserveCenter && oldZoom !== newZoom) {
      centerX = container.scrollLeft + container.clientWidth / 2;
      centerY = container.scrollTop + container.clientHeight / 2;
    }

    currentZoom = newZoom;

    // Calculate and apply new cell size
    const baseCellSize = getBaseCellSize();
    const newCellSize = Math.round(baseCellSize * newZoom);
    document.documentElement.style.setProperty('--cell-size', `${newCellSize}px`);

    // Update container overflow based on zoom state
    // Enable scrolling when zoomed beyond fit (content larger than container)
    const fitZoom = calculateFitZoom();
    const isZoomed = newZoom > fitZoom + 0.01; // Small epsilon for float comparison
    container.classList.toggle('is-zoomed', isZoomed);

    // Update button states
    updateZoomButtons();

    // Restore scroll position to maintain center
    if (preserveCenter && oldZoom !== newZoom && centerX !== undefined) {
      requestAnimationFrame(() => {
        const scale = newZoom / oldZoom;
        const newScrollLeft = centerX * scale - container.clientWidth / 2;
        const newScrollTop = centerY * scale - container.clientHeight / 2;
        container.scrollLeft = Math.max(0, newScrollLeft);
        container.scrollTop = Math.max(0, newScrollTop);
      });
    }

    // Dispatch zoom change event
    window.dispatchEvent(new CustomEvent('zoomchange', {
      detail: { zoom: newZoom, oldZoom, isZoomed }
    }));
  }

  function updateZoomButtons() {
    const effectiveMinZoom = getEffectiveMinZoom();

    if (zoomInBtn) {
      zoomInBtn.disabled = currentZoom >= CONFIG.MAX_ZOOM;
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = currentZoom <= effectiveMinZoom;
    }
    if (zoomFitBtn) {
      // Highlight fit button when not at fit zoom
      const fitZoom = calculateFitZoom();
      const isAtFit = Math.abs(currentZoom - fitZoom) < 0.05;
      zoomFitBtn.classList.toggle('highlighted', !isAtFit && currentZoom !== fitZoom);
    }
  }

  // === Auto-Fit Calculation ===

  // Cache fit zoom per puzzle to avoid recalculation issues during zoom
  let cachedFitZoom = null;
  let cachedPuzzleId = null;

  function calculateFitZoom(forceRecalculate = false) {
    const container = zoomContainer;
    if (!container || !window.Cozy.Garden?.getCurrentPuzzle) return DEFAULT_ZOOM;

    const puzzle = window.Cozy.Garden.getCurrentPuzzle();
    if (!puzzle) return DEFAULT_ZOOM;

    // Use cached value if available for the same puzzle (prevents shrinking spiral)
    const puzzleId = puzzle.title;
    if (!forceRecalculate && cachedFitZoom !== null && cachedPuzzleId === puzzleId) {
      return cachedFitZoom;
    }

    const baseCellSize = getBaseCellSize();

    // Clue areas scale with cell size, so express them as multiples of cell size
    const maxRowClues = Math.max(...puzzle.row_clues.map(r => r.length));
    const maxColClues = Math.max(...puzzle.col_clues.map(c => c.length));

    // Clue area in terms of cell-size units
    // Row clues: each clue is ~0.6 cell widths, plus gap
    // Col clues: each clue is ~0.6 cell heights, plus gap
    const clueWidthUnits = Math.max(2, maxRowClues * 0.6 + 0.5);
    const clueHeightUnits = Math.max(2, maxColClues * 0.6 + 0.5);

    // Total board size in cell-size units (grid + clues + gap between them)
    const totalWidthUnits = puzzle.width + clueWidthUnits + 0.25;
    const totalHeightUnits = puzzle.height + clueHeightUnits + 0.25;

    // Measure actual container dimensions
    const availableWidth = container.clientWidth;
    const availableHeight = container.clientHeight;

    // Small padding for breathing room
    const padding = 8;

    // Calculate zoom needed to fit in each dimension
    const fitZoomX = (availableWidth - padding * 2) / (totalWidthUnits * baseCellSize);
    const fitZoomY = (availableHeight - padding * 2) / (totalHeightUnits * baseCellSize);

    // Use the smaller of the two to ensure puzzle fits in both dimensions
    const fitZoom = Math.min(fitZoomX, fitZoomY);

    // Apply small buffer so fit isn't too tight, then clamp to valid range
    const result = clamp(fitZoom * FIT_ZOOM_BUFFER, ABSOLUTE_MIN_ZOOM, CONFIG.MAX_ZOOM);

    // Cache the result
    cachedFitZoom = result;
    cachedPuzzleId = puzzleId;

    return result;
  }

  // Invalidate fit zoom cache (call on resize/orientation change)
  function invalidateFitZoomCache() {
    cachedFitZoom = null;
    cachedPuzzleId = null;
  }

  // Get effective minimum zoom - capped at fit level so user can't zoom out past where puzzle fits
  function getEffectiveMinZoom() {
    const fitZoom = calculateFitZoom();
    // Min zoom is the greater of: absolute floor, or fit zoom (can't zoom out past fit)
    return Math.max(ABSOLUTE_MIN_ZOOM, fitZoom);
  }

  // Check if currently zoomed beyond fit (i.e., content larger than container)
  function isZoomedBeyondFit() {
    const fitZoom = calculateFitZoom();
    return currentZoom > fitZoom + 0.01;
  }

  // === Gesture Handlers ===

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      // Pinch start
      isPinching = true;
      pinchStartDistance = getDistance(e.touches[0], e.touches[1]);
      baseZoom = currentZoom;
      e.preventDefault();
    }
  }

  function handleTouchMove(e) {
    if (isPinching && e.touches.length === 2) {
      const distance = getDistance(e.touches[0], e.touches[1]);
      const scale = distance / pinchStartDistance;
      const effectiveMinZoom = getEffectiveMinZoom();
      const newZoom = clamp(baseZoom * scale, effectiveMinZoom, CONFIG.MAX_ZOOM);

      // Apply zoom directly (cell-resize approach)
      if (Math.abs(newZoom - currentZoom) > 0.05) {
        applyZoom(newZoom, true);
      }

      e.preventDefault();
    }
  }

  function handleTouchEnd(e) {
    if (isPinching && e.touches.length < 2) {
      isPinching = false;
      // Pinch ended, zoom already applied
    }

    // Double-tap detection (only on non-cell areas)
    if (e.touches.length === 0 && !isPinching) {
      const target = e.target;
      const isCell = target.classList.contains('cell');

      if (!isCell) {
        const now = Date.now();
        if (lastTapTarget === target && now - lastTapTime < DOUBLE_TAP_DELAY) {
          handleDoubleTap(e.changedTouches[0]);
          lastTapTime = 0;
          lastTapTarget = null;
        } else {
          lastTapTime = now;
          lastTapTarget = target;
        }
      }
    }
  }

  function handleDoubleTap(touch) {
    if (isZoomedBeyondFit()) {
      // Zoomed in → reset to fit
      applyZoom(calculateFitZoom(), true);
    } else {
      // At fit → zoom to comfortable level
      applyZoom(CONFIG.COMFORTABLE_ZOOM, true);
    }
  }

  // === Wheel/Trackpad Zoom (Desktop) ===

  function handleWheel(e) {
    // Trackpad pinch on macOS and Ctrl+scroll both report as wheel events with ctrlKey
    if (e.ctrlKey) {
      e.preventDefault();

      // deltaY > 0 means zoom out (scroll down / pinch out)
      // deltaY < 0 means zoom in (scroll up / pinch in)
      // Use smaller increments for smoother zoom
      const zoomDelta = e.deltaY > 0 ? -0.15 : 0.15;
      applyZoom(currentZoom + zoomDelta, true);
    }
  }

  // === Tooltip Management ===

  function showTooltip() {
    if (!tooltip) return;
    if (!isZoomedBeyondFit()) return; // Only show when zoomed beyond fit

    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('visible');
    currentTooltipRow = -1;
    currentTooltipCol = -1;
  }

  function updateTooltipContent(row, col) {
    if (!tooltip || tooltipLocked) return;
    if (row === currentTooltipRow && col === currentTooltipCol) return;

    currentTooltipRow = row;
    currentTooltipCol = col;

    // Get clue info from game.js
    const clueInfo = window.Cozy.Garden?.getClueInfo?.(row, col);
    if (!clueInfo) return;

    // Render row clues
    if (tooltipRowClues) {
      tooltipRowClues.innerHTML = renderClues(clueInfo.rowClues);
    }

    // Render column clues
    if (tooltipColClues) {
      tooltipColClues.innerHTML = renderClues(clueInfo.colClues);
    }
  }

  function renderClues(clues) {
    if (!clues || clues.length === 0) {
      return '<span class="clue-tooltip-num satisfied">0</span>';
    }

    return clues.map(clue => {
      const color = window.Cozy.Garden?.getColorRgb?.(clue.color) || [128, 128, 128];
      const isSatisfied = clue.satisfied;
      const brightness = (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000;
      const textColor = brightness > 128 ? '#333' : '#fff';

      return `<span class="clue-tooltip-num${isSatisfied ? ' satisfied' : ''}"
                    style="background: rgb(${color.join(',')}); color: ${textColor}">
                ${clue.count}
              </span>`;
    }).join('');
  }

  function positionTooltip(touchY) {
    if (!tooltip || !zoomContainer) return;

    const containerRect = zoomContainer.getBoundingClientRect();
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

  function startTooltipDismissTimer() {
    clearTimeout(tooltipDismissTimer);
    tooltipDismissTimer = setTimeout(() => {
      hideTooltip();
    }, TOOLTIP_DISMISS_DELAY);
  }

  function cancelTooltipDismissTimer() {
    clearTimeout(tooltipDismissTimer);
  }

  // === Cell Touch Integration ===
  // These are called from game.js cell handlers

  function onCellTouchStart(row, col, touchY) {
    if (!isZoomedBeyondFit()) return;

    tooltipLocked = false;
    cancelTooltipDismissTimer();

    // Delay showing tooltip slightly to avoid flicker on quick taps
    clearTimeout(tooltipShowTimer);
    tooltipShowTimer = setTimeout(() => {
      updateTooltipContent(row, col);
      positionTooltip(touchY);
      showTooltip();
    }, TOOLTIP_SHOW_DELAY);
  }

  function onCellTouchMove() {
    if (!isZoomedBeyondFit()) return;

    // Lock tooltip to initial cell during drag
    tooltipLocked = true;
    tooltip?.classList.add('dragging');
  }

  function onCellTouchEnd() {
    if (!isZoomedBeyondFit()) return;

    clearTimeout(tooltipShowTimer);
    tooltipLocked = false;
    tooltip?.classList.remove('dragging');
    startTooltipDismissTimer();
  }

  // === Zoom Control Buttons ===

  function setupZoomControls() {
    zoomInBtn = document.querySelector('.zoom-btn.zoom-in');
    zoomOutBtn = document.querySelector('.zoom-btn.zoom-out');
    zoomFitBtn = document.querySelector('.zoom-btn.zoom-fit');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        applyZoom(currentZoom + 0.5, true);
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        applyZoom(currentZoom - 0.5, true);
      });
    }

    if (zoomFitBtn) {
      zoomFitBtn.addEventListener('click', () => {
        applyZoom(calculateFitZoom(), true);
      });
    }

    updateZoomButtons();
  }

  // === Keyboard Shortcuts ===

  function handleKeyDown(e) {
    // Only handle when on puzzle screen
    const puzzleScreen = document.getElementById('screen-puzzle');
    if (!puzzleScreen || puzzleScreen.classList.contains('screen-hidden')) return;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      applyZoom(currentZoom + 0.5, true);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      applyZoom(currentZoom - 0.5, true);
    } else if (e.key === '0') {
      e.preventDefault();
      applyZoom(calculateFitZoom(), true);
    }
  }

  // === Resize/Orientation Handler ===

  let resizeTimeout = null;

  function handleResize() {
    // Debounce resize events
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Only handle when on puzzle screen
      const puzzleScreen = document.getElementById('screen-puzzle');
      if (!puzzleScreen || puzzleScreen.classList.contains('screen-hidden')) return;

      // Invalidate cache so fit zoom is recalculated with new dimensions
      invalidateFitZoomCache();

      const effectiveMinZoom = getEffectiveMinZoom();

      // If current zoom is below the new effective minimum, snap to it
      if (currentZoom < effectiveMinZoom) {
        applyZoom(effectiveMinZoom, false);
      }

      // Update button states
      updateZoomButtons();
    }, 150);
  }

  // === First-Time Hint ===

  function maybeShowZoomHint() {
    const puzzle = window.Cozy.Garden?.getCurrentPuzzle?.();
    if (!puzzle) return;

    // Only show for large puzzles
    if (puzzle.width <= 10 && puzzle.height <= 10) return;

    // Only show once
    if (window.Cozy.Storage?.getFlag('zoomHintShown')) return;

    // Show hint toast
    showZoomHint();
    window.Cozy.Storage?.setFlag('zoomHintShown', true);
  }

  function showZoomHint() {
    // Create toast if it doesn't exist
    let toast = document.getElementById('zoom-hint-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zoom-hint-toast';
      toast.className = 'zoom-hint-toast';
      toast.textContent = 'Tip: Pinch to zoom for easier tapping';
      document.body.appendChild(toast);
    }

    // Show and auto-hide
    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
    }, 4000);
  }

  // === Initialization ===

  function init() {
    if (initialized) return;

    // Cache DOM references
    zoomContainer = document.getElementById('zoom-container');
    boardWrapper = zoomContainer?.querySelector('.board-wrapper');
    tooltip = document.getElementById('clue-tooltip');
    tooltipRowClues = document.getElementById('tooltip-row-clues');
    tooltipColClues = document.getElementById('tooltip-col-clues');

    if (!zoomContainer) {
      console.warn('[Zoom] zoom-container not found, zoom disabled');
      return;
    }

    // Set up gesture handlers on zoom container
    zoomContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    zoomContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    zoomContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Set up wheel handler for desktop trackpad pinch and Ctrl+scroll
    zoomContainer.addEventListener('wheel', handleWheel, { passive: false });

    // Set up zoom control buttons
    setupZoomControls();

    // Set up keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);

    // Handle resize/orientation changes
    window.addEventListener('resize', handleResize);

    initialized = true;
    console.log('[Zoom] Initialized');
  }

  function initForPuzzle() {
    // Called when a puzzle is loaded
    // Invalidate cache so fit zoom is calculated fresh for this puzzle
    invalidateFitZoomCache();

    // Always start at fit zoom - the largest zoom where the entire puzzle fits
    // This maximizes puzzle visibility while ensuring everything is on screen
    const fitZoom = calculateFitZoom();
    applyZoom(fitZoom, false);

    // Maybe show first-time hint for large puzzles
    setTimeout(maybeShowZoomHint, 500);
  }

  function destroy() {
    // Reset zoom when leaving puzzle screen
    resetZoom(false);
    hideTooltip();
    clearTimeout(tooltipDismissTimer);
    clearTimeout(tooltipShowTimer);
  }

  function resetZoom(animate = true) {
    const targetZoom = DEFAULT_ZOOM;
    animateToZoom(targetZoom, animate);
  }

  function zoomToFit(animate = true) {
    const targetZoom = calculateFitZoom();
    animateToZoom(targetZoom, animate);
  }

  function animateToZoom(targetZoom, animate = true) {
    if (animate && currentZoom !== targetZoom) {
      const startZoom = currentZoom;
      const duration = 200;
      const startTime = performance.now();

      function animateZoom(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

        const zoom = startZoom + (targetZoom - startZoom) * eased;
        applyZoom(zoom, false);

        if (progress < 1) {
          requestAnimationFrame(animateZoom);
        }
      }

      requestAnimationFrame(animateZoom);
    } else {
      applyZoom(targetZoom, false);
    }
  }

  // === Public API ===

  window.Cozy.Zoom = {
    init,
    initForPuzzle,
    destroy,
    resetZoom,
    zoomToFit,

    getZoom: () => currentZoom,
    setZoom: (level, animate = true) => applyZoom(level, !animate),
    zoomIn: (increment = 0.5) => applyZoom(currentZoom + increment, true),
    zoomOut: (increment = 0.5) => applyZoom(currentZoom - increment, true),
    isZoomed: isZoomedBeyondFit,

    // Cell touch integration (called from game.js)
    onCellTouchStart,
    onCellTouchMove,
    onCellTouchEnd,

    // Get effective min zoom for current puzzle
    getEffectiveMinZoom
    // Note: MAX_ZOOM and COMFORTABLE_ZOOM available via CozyUtils.CONFIG
  };

})();
