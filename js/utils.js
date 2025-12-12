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
    COMFORTABLE_ZOOM: 2.0       // Suggested zoom for comfortable touch targets
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

  // === Export ===
  window.CozyUtils = {
    CONFIG,
    getPuzzleId,
    getPuzzleTitle,
    parsePuzzleTitle
  };
})();
