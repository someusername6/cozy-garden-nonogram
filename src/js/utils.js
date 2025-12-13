// Cozy Garden - Shared Utilities
// This module provides common utilities and configuration constants
// used across multiple modules. Loads first to avoid circular dependencies.

(function() {
  'use strict';

  // === Configuration Constants ===
  // Centralized to ensure consistency and single source of truth
  const CONFIG = {
    // Canvas sizes
    STAMP_CANVAS_SIZE: 180,      // Flying stamp preview (matches victory screen)
    VICTORY_CANVAS_SIZE: 180,   // Victory screen puzzle preview
    MINI_CANVAS_SIZE: 80,       // Collection thumbnail size

    // Mini canvas outline (for thumbnails and stamps)
    OUTLINE_THICKNESS: 2,       // Outline width in pixels

    // Limits
    MAX_PUZZLE_DIMENSION: 32,   // Maximum puzzle width/height (security limit)
    MAX_HISTORY: 50,            // Undo/redo history depth
    MAX_SCREEN_HISTORY: 10,     // Browser history states to track
    MAX_SEARCH_LENGTH: 100,     // Search input character limit

    // Timing
    TOAST_DURATION: 2500,       // Toast notification display time (ms)
    LONG_PRESS_DELAY: 400,      // Touch long-press threshold (ms)
    SEARCH_DEBOUNCE: 150,       // Search input debounce (ms)

    // Zoom
    MAX_ZOOM: 3.0,              // Maximum pinch-to-zoom level
    COMFORTABLE_ZOOM: 2.0,      // Suggested zoom for comfortable touch targets
    AUTO_ZOOM_MIN_SIZE: 10,     // Skip auto-zoom for puzzles ≤ this dimension

    // Visual thresholds
    BRIGHTNESS_MIDPOINT: 128,   // Light/dark threshold for text contrast (0-255 scale)
    BADGE_MAX_DISPLAY: 99       // Show "99+" for counts above this
  };

  // === Shared Utilities ===

  /**
   * Generate a consistent puzzle ID from puzzle data
   * Used for storage keys and DOM data attributes
   * @param {Object} puzzle - Puzzle object with title (t or title property)
   * @returns {string} Normalized puzzle ID (lowercase, underscores)
   */
  function getPuzzleId(puzzle) {
    const title = puzzle.t || puzzle.title;
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  /**
   * Get puzzle title, handling both concise (t) and verbose (title) formats
   * @param {Object} puzzle - Puzzle object
   * @returns {string} Puzzle title
   */
  function getPuzzleTitle(puzzle) {
    return puzzle.t || puzzle.title;
  }

  /**
   * Parse puzzle metadata from title string
   * Title format: "Name (WxH, difficulty)"
   * @param {string} title - Puzzle title string
   * @returns {Object} Parsed metadata {name, width, height, difficulty}
   */
  function parsePuzzleTitle(title) {
    const match = title.match(/^(.+?)\s*\((\d+)x(\d+),\s*(\w+)\)$/i);
    if (match) {
      return {
        name: match[1].trim(),
        width: parseInt(match[2], 10),
        height: parseInt(match[3], 10),
        difficulty: match[4].toLowerCase()
      };
    }
    return {
      name: title,
      width: 0,
      height: 0,
      difficulty: 'unknown'
    };
  }

  /**
   * Initialize an event listener on an element only once.
   * Uses data-initialized attribute to prevent duplicate listeners.
   * @param {Element|null} element - DOM element to attach listener to
   * @param {string} event - Event type (e.g., 'click', 'change')
   * @param {Function} handler - Event handler function
   * @param {Object} options - Optional addEventListener options
   * @returns {boolean} True if listener was added, false if skipped
   */
  function initOnce(element, event, handler, options = {}) {
    if (!element || element.hasAttribute('data-initialized')) return false;
    element.addEventListener(event, handler, options);
    element.setAttribute('data-initialized', 'true');
    return true;
  }

  /**
   * Create a flying stamp canvas from a source canvas, positioned within a container.
   * Used for stamp animations when navigating between screens.
   * @param {HTMLCanvasElement} sourceCanvas - Canvas to copy content from
   * @param {DOMRect} containerRect - Bounding rect to position and size within
   * @param {Object} options - Optional settings
   * @param {boolean} options.useScale - Use transform:scale for sizing (default: false)
   * @returns {HTMLCanvasElement} The flying stamp element (already appended to body)
   */
  function createFlyingStamp(sourceCanvas, containerRect, options = {}) {
    // Create canvas and copy content
    const stamp = document.createElement('canvas');
    stamp.width = sourceCanvas.width;
    stamp.height = sourceCanvas.height;
    const ctx = stamp.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    // Calculate aspect ratios
    const canvasAspect = sourceCanvas.width / sourceCanvas.height;
    const containerAspect = containerRect.width / containerRect.height;

    let cssWidth, cssHeight;
    if (options.useScale) {
      // Use canvas pixel dimensions with scale transform (for victory screen)
      cssWidth = sourceCanvas.width;
      cssHeight = sourceCanvas.height;
      const containerSize = Math.min(containerRect.width, containerRect.height);
      const targetSize = canvasAspect > 1 ? containerSize : containerSize * canvasAspect;
      const scale = targetSize / cssWidth;
      stamp.style.transform = 'scale(' + scale + ')';
    } else {
      // Calculate CSS dimensions to fit within container (for back button)
      if (canvasAspect > containerAspect) {
        cssWidth = containerRect.width;
        cssHeight = containerRect.width / canvasAspect;
      } else {
        cssHeight = containerRect.height;
        cssWidth = containerRect.height * canvasAspect;
      }
    }

    // Center within container
    const centerX = containerRect.left + containerRect.width / 2;
    const centerY = containerRect.top + containerRect.height / 2;

    stamp.className = 'flying-stamp';
    stamp.style.left = (centerX - cssWidth / 2) + 'px';
    stamp.style.top = (centerY - cssHeight / 2) + 'px';
    stamp.style.width = cssWidth + 'px';
    stamp.style.height = cssHeight + 'px';
    document.body.appendChild(stamp);

    return stamp;
  }

  /**
   * Render pixel art to a canvas with outlined edges
   * @param {number} width - Grid width in cells
   * @param {number} height - Grid height in cells
   * @param {number} targetSize - Target canvas size in pixels
   * @param {Function} getColorAt - Callback (row, col) => [r,g,b] or null for empty
   * @returns {HTMLCanvasElement} Canvas with outlined pixel art
   */
  function renderOutlinedCanvas(width, height, targetSize, getColorAt) {
    const maxDim = Math.max(width, height);
    const cellSize = Math.max(2, Math.floor(targetSize / maxDim));
    const padding = CONFIG.OUTLINE_THICKNESS * 2;
    const offset = CONFIG.OUTLINE_THICKNESS;

    const canvas = document.createElement('canvas');
    canvas.width = width * cellSize + padding;
    canvas.height = height * cellSize + padding;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[Utils] Failed to get 2D context for canvas');
      return canvas;
    }

    try {
      // Get theme-aware outline color from CSS variable
      const outlineColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-text-muted').trim() || '#8a8a7a';

      // Draw outlines first
      ctx.fillStyle = outlineColor;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const color = getColorAt(row, col);
          if (color) {
            const px = offset + col * cellSize;
            const py = offset + row * cellSize;
            ctx.fillRect(
              px - CONFIG.OUTLINE_THICKNESS,
              py - CONFIG.OUTLINE_THICKNESS,
              cellSize + padding,
              cellSize + padding
            );
          }
        }
      }

      // Draw all fills on top
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const color = getColorAt(row, col);
          if (color) {
            ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            const px = offset + col * cellSize;
            const py = offset + row * cellSize;
            ctx.fillRect(px, py, cellSize, cellSize);
          }
        }
      }
    } catch (e) {
      console.error('[Utils] Failed to render canvas:', e);
    }

    return canvas;
  }

  // === Colorblind Support ===
  // Daltonization algorithm to make colors more distinguishable for colorblind users
  // Based on Brettel, Viénot, and Mollon (1997) simulation + compensation

  // RGB to LMS conversion matrix (Hunt-Pointer-Estevez)
  const RGB_TO_LMS = [
    [0.31399022, 0.63951294, 0.04649755],
    [0.15537241, 0.75789446, 0.08670142],
    [0.01775239, 0.10944209, 0.87256922]
  ];

  // LMS to RGB conversion matrix (inverse)
  const LMS_TO_RGB = [
    [5.47221206, -4.64196010, 0.16963708],
    [-1.12524190, 2.29317094, -0.16789520],
    [0.02980165, -0.19318073, 1.16364789]
  ];

  // Simulation matrices for each type of colorblindness
  // These transform LMS values to simulate what colorblind person sees
  const COLORBLIND_MATRICES = {
    protanopia: [
      [0, 1.05118294, -0.05116099],
      [0, 1, 0],
      [0, 0, 1]
    ],
    deuteranopia: [
      [1, 0, 0],
      [0.9513092, 0, 0.04866992],
      [0, 0, 1]
    ],
    tritanopia: [
      [1, 0, 0],
      [0, 1, 0],
      [-0.86744736, 1.86727089, 0]
    ]
  };

  /**
   * Multiply a 3x3 matrix by a 3-element vector
   */
  function matrixMultiply(matrix, vector) {
    return [
      matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
      matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
      matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
    ];
  }

  /**
   * Clamp a value to 0-255 range
   */
  function clamp255(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  /**
   * Transform a color for colorblind users using daltonization.
   * Takes the error (what colorblind person can't see) and shifts it
   * to wavelengths they CAN see.
   *
   * @param {number[]} rgb - [r, g, b] array with values 0-255
   * @param {string} mode - 'protanopia', 'deuteranopia', or 'tritanopia'
   * @returns {number[]} Transformed [r, g, b] array
   */
  function daltonize(rgb, mode) {
    if (!mode || mode === 'off' || !COLORBLIND_MATRICES[mode]) {
      return rgb;
    }

    // Normalize to 0-1 range
    const rgbNorm = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];

    // Convert RGB to LMS
    const lms = matrixMultiply(RGB_TO_LMS, rgbNorm);

    // Simulate colorblind vision
    const lmsSim = matrixMultiply(COLORBLIND_MATRICES[mode], lms);

    // Convert simulated LMS back to RGB
    const rgbSim = matrixMultiply(LMS_TO_RGB, lmsSim);

    // Calculate error (what the colorblind person can't see)
    const error = [
      rgbNorm[0] - rgbSim[0],
      rgbNorm[1] - rgbSim[1],
      rgbNorm[2] - rgbSim[2]
    ];

    // Shift error to visible channels
    // For protanopia/deuteranopia: shift red/green error to blue
    // For tritanopia: shift blue error to red/green
    let errorShift;
    if (mode === 'tritanopia') {
      errorShift = [
        error[2] * 0.7,           // Add some blue error to red
        error[2] * 0.7,           // Add some blue error to green
        0
      ];
    } else {
      errorShift = [
        0,
        error[0] * 0.7 + error[1] * 0.7,  // Shift red+green error to green channel
        error[0] * 0.7 + error[1] * 0.7   // Shift red+green error to blue channel
      ];
    }

    // Apply correction
    const corrected = [
      clamp255((rgbNorm[0] + errorShift[0]) * 255),
      clamp255((rgbNorm[1] + errorShift[1]) * 255),
      clamp255((rgbNorm[2] + errorShift[2]) * 255)
    ];

    return corrected;
  }

  /**
   * Get the current colorblind mode from storage
   * @returns {string} Current mode or 'off'
   */
  function getColorblindMode() {
    if (window.Cozy.Storage) {
      return window.Cozy.Storage.getSetting('colorblindMode') || 'off';
    }
    return 'off';
  }

  /**
   * Transform a color based on current colorblind setting
   * @param {number[]} rgb - [r, g, b] array with values 0-255
   * @returns {number[]} Transformed [r, g, b] array
   */
  function getDisplayColor(rgb) {
    const mode = getColorblindMode();
    return daltonize(rgb, mode);
  }

  // === Export ===
  // Create the global Cozy namespace (other modules add themselves to it)
  window.Cozy = window.Cozy || {};
  window.Cozy.Utils = {
    CONFIG,
    getPuzzleId,
    getPuzzleTitle,
    parsePuzzleTitle,
    initOnce,
    createFlyingStamp,
    renderOutlinedCanvas,
    daltonize,
    getColorblindMode,
    getDisplayColor
  };
})();
