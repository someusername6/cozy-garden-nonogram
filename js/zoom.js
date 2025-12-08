// Cozy Garden - Zoom Module
// Handles pinch-to-zoom and pan for mobile puzzle navigation
// Dynamic zoom range: 100% = fit entire puzzle, max = ~6x6 cells visible

(function() {
  'use strict';

  // Zoom state
  let scale = 1;
  let minScale = 1;      // Dynamic: scale where entire puzzle fits
  let maxScale = 3;      // Dynamic: scale where ~6x6 cells visible
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let lastPanX = 0;
  let lastPanY = 0;

  // Pinch state
  let initialPinchDistance = 0;
  let initialScale = 1;

  // Config
  const TARGET_VISIBLE_CELLS = 6;  // At max zoom, show roughly 6x6 cells
  const MIN_SCALE_FLOOR = 0.15;    // Never go below 15% (for readability)
  const MAX_SCALE_CAP = 8;         // Never go above 800%

  // DOM elements (set during init)
  let zoomContainer = null;
  let zoomTarget = null;

  // Get distance between two touch points
  function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Get center point between two touches
  function getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    };
  }

  // Calculate dynamic scale limits based on puzzle and viewport size
  function calculateScaleLimits() {
    if (!zoomContainer || !zoomTarget) return;

    const grid = document.getElementById('grid');
    if (!grid || grid.children.length === 0) return;

    // Get container size (available viewport for puzzle)
    const containerRect = zoomContainer.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return;

    // Temporarily reset transform to measure natural size
    const oldTransform = zoomTarget.style.transform;
    zoomTarget.style.transform = 'none';

    // Get the natural size of the board wrapper (at scale=1)
    const boardWidth = zoomTarget.scrollWidth;
    const boardHeight = zoomTarget.scrollHeight;

    // Get grid info to calculate cell count
    const gridStyle = window.getComputedStyle(grid);
    const gridCols = gridStyle.gridTemplateColumns.split(' ').length;
    const gridRows = Math.floor(grid.children.length / gridCols);

    // Restore transform
    zoomTarget.style.transform = oldTransform;

    // Calculate fit scale (entire puzzle fits in container)
    // This becomes our "100%" / minimum zoom
    const fitScaleX = containerRect.width / boardWidth;
    const fitScaleY = containerRect.height / boardHeight;
    const fitScale = Math.min(fitScaleX, fitScaleY);

    // Clamp minScale to reasonable bounds
    minScale = Math.max(MIN_SCALE_FLOOR, Math.min(1, fitScale));

    // For large puzzles that don't fit at scale=1, allow scaling down
    if (fitScale < 1) {
      minScale = Math.max(MIN_SCALE_FLOOR, fitScale);
    }

    // Calculate max scale based on showing ~TARGET_VISIBLE_CELLS cells
    // When zoomed to max, the visible area should show approximately 6x6 cells
    const puzzleCells = Math.max(gridCols, gridRows);
    const zoomFactor = puzzleCells / TARGET_VISIBLE_CELLS;

    // Max scale is relative to minScale
    maxScale = minScale * Math.max(1, zoomFactor);

    // Cap at reasonable maximum
    maxScale = Math.min(maxScale, MAX_SCALE_CAP);

    // Ensure max >= min
    if (maxScale < minScale) {
      maxScale = minScale;
    }

    // If current scale is out of bounds, adjust it
    const oldScale = scale;
    if (scale < minScale) {
      scale = minScale;
    } else if (scale > maxScale) {
      scale = maxScale;
    }

    // Apply transform if scale changed
    if (scale !== oldScale) {
      applyTransform();
    }

    updateZoomIndicator();
  }

  // Apply transform to zoom target
  function applyTransform() {
    if (!zoomTarget) return;

    // Constrain pan when zoomed beyond fit
    if (scale > minScale) {
      const containerRect = zoomContainer.getBoundingClientRect();

      // Calculate scaled dimensions
      const scaledWidth = zoomTarget.scrollWidth * scale;
      const scaledHeight = zoomTarget.scrollHeight * scale;

      // Calculate max pan based on overflow
      const maxPanX = Math.max(0, (scaledWidth - containerRect.width) / 2);
      const maxPanY = Math.max(0, (scaledHeight - containerRect.height) / 2);

      panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
      panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
    } else {
      // Reset pan when at minimum (fit) scale
      panX = 0;
      panY = 0;
    }

    zoomTarget.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    updateZoomIndicator();
  }

  // Update zoom level indicator
  // Display percentage relative to minScale (fit = 100%)
  function updateZoomIndicator() {
    const indicator = document.getElementById('zoom-level');
    if (indicator) {
      // Calculate percentage relative to minScale (fit view = 100%)
      const percent = Math.round((scale / minScale) * 100);
      indicator.textContent = percent + '%';
    }

    // Update button states
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const tolerance = 0.001;
    if (zoomInBtn) zoomInBtn.disabled = scale >= maxScale - tolerance;
    if (zoomOutBtn) zoomOutBtn.disabled = scale <= minScale + tolerance;
  }

  // Set zoom level
  function setZoom(newScale, centerX, centerY) {
    const oldScale = scale;
    scale = Math.max(minScale, Math.min(maxScale, newScale));

    // Adjust pan to zoom toward center point
    if (centerX !== undefined && centerY !== undefined && oldScale !== scale) {
      const containerRect = zoomContainer.getBoundingClientRect();
      const relX = centerX - containerRect.left - containerRect.width / 2;
      const relY = centerY - containerRect.top - containerRect.height / 2;

      const scaleChange = scale / oldScale;
      panX = panX * scaleChange - relX * (scaleChange - 1);
      panY = panY * scaleChange - relY * (scaleChange - 1);
    }

    applyTransform();
  }

  // Calculate appropriate zoom step based on current scale range
  function getZoomStep() {
    const range = maxScale - minScale;
    // Divide range into ~6 steps
    return Math.max(0.1, range / 6);
  }

  // Zoom in
  function zoomIn() {
    setZoom(scale + getZoomStep());
  }

  // Zoom out
  function zoomOut() {
    setZoom(scale - getZoomStep());
  }

  // Reset zoom to fit (minScale)
  function resetZoom() {
    scale = minScale;
    panX = 0;
    panY = 0;
    applyTransform();
  }

  // Handle touch start
  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      // Pinch start
      initialPinchDistance = getTouchDistance(e.touches);
      initialScale = scale;
      isPanning = false;
    } else if (e.touches.length === 1 && scale > minScale) {
      // Pan start (only when zoomed beyond fit)
      isPanning = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastPanX = panX;
      lastPanY = panY;
    }
  }

  // Handle touch move
  function handleTouchMove(e) {
    if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      const center = getTouchCenter(e.touches);
      const newScale = initialScale * (currentDistance / initialPinchDistance);
      setZoom(newScale, center.x, center.y);
      isPanning = false;
    } else if (e.touches.length === 1 && isPanning && scale > minScale) {
      // Pan
      e.preventDefault();
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      panX = lastPanX + dx;
      panY = lastPanY + dy;
      applyTransform();
    }
  }

  // Handle touch end
  function handleTouchEnd(e) {
    if (e.touches.length < 2) {
      initialPinchDistance = 0;
    }
    if (e.touches.length === 0) {
      isPanning = false;
    }
  }

  // Handle double tap to toggle zoom
  let lastTap = 0;
  function handleDoubleTap(e) {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    if (now - lastTap < DOUBLE_TAP_DELAY) {
      e.preventDefault();
      if (scale > minScale * 1.1) {
        // If zoomed in, reset to fit
        resetZoom();
      } else {
        // Zoom to midpoint between min and max, centered on tap
        const midScale = (minScale + maxScale) / 2;
        const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
        const y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
        setZoom(midScale, x, y);
      }
    }
    lastTap = now;
  }

  // Handle mouse wheel zoom (desktop)
  function handleWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const step = getZoomStep() * 0.3;
      const delta = e.deltaY > 0 ? -step : step;
      setZoom(scale + delta, e.clientX, e.clientY);
    }
  }

  // Create zoom controls UI
  function createZoomControls() {
    const controls = document.createElement('div');
    controls.className = 'zoom-controls';
    controls.innerHTML = `
      <button id="zoom-out" class="zoom-btn" title="Zoom out">-</button>
      <span id="zoom-level" class="zoom-level">100%</span>
      <button id="zoom-in" class="zoom-btn" title="Zoom in">+</button>
      <button id="zoom-reset" class="zoom-btn zoom-reset" title="Fit puzzle">Fit</button>
    `;
    return controls;
  }

  // Initialize zoom functionality
  function init() {
    // Find the board wrapper to make zoomable
    const boardWrapper = document.querySelector('.board-wrapper');
    if (!boardWrapper) return;

    // Create zoom container
    zoomContainer = document.createElement('div');
    zoomContainer.className = 'zoom-container';

    // Wrap board-wrapper in zoom container
    boardWrapper.parentNode.insertBefore(zoomContainer, boardWrapper);
    zoomContainer.appendChild(boardWrapper);

    zoomTarget = boardWrapper;

    // Add zoom controls after the zoom container
    const controls = createZoomControls();
    zoomContainer.parentNode.insertBefore(controls, zoomContainer.nextSibling);

    // Set up event listeners
    zoomContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    zoomContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    zoomContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
    zoomContainer.addEventListener('touchend', handleDoubleTap, { passive: false });
    zoomContainer.addEventListener('wheel', handleWheel, { passive: false });

    // Button controls
    document.getElementById('zoom-in').addEventListener('click', zoomIn);
    document.getElementById('zoom-out').addEventListener('click', zoomOut);
    document.getElementById('zoom-reset').addEventListener('click', resetZoom);

    // Recalculate on window resize
    window.addEventListener('resize', debounce(function() {
      calculateScaleLimits();
      applyTransform();
    }, 150));

    // Initial calculation (defer to allow layout)
    setTimeout(function() {
      calculateScaleLimits();
      scale = minScale; // Start at fit
      applyTransform();
    }, 50);
  }

  // Debounce helper
  function debounce(fn, delay) {
    let timer = null;
    return function() {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  // Recalculate when puzzle changes
  function onPuzzleChange() {
    // Reset zoom and recalculate limits
    panX = 0;
    panY = 0;

    // Defer to allow DOM to update
    setTimeout(function() {
      calculateScaleLimits();
      scale = minScale; // Reset to fit view
      applyTransform();
    }, 50);
  }

  // Expose API
  window.CozyZoom = {
    init: init,
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    resetZoom: resetZoom,
    onPuzzleChange: onPuzzleChange,
    recalculate: calculateScaleLimits,
    getScale: function() { return scale; },
    getMinScale: function() { return minScale; },
    getMaxScale: function() { return maxScale; }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
