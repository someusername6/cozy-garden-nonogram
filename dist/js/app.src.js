// ============================================================
// FILE: src/js/utils.js
// ============================================================

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

  // === Export ===
  // Create the global Cozy namespace (other modules add themselves to it)
  window.Cozy = window.Cozy || {};
  window.Cozy.Utils = {
    CONFIG,
    getPuzzleId,
    getPuzzleTitle,
    parsePuzzleTitle,
    renderOutlinedCanvas
  };
})();


// ============================================================
// FILE: src/js/storage.js
// ============================================================

// Cozy Garden - Storage Module
// Handles progress persistence using localStorage with IndexedDB fallback

(function() {
  'use strict';

  const STORAGE_KEY = 'cozy_garden_data';
  const STORAGE_VERSION = 1;

  // Validate that parsed data has the expected structure
  function isValidStorageData(data) {
    if (!data || typeof data !== 'object') return false;
    // Must have version number
    if (typeof data.version !== 'number') return false;
    // Core objects must exist and be objects (or null for optional fields)
    if (data.progress !== null && typeof data.progress !== 'object') return false;
    if (data.settings !== null && typeof data.settings !== 'object') return false;
    if (data.stats !== null && typeof data.stats !== 'object') return false;
    return true;
  }

  // Default data structure
  function getDefaultData() {
    return {
      version: STORAGE_VERSION,
      progress: {}, // puzzleId -> { completed: bool, bestTime: ms, attempts: int }
      settings: {
        vibration: true,
        theme: 'light'
      },
      stats: {
        totalCompleted: 0,
        totalAttempts: 0,
        totalPlayTime: 0, // milliseconds
        streak: 0,
        lastPlayDate: null
      },
      currentSession: {
        puzzleIndex: 0,
        difficulty: 'easy',
        grid: null, // Saved grid state for current puzzle
        startTime: null
      },
      // One-time UI flags (things shown once to user)
      flags: {
        tutorialCompleted: false,
        helpShown: false,
        zoomHintShown: false
      },
      // Persistent UI state
      uiState: {
        collapsedSections: [] // Collection screen collapsed categories
      }
    };
  }

  // Storage class
  class GameStorage {
    constructor() {
      this.data = null;
      this.listeners = [];
    }

    // Initialize storage
    init() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Validate structure before using
          if (!isValidStorageData(parsed)) {
            console.warn('[Storage] Invalid data structure, using defaults');
            this.data = getDefaultData();
            this.save();
          } else {
            this.data = parsed;
          }
        } else {
          this.data = getDefaultData();
          this.save();
        }
      } catch (e) {
        console.warn('[Storage] Failed to load, using defaults:', e);
        this.data = getDefaultData();
        // Save defaults to overwrite corrupted data
        this.save();
      }
      return this;
    }

    // Save to localStorage
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        this.notifyListeners('save');
        return true;
      } catch (e) {
        console.error('[Storage] Failed to save:', e);
        return false;
      }
    }

    // Add change listener
    onChange(callback) {
      this.listeners.push(callback);
      return () => {
        this.listeners = this.listeners.filter(l => l !== callback);
      };
    }

    notifyListeners(event) {
      this.listeners.forEach(l => l(event, this.data));
    }

    // === Progress Methods ===

    // Get puzzle progress
    getPuzzleProgress(puzzleId) {
      return this.data.progress[puzzleId] || {
        completed: false,
        bestTime: null,
        attempts: 0,
        lastPlayed: null,
        savedGrid: null
      };
    }

    // Save grid state for a puzzle (for resuming later)
    // Grid format: array of rows, each row is array of {value, certain} objects
    savePuzzleGrid(puzzleId, grid) {
      // Ensure progress object exists
      if (!this.data.progress) {
        this.data.progress = {};
      }
      // Create progress entry if it doesn't exist
      if (!this.data.progress[puzzleId]) {
        this.data.progress[puzzleId] = {
          completed: false,
          bestTime: null,
          attempts: 0,
          lastPlayed: null,
          savedGrid: null
        };
      }
      // Save the grid (deep copy)
      if (grid) {
        this.data.progress[puzzleId].savedGrid = grid.map(row =>
          row.map(cell => ({ value: cell.value, certain: cell.certain }))
        );
      } else {
        this.data.progress[puzzleId].savedGrid = null;
      }
      this.save();
    }

    // Get saved grid for a puzzle
    // Returns grid as array of {value, certain} objects
    getPuzzleGrid(puzzleId) {
      if (!this.data.progress) return null;
      const progress = this.data.progress[puzzleId];
      if (!progress || !progress.savedGrid) return null;

      // Deep copy
      return progress.savedGrid.map(row =>
        row.map(cell => ({ value: cell.value, certain: cell.certain }))
      );
    }

    // Mark puzzle as completed
    completePuzzle(puzzleId) {
      const progress = this.getPuzzleProgress(puzzleId);
      const wasNew = !progress.completed;

      progress.completed = true;
      progress.attempts += 1;
      progress.lastPlayed = Date.now();
      progress.savedGrid = null; // Clear saved grid on completion

      this.data.progress[puzzleId] = progress;

      // Update stats
      if (wasNew) {
        this.data.stats.totalCompleted += 1;
      }
      this.data.stats.totalAttempts += 1;
      this.updateStreak();

      this.save();
      return { wasNew, progress };
    }

    // Check if puzzle is completed
    isPuzzleCompleted(puzzleId) {
      return this.data.progress[puzzleId]?.completed || false;
    }

    // Get completion count by difficulty
    getCompletionStats() {
      const stats = {
        easy: { completed: 0, total: 0 },
        medium: { completed: 0, total: 0 },
        hard: { completed: 0, total: 0 },
        challenging: { completed: 0, total: 0 },
        expert: { completed: 0, total: 0 }
      };

      // This will be populated when puzzles are loaded
      return stats;
    }

    // === Session Methods ===

    // Save current session state
    // Grid format: array of rows, each row is array of {value, certain} objects
    saveSession(puzzleIndex, difficulty, grid) {
      let savedGrid = null;
      if (grid) {
        savedGrid = grid.map(row =>
          row.map(cell => ({ value: cell.value, certain: cell.certain }))
        );
      }

      this.data.currentSession = {
        puzzleIndex,
        difficulty,
        grid: savedGrid
      };
      this.save();
    }

    // Get current session
    getSession() {
      return this.data.currentSession;
    }

    // Clear current session
    clearSession() {
      this.data.currentSession = {
        puzzleIndex: 0,
        difficulty: 'easy',
        grid: null
      };
      this.save();
    }

    // === Settings Methods ===

    // Get a setting
    getSetting(key) {
      return this.data.settings[key];
    }

    // Set a setting
    setSetting(key, value) {
      this.data.settings[key] = value;
      this.save();
      this.notifyListeners('settings');
    }

    // Get all settings
    getSettings() {
      return { ...this.data.settings };
    }

    // === Stats Methods ===

    getStats() {
      return { ...this.data.stats };
    }

    addPlayTime(ms) {
      this.data.stats.totalPlayTime += ms;
      this.save();
    }

    updateStreak() {
      const today = new Date().toDateString();
      const lastPlay = this.data.stats.lastPlayDate;

      if (lastPlay === today) {
        // Same day, no change
        return;
      }

      const yesterday = new Date(Date.now() - 86400000).toDateString();

      if (lastPlay === yesterday) {
        // Consecutive day, increment streak
        this.data.stats.streak += 1;
      } else if (lastPlay !== today) {
        // Streak broken
        this.data.stats.streak = 1;
      }

      this.data.stats.lastPlayDate = today;
    }

    // === Flags Methods (one-time UI flags) ===

    getFlag(key) {
      return this.data.flags?.[key] || false;
    }

    setFlag(key, value = true) {
      if (!this.data.flags) this.data.flags = {};
      this.data.flags[key] = value;
      this.save();
    }

    // === UI State Methods ===

    getUIState(key) {
      return this.data.uiState?.[key];
    }

    setUIState(key, value) {
      if (!this.data.uiState) this.data.uiState = {};
      this.data.uiState[key] = value;
      this.save();
    }

    // === Export/Import ===

    exportData() {
      return JSON.stringify(this.data, null, 2);
    }

    importData(jsonString) {
      try {
        const imported = JSON.parse(jsonString);
        if (isValidStorageData(imported)) {
          this.data = imported;
          this.save();
          return true;
        }
        return false;
      } catch (e) {
        console.error('[Storage] Import failed:', e);
        return false;
      }
    }

    // Reset all data
    reset() {
      this.data = getDefaultData();
      this.save();
      this.notifyListeners('reset');
    }
  }

  // Create singleton instance
  const storage = new GameStorage().init();

  // Expose globally
  window.Cozy.Storage = storage;
})();


// ============================================================
// FILE: src/js/history.js
// ============================================================

// Cozy Garden - History Module
// Handles undo/redo functionality with action grouping for drag operations

(function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG } = window.Cozy.Utils;

  let undoStack = [];
  let redoStack = [];
  let pendingAction = null;  // For grouping drag operations

  /**
   * Action structure:
   * {
   *   type: 'fill' | 'batch-clear' | 'batch-confirm' | 'reset',
   *   changes: Array<{
   *     row: number,
   *     col: number,
   *     before: { value: number|null, certain: boolean },
   *     after: { value: number|null, certain: boolean }
   *   }>,
   *   timestamp: number
   * }
   */

  const History = {
    /**
     * Start a new action group (call on mousedown/touchstart)
     * @param {string} type - Action type identifier
     */
    beginAction(type = 'fill') {
      // If there's an uncommitted action, commit it first
      if (pendingAction && pendingAction.changes.length > 0) {
        this.commitAction();
      }

      pendingAction = {
        type: type,
        changes: [],
        timestamp: Date.now()
      };
    },

    /**
     * Record a cell change within current action
     * @param {number} row - Cell row
     * @param {number} col - Cell column
     * @param {Object} before - Previous cell state {value, certain}
     * @param {Object} after - New cell state {value, certain}
     */
    recordChange(row, col, before, after) {
      // Skip if no actual change
      if (before.value === after.value && before.certain === after.certain) {
        return;
      }

      if (!pendingAction) {
        // Single-click: create action on the fly
        this.beginAction('fill');
      }

      // Check if this cell was already modified in this action
      // If so, update the 'after' state instead of adding duplicate
      const existingChange = pendingAction.changes.find(
        c => c.row === row && c.col === col
      );

      if (existingChange) {
        existingChange.after = { value: after.value, certain: after.certain };
      } else {
        // Deep copy the states
        pendingAction.changes.push({
          row,
          col,
          before: { value: before.value, certain: before.certain },
          after: { value: after.value, certain: after.certain }
        });
      }
    },

    /**
     * Commit the current action group (call on mouseup/touchend)
     */
    commitAction() {
      if (pendingAction && pendingAction.changes.length > 0) {
        // Filter out no-op changes (before === after)
        pendingAction.changes = pendingAction.changes.filter(c =>
          c.before.value !== c.after.value || c.before.certain !== c.after.certain
        );

        if (pendingAction.changes.length > 0) {
          undoStack.push(pendingAction);

          // Trim history if too long
          if (undoStack.length > CONFIG.MAX_HISTORY) {
            undoStack.shift();
          }

          // Clear redo stack on new action
          redoStack = [];
        }

        this.updateUI();
      }
      pendingAction = null;
    },

    /**
     * Cancel current action without committing
     */
    cancelAction() {
      pendingAction = null;
    },

    /**
     * Record a batch operation as single action
     * Used for "clear all pencil marks", "confirm all", "reset"
     * @param {string} type - Action type
     * @param {Array} changes - Array of cell changes
     */
    recordBatchAction(type, changes) {
      if (changes.length === 0) return;

      const action = {
        type: type,
        changes: changes.map(c => ({
          row: c.row,
          col: c.col,
          before: { value: c.before.value, certain: c.before.certain },
          after: { value: c.after.value, certain: c.after.certain }
        })),
        timestamp: Date.now()
      };

      undoStack.push(action);
      if (undoStack.length > CONFIG.MAX_HISTORY) {
        undoStack.shift();
      }
      redoStack = [];
      this.updateUI();
    },

    /**
     * Undo last action
     * @returns {Array|null} Changes to apply, or null if nothing to undo
     */
    undo() {
      if (undoStack.length === 0) return null;

      const action = undoStack.pop();
      redoStack.push(action);
      this.updateUI();

      // Return changes to apply (restore 'before' states)
      return action.changes.map(c => ({
        row: c.row,
        col: c.col,
        state: { value: c.before.value, certain: c.before.certain }
      }));
    },

    /**
     * Redo last undone action
     * @returns {Array|null} Changes to apply, or null if nothing to redo
     */
    redo() {
      if (redoStack.length === 0) return null;

      const action = redoStack.pop();
      undoStack.push(action);
      this.updateUI();

      // Return changes to apply (restore 'after' states)
      return action.changes.map(c => ({
        row: c.row,
        col: c.col,
        state: { value: c.after.value, certain: c.after.certain }
      }));
    },

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
      return undoStack.length > 0;
    },

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
      return redoStack.length > 0;
    },

    /**
     * Clear all history (on puzzle switch)
     */
    clear() {
      undoStack = [];
      redoStack = [];
      pendingAction = null;
      this.updateUI();
    },

    /**
     * Update undo/redo button states
     */
    updateUI() {
      const undoBtn = document.getElementById('undo-btn');
      const redoBtn = document.getElementById('redo-btn');

      if (undoBtn) undoBtn.disabled = !this.canUndo();
      if (redoBtn) redoBtn.disabled = !this.canRedo();
    },

    /**
     * Get history statistics (for debugging/stats)
     * @returns {Object}
     */
    getStats() {
      return {
        undoDepth: undoStack.length,
        redoDepth: redoStack.length,
        hasPending: pendingAction !== null,
        pendingChanges: pendingAction ? pendingAction.changes.length : 0
      };
    }
  };

  // Expose globally
  window.Cozy.History = History;
})();


// ============================================================
// FILE: src/js/screens.js
// ============================================================

/**
 * Screen Manager for Cozy Garden
 * Handles navigation between screens with transitions
 */
const ScreenManager = (function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG, renderOutlinedCanvas } = window.Cozy.Utils;

  // Screen definitions
  const SCREENS = {
    SPLASH: 'splash',
    HOME: 'home',
    COLLECTION: 'collection',
    PUZZLE: 'puzzle',
    VICTORY: 'victory',
    SETTINGS: 'settings',
    TUTORIAL: 'tutorial'
  };

  // Current state
  let currentScreen = null;
  let screenHistory = [];
  let screenData = {}; // Data passed between screens

  // Screen elements cache
  let screenElements = {};

  // Confirm modal state
  let confirmModalCallback = null;

  // === Confirm/Alert Modal Functions ===

  /**
   * Show a confirmation modal
   * @param {Object} options - Modal options
   * @param {string} options.title - Modal title
   * @param {string} options.message - Modal message
   * @param {string} [options.confirmText='Confirm'] - Confirm button text
   * @param {string} [options.cancelText='Cancel'] - Cancel button text
   * @param {boolean} [options.danger=false] - Use danger styling for confirm button
   * @param {Function} options.onConfirm - Callback when confirmed
   * @param {Function} [options.onCancel] - Callback when cancelled
   */
  function showConfirmModal(options) {
    const modal = document.getElementById('confirm-modal');
    const title = document.getElementById('confirm-modal-title');
    const message = document.getElementById('confirm-modal-message');
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (!modal) return;

    // Set content
    title.textContent = options.title || 'Confirm';
    message.textContent = options.message || 'Are you sure?';
    confirmBtn.textContent = options.confirmText || 'Confirm';
    cancelBtn.textContent = options.cancelText || 'Cancel';

    // Set danger styling if needed
    confirmBtn.classList.toggle('confirm-modal-btn-danger', !!options.danger);
    confirmBtn.classList.toggle('confirm-modal-btn-primary', !options.danger);

    // Remove alert mode
    modal.classList.remove('alert-mode');

    // Store callback
    confirmModalCallback = options;

    // Show modal
    modal.classList.add('visible');

    // Focus confirm button for accessibility
    setTimeout(() => confirmBtn.focus(), 100);
  }

  /**
   * Show an alert modal (single OK button)
   * @param {Object} options - Modal options
   * @param {string} options.title - Modal title
   * @param {string} options.message - Modal message
   * @param {string} [options.buttonText='OK'] - Button text
   * @param {Function} [options.onClose] - Callback when closed
   */
  function showAlertModal(options) {
    const modal = document.getElementById('confirm-modal');
    const title = document.getElementById('confirm-modal-title');
    const message = document.getElementById('confirm-modal-message');
    const confirmBtn = document.getElementById('confirm-modal-confirm');

    if (!modal) return;

    // Set content
    title.textContent = options.title || 'Notice';
    message.textContent = options.message || '';
    confirmBtn.textContent = options.buttonText || 'OK';

    // Reset to primary styling
    confirmBtn.classList.remove('confirm-modal-btn-danger');
    confirmBtn.classList.add('confirm-modal-btn-primary');

    // Set alert mode (hides cancel button)
    modal.classList.add('alert-mode');

    // Store callback
    confirmModalCallback = { onConfirm: options.onClose };

    // Show modal
    modal.classList.add('visible');

    // Focus button for accessibility
    setTimeout(() => confirmBtn.focus(), 100);
  }

  /**
   * Hide the confirm modal
   */
  function hideConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) {
      modal.classList.remove('visible');
    }
    confirmModalCallback = null;
  }

  /**
   * Initialize confirm modal event listeners
   */
  function initConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    const backdrop = modal?.querySelector('.confirm-modal-backdrop');
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (!modal) return;

    // Confirm button
    confirmBtn?.addEventListener('click', () => {
      const callback = confirmModalCallback?.onConfirm;
      hideConfirmModal();
      // Delay callback to allow hide transition to complete before showing another modal
      if (callback) setTimeout(callback, 200);
    });

    // Cancel button
    cancelBtn?.addEventListener('click', () => {
      const callback = confirmModalCallback?.onCancel;
      hideConfirmModal();
      if (callback) callback();
    });

    // Backdrop click (only for non-destructive actions)
    backdrop?.addEventListener('click', () => {
      const callback = confirmModalCallback?.onCancel;
      hideConfirmModal();
      if (callback) callback();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('visible')) {
        const callback = confirmModalCallback?.onCancel;
        hideConfirmModal();
        if (callback) callback();
      }

      // Focus trap: keep Tab within modal when visible
      if (e.key === 'Tab' && modal.classList.contains('visible')) {
        const isAlertMode = modal.classList.contains('alert-mode');
        const focusableElements = isAlertMode ? [confirmBtn] : [cancelBtn, confirmBtn];
        const firstEl = focusableElements[0];
        const lastEl = focusableElements[focusableElements.length - 1];

        // Check if focus is within the modal
        const focusInModal = focusableElements.includes(document.activeElement);

        if (!focusInModal) {
          // Focus escaped, bring it back
          e.preventDefault();
          firstEl.focus();
        } else if (e.shiftKey) {
          // Shift+Tab: if on first element, go to last
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          // Tab: if on last element, go to first
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    });
  }

  /**
   * Initialize screen manager
   */
  function init() {
    // Apply saved theme immediately to prevent flash
    initTheme();

    // Initialize confirm modal
    initConfirmModal();

    // Cache all screen elements
    Object.values(SCREENS).forEach(screenId => {
      screenElements[screenId] = document.getElementById(`screen-${screenId}`);
    });

    // Handle browser back button
    window.addEventListener('popstate', handlePopState);

    // Global Escape key handler for back navigation
    document.addEventListener('keydown', handleGlobalEscape);

    // Start with splash screen
    showScreen(SCREENS.SPLASH, {}, false);
  }

  /**
   * Handle global Escape key for back navigation
   */
  function handleGlobalEscape(e) {
    if (e.key !== 'Escape') return;

    // Don't handle if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Let modals handle their own Escape (confirm modal, help modal)
    const confirmModal = document.getElementById('confirm-modal');
    const helpModal = document.getElementById('help-modal');
    if (confirmModal?.classList.contains('visible') || helpModal?.classList.contains('visible')) {
      return; // Modal handlers will deal with it
    }

    // Navigate based on current screen
    switch (currentScreen) {
      case SCREENS.HOME:
        // Already at home, do nothing
        break;
      case SCREENS.COLLECTION:
        showScreen(SCREENS.HOME);
        break;
      case SCREENS.PUZZLE:
        // Handled by game.js
        break;
      case SCREENS.VICTORY:
        showScreen(SCREENS.COLLECTION);
        break;
      case SCREENS.SETTINGS:
        showScreen(SCREENS.HOME);
        break;
      case SCREENS.TUTORIAL:
        // Skip tutorial
        if (window.Cozy.Storage) {
          window.Cozy.Storage.setFlag('tutorialComplete', true);
        }
        showScreen(SCREENS.HOME);
        break;
    }
  }

  /**
   * Show a screen with optional transition
   * @param {string} screenId - Screen to show
   * @param {object} data - Data to pass to screen
   * @param {boolean} addToHistory - Whether to add to navigation history
   */
  function showScreen(screenId, data = {}, addToHistory = true) {
    const targetScreen = screenElements[screenId];
    if (!targetScreen) {
      console.error(`Screen not found: ${screenId}`);
      return;
    }

    // Store data for the screen
    screenData = data;

    // Handle leaving the current screen
    if (currentScreen && screenElements[currentScreen]) {
      // Clean up zoom system when leaving puzzle screen
      if (currentScreen === SCREENS.PUZZLE && window.Cozy.Zoom) {
        window.Cozy.Zoom.destroy();
      }

      screenElements[currentScreen].classList.remove('screen-active');
      screenElements[currentScreen].classList.add('screen-hidden');
    }

    // Show target screen
    targetScreen.classList.remove('screen-hidden');
    targetScreen.classList.add('screen-active');

    // Track history for back navigation (with limit to prevent unbounded growth)
    if (addToHistory && currentScreen !== null) {
      screenHistory.push(currentScreen);
      // Trim history if it exceeds max length
      if (screenHistory.length > CONFIG.MAX_SCREEN_HISTORY) {
        screenHistory = screenHistory.slice(-CONFIG.MAX_SCREEN_HISTORY);
      }
      history.pushState({ screen: screenId }, '', `#${screenId}`);
    }

    const previousScreen = currentScreen;
    currentScreen = screenId;

    // Trigger screen-specific initialization
    onScreenEnter(screenId, data, previousScreen);
  }

  /**
   * Go back to previous screen
   */
  function goBack() {
    if (screenHistory.length > 0) {
      const previousScreen = screenHistory.pop();
      showScreen(previousScreen, {}, false);
      history.back();
    }
  }

  /**
   * Handle browser back/forward buttons
   */
  function handlePopState(event) {
    if (event.state && event.state.screen) {
      showScreen(event.state.screen, {}, false);
    } else if (screenHistory.length > 0) {
      const previousScreen = screenHistory.pop();
      showScreen(previousScreen, {}, false);
    }
  }

  /**
   * Called when entering a screen - trigger screen-specific logic
   */
  function onScreenEnter(screenId, data, previousScreen) {
    switch (screenId) {
      case SCREENS.SPLASH:
        initSplashScreen();
        break;
      case SCREENS.HOME:
        initHomeScreen();
        break;
      case SCREENS.COLLECTION:
        initCollectionScreen(data);
        break;
      case SCREENS.PUZZLE:
        initPuzzleScreen(data);
        break;
      case SCREENS.VICTORY:
        initVictoryScreen(data);
        break;
      case SCREENS.SETTINGS:
        initSettingsScreen();
        break;
      case SCREENS.TUTORIAL:
        initTutorialScreen();
        break;
    }
  }

  /**
   * Get current screen data
   */
  function getScreenData() {
    return screenData;
  }

  /**
   * Get current screen ID
   */
  function getCurrentScreen() {
    return currentScreen;
  }

  // ============================================
  // Screen Initialization Functions
  // ============================================

  /**
   * Splash Screen - Loading and branding
   */
  function initSplashScreen() {
    // Simulate loading (in real app, load assets here)
    setTimeout(() => {
      // Check for ?action=continue URL parameter (PWA shortcut)
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');

      if (action === 'continue') {
        // Clear URL parameter to avoid repeating on refresh
        const cleanUrl = window.location.pathname + window.location.hash;
        history.replaceState(null, '', cleanUrl);

        // Try to resume last session
        const storage = window.Cozy.Storage;
        if (storage) {
          const session = storage.getSession();
          if (session && typeof session.puzzleIndex === 'number') {
            showScreen(SCREENS.PUZZLE, { puzzleId: session.puzzleIndex });
            return;
          }
        }
        // No session to resume, fall through to normal flow
      }

      // Check if first time user
      const hasPlayedBefore = window.Cozy.Storage?.getFlag('tutorialCompleted');

      if (!hasPlayedBefore) {
        showScreen(SCREENS.TUTORIAL);
      } else {
        showScreen(SCREENS.HOME);
      }
    }, 1500); // Show splash for 1.5 seconds
  }

  /**
   * Home Screen - Main menu
   */
  function initHomeScreen() {
    // Attach event listeners (only once)
    const playBtn = document.getElementById('home-play-btn');
    const settingsBtn = document.getElementById('home-settings-btn');
    const progressEl = document.getElementById('home-progress');

    if (playBtn && !playBtn.hasAttribute('data-initialized')) {
      playBtn.addEventListener('click', () => showScreen(SCREENS.COLLECTION));
      playBtn.setAttribute('data-initialized', 'true');
    }

    if (settingsBtn && !settingsBtn.hasAttribute('data-initialized')) {
      settingsBtn.addEventListener('click', () => showScreen(SCREENS.SETTINGS));
      settingsBtn.setAttribute('data-initialized', 'true');
    }

    // Update progress display using CozyStorage
    if (progressEl && window.PUZZLE_DATA) {
      const puzzles = window.PUZZLE_DATA;
      const totalPuzzles = Array.isArray(puzzles) ? puzzles.length : 0;
      let solvedCount = 0;

      if (window.Cozy.Storage && window.Cozy.Garden?.getPuzzleId) {
        puzzles.forEach(puzzle => {
          const puzzleId = window.Cozy.Garden.getPuzzleId(puzzle);
          if (window.Cozy.Storage.isPuzzleCompleted(puzzleId)) {
            solvedCount++;
          }
        });
      }

      progressEl.textContent = `${solvedCount} / ${totalPuzzles} puzzles solved`;
    }

    // Focus management: focus on Play button
    if (playBtn) {
      setTimeout(() => playBtn.focus(), 100);
    }
  }

  /**
   * Collection Screen - Level select
   */
  function initCollectionScreen(data) {
    // Collection screen initialization is handled by game.js
    // Trigger a custom event so game.js can respond
    window.dispatchEvent(new CustomEvent('screen:collection', { detail: data }));

    // Focus management: focus on search input
    const searchInput = document.getElementById('collection-search-input');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 100);
    }
  }

  /**
   * Puzzle Screen - Gameplay
   */
  function initPuzzleScreen(data) {
    // Initialize zoom system for the puzzle screen
    if (window.Cozy.Zoom) {
      window.Cozy.Zoom.init();
    }

    // Puzzle screen initialization is handled by game.js
    // data should contain { puzzleId: string }
    window.dispatchEvent(new CustomEvent('screen:puzzle', { detail: data }));
  }

  // Store current victory puzzle ID for the continue button
  let victoryPuzzleId = null;

  /**
   * Victory Screen - Puzzle completion
   */
  function initVictoryScreen(data) {
    // data should contain { puzzleId, puzzleName, solution, palette }
    const titleEl = document.getElementById('victory-puzzle-name');
    const imageEl = document.getElementById('victory-image');
    const continueBtn = document.getElementById('victory-continue-btn');

    // Store puzzleId for the continue button handler
    victoryPuzzleId = data.puzzleId;

    if (titleEl && data.puzzleName) {
      titleEl.textContent = data.puzzleName;
    }

    if (imageEl && data.solution) {
      renderVictoryImage(imageEl, data.solution, data.palette);
    }

    // Set up continue button (only once)
    if (continueBtn && !continueBtn.hasAttribute('data-initialized')) {
      continueBtn.addEventListener('click', () => {
        // Get the victory canvas for the flying animation
        const victoryCanvas = imageEl ? imageEl.querySelector('canvas') : null;

        if (victoryCanvas) {
          // Get the container position (200x200 box) for centering
          const containerRect = imageEl.getBoundingClientRect();

          // Create a new canvas and copy the image content
          // (cloneNode doesn't copy canvas content)
          const flyingStamp = document.createElement('canvas');
          flyingStamp.width = victoryCanvas.width;
          flyingStamp.height = victoryCanvas.height;
          const ctx = flyingStamp.getContext('2d');
          ctx.drawImage(victoryCanvas, 0, 0);

          // Use canvas pixel dimensions for initial CSS size
          const cssWidth = victoryCanvas.width;
          const cssHeight = victoryCanvas.height;

          // Scale to fit within container while preserving aspect ratio
          const canvasAspect = victoryCanvas.width / victoryCanvas.height;
          const containerSize = Math.min(containerRect.width, containerRect.height);
          let targetSize;
          if (canvasAspect > 1) {
            targetSize = containerSize;
          } else {
            targetSize = containerSize * canvasAspect;
          }
          const initialScale = targetSize / cssWidth;

          // Center the stamp within the container bounds
          const centerX = containerRect.left + containerRect.width / 2;
          const centerY = containerRect.top + containerRect.height / 2;

          flyingStamp.className = 'flying-stamp';
          flyingStamp.style.left = (centerX - cssWidth / 2) + 'px';
          flyingStamp.style.top = (centerY - cssHeight / 2) + 'px';
          flyingStamp.style.width = cssWidth + 'px';
          flyingStamp.style.height = cssHeight + 'px';
          flyingStamp.style.transform = 'scale(' + initialScale + ')';
          document.body.appendChild(flyingStamp);

          // Go to collection with animation flag
          showScreen(SCREENS.COLLECTION, {
            scrollToPuzzleId: victoryPuzzleId,
            animateStamp: true,
            flyingStamp: flyingStamp
          });
        } else {
          // Fallback: just navigate without animation
          showScreen(SCREENS.COLLECTION, { scrollToPuzzleId: victoryPuzzleId });
        }
      });
      continueBtn.setAttribute('data-initialized', 'true');
    }

    // Focus management: focus on Continue button
    if (continueBtn) {
      setTimeout(() => continueBtn.focus(), 100);
    }
  }

  /**
   * Render completed puzzle image on victory screen
   */
  function renderVictoryImage(container, solution, palette) {
    container.innerHTML = '';
    const height = solution.length;
    const width = solution[0] ? solution[0].length : height;

    const canvas = renderOutlinedCanvas(
      width,
      height,
      CONFIG.VICTORY_CANVAS_SIZE,
      (row, col) => {
        const colorIndex = solution[row][col];
        if (colorIndex > 0 && palette[colorIndex]) {
          return palette[colorIndex];
        }
        return null;
      }
    );

    container.appendChild(canvas);
  }

  /**
   * Settings Screen
   */
  function initSettingsScreen() {
    const backBtn = document.getElementById('settings-back-btn');
    const vibrationToggle = document.getElementById('settings-vibration');
    const resetBtn = document.getElementById('settings-reset-btn');

    // Load current settings from CozyStorage (unified storage)
    const storage = window.Cozy.Storage;
    if (vibrationToggle) vibrationToggle.checked = storage?.getSetting('vibration') ?? true;

    // Back button
    if (backBtn && !backBtn.hasAttribute('data-initialized')) {
      backBtn.addEventListener('click', goBack);
      backBtn.setAttribute('data-initialized', 'true');
    }

    // Setting toggles - save to CozyStorage
    if (vibrationToggle && !vibrationToggle.hasAttribute('data-initialized')) {
      vibrationToggle.addEventListener('change', () => storage?.setSetting('vibration', vibrationToggle.checked));
      vibrationToggle.setAttribute('data-initialized', 'true');
    }

    // Reset progress
    if (resetBtn && !resetBtn.hasAttribute('data-initialized')) {
      resetBtn.addEventListener('click', () => {
        showConfirmModal({
          title: 'Reset Progress',
          message: 'Are you sure you want to reset all progress? This cannot be undone.',
          confirmText: 'Reset',
          cancelText: 'Cancel',
          danger: true,
          onConfirm: () => {
            // Clear game state (in-memory grid, etc.)
            if (window.Cozy.Garden && window.Cozy.Garden.clearAllState) {
              window.Cozy.Garden.clearAllState();
            }

            // Use CozyStorage reset (clears all progress, flags, and UI state)
            if (window.Cozy.Storage && window.Cozy.Storage.reset) {
              window.Cozy.Storage.reset();
            }

            // Refresh collection if visible
            if (window.Cozy.Collection) {
              window.Cozy.Collection.refresh();
            }

            showAlertModal({
              title: 'Progress Reset',
              message: 'All progress has been cleared.'
            });
          }
        });
      });
      resetBtn.setAttribute('data-initialized', 'true');
    }

    // Show tutorial button
    const tutorialBtn = document.getElementById('settings-tutorial-btn');
    if (tutorialBtn && !tutorialBtn.hasAttribute('data-initialized')) {
      tutorialBtn.addEventListener('click', () => {
        showScreen(SCREENS.TUTORIAL);
      });
      tutorialBtn.setAttribute('data-initialized', 'true');
    }

    // Theme selection
    const themeOptions = document.querySelectorAll('.theme-option');
    // Get current theme, defaulting to system preference if not set
    let currentTheme = window.Cozy.Storage?.getSetting('theme');
    if (!currentTheme || currentTheme === 'system') {
      currentTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // Mark current theme as active
    themeOptions.forEach(option => {
      const theme = option.dataset.theme;
      const isActive = theme === currentTheme;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // Add click handlers
    themeOptions.forEach(option => {
      if (!option.hasAttribute('data-initialized')) {
        option.addEventListener('click', () => {
          const theme = option.dataset.theme;

          // Update active state and aria-pressed
          themeOptions.forEach(opt => {
            opt.classList.remove('active');
            opt.setAttribute('aria-pressed', 'false');
          });
          option.classList.add('active');
          option.setAttribute('aria-pressed', 'true');

          // Save and apply theme
          if (window.Cozy.Storage) {
            window.Cozy.Storage.setSetting('theme', theme);
          }
          applyTheme(theme);
        });
        option.setAttribute('data-initialized', 'true');
      }
    });

    // Solve all puzzles (debug)
    const solveAllBtn = document.getElementById('settings-solve-all-btn');
    if (solveAllBtn && !solveAllBtn.hasAttribute('data-initialized')) {
      solveAllBtn.addEventListener('click', () => {
        showConfirmModal({
          title: 'Debug: Solve All',
          message: 'Mark all puzzles as solved? This is a debug feature.',
          confirmText: 'Solve All',
          cancelText: 'Cancel',
          onConfirm: () => {
            const puzzles = window.PUZZLE_DATA || [];
            const storage = window.Cozy.Storage;

            if (storage) {
              puzzles.forEach(puzzle => {
                // Use shared utility from CozyGarden if available for consistency
                let puzzleId;
                if (window.Cozy.Garden?.getPuzzleId) {
                  puzzleId = window.Cozy.Garden.getPuzzleId(puzzle);
                } else {
                  // Fallback - handle both concise (t) and verbose (title) formats
                  const title = puzzle.t || puzzle.title;
                  puzzleId = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
                }
                storage.completePuzzle(puzzleId);
              });
            }

            // Refresh collection if visible
            if (window.Cozy.Collection) {
              window.Cozy.Collection.refresh();
            }

            showAlertModal({
              title: 'All Puzzles Solved',
              message: `Marked ${puzzles.length} puzzles as solved!`
            });
          }
        });
      });
      solveAllBtn.setAttribute('data-initialized', 'true');
    }

    // Focus management: focus on vibration toggle (first interactive setting)
    if (vibrationToggle) {
      setTimeout(() => vibrationToggle.focus(), 100);
    }
  }

  /**
   * Tutorial Screen
   */
  // Tutorial state (module-level so it persists across re-initializations)
  let tutorialCurrentStep = 0;

  function initTutorialScreen() {
    const skipBtn = document.getElementById('tutorial-skip-btn');
    const nextBtn = document.getElementById('tutorial-next-btn');
    const steps = document.querySelectorAll('.tutorial-step');
    const dots = document.querySelectorAll('.tutorial-dot');

    function showStep(index) {
      steps.forEach((step, i) => {
        step.classList.toggle('active', i === index);
      });

      // Update dots
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });

      // Update button text on last step
      if (nextBtn) {
        nextBtn.textContent = index === steps.length - 1 ? 'Start Playing' : 'Next';
      }
    }

    function completeTutorial() {
      window.Cozy.Storage?.setFlag('tutorialCompleted', true);
      showScreen(SCREENS.HOME);
    }

    if (skipBtn && !skipBtn.hasAttribute('data-initialized')) {
      skipBtn.addEventListener('click', completeTutorial);
      skipBtn.setAttribute('data-initialized', 'true');
    }

    if (nextBtn && !nextBtn.hasAttribute('data-initialized')) {
      nextBtn.addEventListener('click', () => {
        if (tutorialCurrentStep < steps.length - 1) {
          tutorialCurrentStep++;
          showStep(tutorialCurrentStep);
        } else {
          completeTutorial();
        }
      });
      nextBtn.setAttribute('data-initialized', 'true');
    }

    // Reset to first step when entering
    tutorialCurrentStep = 0;
    showStep(0);

    // Focus management: focus on Next button
    if (nextBtn) {
      setTimeout(() => nextBtn.focus(), 100);
    }
  }

  // ============================================
  // Theme Management
  // ============================================

  /**
   * Apply theme to the document
   * @param {string} theme - 'light' or 'dark'
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Update theme-color meta tag for browser/PWA chrome
    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', theme === 'dark' ? '#0a1018' : '#4a7c3f');
    }
  }

  /**
   * Initialize theme from saved preference or system default
   */
  function initTheme() {
    let savedTheme = window.Cozy.Storage?.getSetting('theme');
    // Default to system preference if no saved theme (or legacy 'system' value)
    if (!savedTheme || savedTheme === 'system') {
      savedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(savedTheme);
  }

  // Public API
  return {
    init,
    showScreen,
    goBack,
    getScreenData,
    getCurrentScreen,
    applyTheme,
    initTheme,
    showConfirmModal,
    SCREENS
  };
})();

// Expose globally
window.Cozy.Screens = ScreenManager;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ScreenManager.init();
});


// ============================================================
// FILE: src/js/collection.js
// ============================================================

// Cozy Garden - Collection Screen
// Displays puzzles grouped by difficulty level

(function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG, getPuzzleId, getPuzzleTitle, parsePuzzleTitle, renderOutlinedCanvas } = window.Cozy.Utils;

  // Difficulty display order (derived from puzzles, but with preferred ordering)
  const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'challenging', 'expert'];

  // Get collapsed sections from CozyStorage
  function getCollapsedSections() {
    const stored = window.Cozy.Storage?.getUIState('collapsedSections');
    if (stored && typeof stored === 'object') {
      return stored;
    }
    return null;
  }

  // Save collapsed sections to CozyStorage
  function saveCollapsedSections(collapsed) {
    window.Cozy.Storage?.setUIState('collapsedSections', collapsed);
  }

  // Toggle section collapsed state
  function toggleSection(difficulty, collapsed) {
    const section = document.querySelector(`.collection-section[data-difficulty="${difficulty}"]`);
    if (!section) return;

    const isCollapsed = collapsed[difficulty];
    collapsed[difficulty] = !isCollapsed;
    saveCollapsedSections(collapsed);

    // Update UI
    section.classList.toggle('collapsed', !isCollapsed);
    const grid = section.querySelector('.collection-grid');
    const chevron = section.querySelector('.section-chevron');

    if (grid) {
      grid.style.display = !isCollapsed ? 'none' : 'flex';
    }
    if (chevron) {
      chevron.textContent = !isCollapsed ? '\u25B6' : '\u25BC';
    }
  }

  // Get storage instance
  function getStorage() {
    return window.Cozy.Storage || null;
  }

  // Group puzzles by difficulty
  function groupPuzzlesByDifficulty(puzzles) {
    const groups = {};

    puzzles.forEach((puzzle, index) => {
      const meta = parsePuzzleTitle(getPuzzleTitle(puzzle));
      const difficulty = meta.difficulty;

      if (!groups[difficulty]) {
        groups[difficulty] = [];
      }

      groups[difficulty].push({
        index: index,
        puzzle: puzzle,
        meta: meta,
        id: getPuzzleId(puzzle)
      });
    });

    return groups;
  }

  // Group puzzles by difficulty, using pre-computed original indices
  // puzzleItems is array of {puzzle, originalIndex}
  function groupPuzzlesByDifficultyWithIndex(puzzleItems) {
    const groups = {};

    puzzleItems.forEach(item => {
      const meta = parsePuzzleTitle(getPuzzleTitle(item.puzzle));
      const difficulty = meta.difficulty;

      if (!groups[difficulty]) {
        groups[difficulty] = [];
      }

      groups[difficulty].push({
        index: item.originalIndex,
        puzzle: item.puzzle,
        meta: meta,
        id: getPuzzleId(item.puzzle)
      });
    });

    return groups;
  }

  // Sort difficulties in preferred order
  function getSortedDifficulties(groups) {
    const difficulties = Object.keys(groups);

    return difficulties.sort((a, b) => {
      const indexA = DIFFICULTY_ORDER.indexOf(a);
      const indexB = DIFFICULTY_ORDER.indexOf(b);

      // Known difficulties come first in order
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;

      // Unknown difficulties sorted alphabetically
      return a.localeCompare(b);
    });
  }

  // Format difficulty name for display
  function formatDifficulty(difficulty) {
    return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  }

  // Get completion stats for a difficulty group
  function getGroupStats(puzzleItems) {
    const storage = getStorage();
    let completed = 0;

    if (storage) {
      puzzleItems.forEach(item => {
        if (storage.isPuzzleCompleted(item.id)) {
          completed++;
        }
      });
    }

    return {
      completed: completed,
      total: puzzleItems.length
    };
  }

  // Check if a saved grid has any filled cells
  function hasProgress(savedGrid) {
    if (!savedGrid) return false;
    for (const row of savedGrid) {
      for (const cell of row) {
        const value = (typeof cell === 'object' && cell !== null) ? cell.value : cell;
        if (value !== null) return true;
      }
    }
    return false;
  }

  // Create a puzzle card element
  // options.forceBlank: if true, show blank placeholder instead of completed thumbnail
  function createPuzzleCard(item, onClick, options = {}) {
    const storage = getStorage();
    const isCompleted = storage ? storage.isPuzzleCompleted(item.id) : false;
    const savedGrid = storage ? storage.getPuzzleGrid(item.id) : null;
    const hasPartialProgress = !isCompleted && hasProgress(savedGrid);

    const card = document.createElement('div');
    card.className = 'puzzle-card' + (isCompleted ? ' completed' : '') + (hasPartialProgress ? ' in-progress' : '');
    card.dataset.puzzleIndex = item.index;
    card.dataset.puzzleId = item.id;
    // Accessibility: make cards keyboard accessible (roving tabindex - manager sets focused to 0)
    card.tabIndex = -1;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${item.meta.name}, ${item.meta.width} by ${item.meta.height}${isCompleted ? ', completed' : ''}`);

    // Keyboard handler for accessibility (Enter/Space to select, arrows to navigate)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // Track this card as focused so we return to it
        if (window.Cozy.Collection) {
          window.Cozy.Collection.focusedCardId = item.id;
        }
        onClick(item.index);
        return;
      }
      // Arrow key navigation - delegate to collection manager
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (window.Cozy.Collection) {
          window.Cozy.Collection.navigateFromCard(card, e.key);
        }
      }
    });

    // Puzzle preview (mini grid or icon)
    const preview = document.createElement('div');
    preview.className = 'puzzle-card-preview';

    // Force blank placeholder for stamp animation
    if (options.forceBlank) {
      preview.classList.add('awaiting-stamp');
      const placeholder = document.createElement('div');
      placeholder.className = 'puzzle-card-placeholder';
      placeholder.textContent = '?';
      preview.appendChild(placeholder);
    } else if (isCompleted) {
      // Show solved thumbnail
      preview.appendChild(createMiniSolution(item.puzzle));
    } else if (hasPartialProgress) {
      // Show partial progress
      preview.appendChild(createMiniProgress(item.puzzle, savedGrid));
    } else {
      // Show question mark placeholder (puzzle not yet started)
      const placeholder = document.createElement('div');
      placeholder.className = 'puzzle-card-placeholder';
      placeholder.textContent = '?';
      preview.appendChild(placeholder);
    }

    card.appendChild(preview);

    // Puzzle name
    const name = document.createElement('div');
    name.className = 'puzzle-card-name';
    name.textContent = item.meta.name;
    card.appendChild(name);

    // Dimensions and color count badge
    const colors = Object.keys(item.puzzle.color_map).length;
    const badge = document.createElement('div');
    badge.className = 'puzzle-card-badge';
    badge.textContent = `${item.meta.width}×${item.meta.height} · ${colors}c`;
    card.appendChild(badge);

    // Click handler
    card.addEventListener('click', () => {
      // Track this card as focused so we return to it
      if (window.Cozy.Collection) {
        window.Cozy.Collection.focusedCardId = item.id;
      }
      onClick(item.index);
    });

    return card;
  }

  // Create mini solution preview (scaled down)
  function createMiniSolution(puzzle) {
    try {
      const canvas = renderOutlinedCanvas(
        puzzle.width,
        puzzle.height,
        CONFIG.MINI_CANVAS_SIZE,
        (row, col) => {
          const value = puzzle.solution?.[row]?.[col];
          if (value > 0) {
            const color = puzzle.color_map?.[value];
            if (color && Array.isArray(color) && color.length >= 3) {
              return color;
            }
          }
          return null;
        }
      );
      canvas.className = 'puzzle-mini-canvas';
      return canvas;
    } catch (e) {
      console.error('[Collection] Error creating mini solution:', e);
      return null;
    }
  }

  // Create mini progress preview (partial grid state)
  function createMiniProgress(puzzle, savedGrid) {
    try {
      const canvas = renderOutlinedCanvas(
        puzzle.width,
        puzzle.height,
        CONFIG.MINI_CANVAS_SIZE,
        (row, col) => {
          const cell = savedGrid?.[row]?.[col];
          const value = (typeof cell === 'object' && cell !== null) ? cell.value : cell;
          if (value !== null && value > 0) {
            const color = puzzle.color_map?.[value];
            if (color && Array.isArray(color) && color.length >= 3) {
              return color;
            }
          }
          return null;
        }
      );
      canvas.className = 'puzzle-mini-canvas';
      return canvas;
    } catch (e) {
      console.error('[Collection] Error creating mini progress:', e);
      return null;
    }
  }

  // Render the collection screen
  // options.blankPuzzleId: puzzle ID to render with blank placeholder (for stamp animation)
  // options.searchFilter: string to filter puzzles by name prefix
  function renderCollection(container, puzzles, onPuzzleSelect, options = {}) {
    container.innerHTML = '';

    // Filter puzzles by search term if provided, preserving original indices
    // Limit search length to prevent DoS via extremely long strings
    const searchFilter = (options.searchFilter || '').toLowerCase().trim().slice(0, CONFIG.MAX_SEARCH_LENGTH);

    // Create array of {puzzle, originalIndex} to preserve indices through filtering
    let puzzleItems = puzzles.map((puzzle, index) => ({ puzzle, originalIndex: index }));

    if (searchFilter) {
      puzzleItems = puzzleItems.filter(item => {
        const meta = parsePuzzleTitle(getPuzzleTitle(item.puzzle));
        const name = meta.name.toLowerCase();
        return name.includes(searchFilter);
      });
    }

    const groups = groupPuzzlesByDifficultyWithIndex(puzzleItems);
    const sortedDifficulties = getSortedDifficulties(groups);
    const storage = getStorage();

    // Show empty state if search returned no results
    if (sortedDifficulties.length === 0 && searchFilter) {
      const emptyState = document.createElement('div');
      emptyState.className = 'collection-empty-state';

      const message = document.createElement('p');
      message.className = 'collection-empty-message';
      message.textContent = `No puzzles match "${searchFilter}"`;
      emptyState.appendChild(message);

      container.appendChild(emptyState);
      return;
    }

    // Get or calculate collapsed state
    // When searching, expand all sections to show results
    let collapsed;
    if (searchFilter) {
      collapsed = {};
      sortedDifficulties.forEach(difficulty => {
        collapsed[difficulty] = false;
      });
    } else {
      collapsed = getCollapsedSections();
      if (!collapsed) {
        // Default: collapse all except first difficulty with incomplete puzzles
        collapsed = {};
        let foundIncomplete = false;

        sortedDifficulties.forEach(difficulty => {
          const stats = getGroupStats(groups[difficulty]);
          if (!foundIncomplete && stats.completed < stats.total) {
            // First incomplete section - expand it
            collapsed[difficulty] = false;
            foundIncomplete = true;
          } else {
            // Collapse others
            collapsed[difficulty] = true;
          }
        });

        // If all complete, expand the first one
        if (!foundIncomplete && sortedDifficulties.length > 0) {
          collapsed[sortedDifficulties[0]] = false;
        }

        saveCollapsedSections(collapsed);
      }
    }

    // Render each difficulty section
    sortedDifficulties.forEach(difficulty => {
      const puzzleItems = groups[difficulty];
      const stats = getGroupStats(puzzleItems);
      const isCollapsed = collapsed[difficulty];

      const section = document.createElement('div');
      section.className = 'collection-section' + (isCollapsed ? ' collapsed' : '');
      section.dataset.difficulty = difficulty;

      // Section header (clickable)
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'collection-section-header';
      sectionHeader.style.cursor = 'pointer';

      // Chevron indicator
      const chevron = document.createElement('span');
      chevron.className = 'section-chevron';
      chevron.textContent = isCollapsed ? '\u25B6' : '\u25BC';
      sectionHeader.appendChild(chevron);

      const sectionTitle = document.createElement('h3');
      sectionTitle.className = 'collection-section-title';
      sectionTitle.textContent = formatDifficulty(difficulty);
      sectionHeader.appendChild(sectionTitle);

      const sectionStats = document.createElement('span');
      sectionStats.className = 'collection-section-stats';
      sectionStats.textContent = `${stats.completed}/${stats.total}`;
      if (stats.completed === stats.total && stats.total > 0) {
        sectionStats.classList.add('complete');
      }
      sectionHeader.appendChild(sectionStats);

      // Click to toggle
      sectionHeader.addEventListener('click', () => {
        toggleSection(difficulty, collapsed);
      });

      section.appendChild(sectionHeader);

      // Puzzle grid
      const grid = document.createElement('div');
      grid.className = 'collection-grid';
      grid.style.display = isCollapsed ? 'none' : 'flex';

      puzzleItems.forEach(item => {
        const cardOptions = {};
        if (options.blankPuzzleId && item.id === options.blankPuzzleId) {
          cardOptions.forceBlank = true;
        }
        const card = createPuzzleCard(item, onPuzzleSelect, cardOptions);
        grid.appendChild(card);
      });

      section.appendChild(grid);
      container.appendChild(section);
    });
  }

  // Collection manager class
  class CollectionManager {
    constructor() {
      this.container = null;
      this.puzzles = [];
      this.onPuzzleSelect = null;
      this.visible = true;
      this.searchFilter = '';
      this.searchInput = null;
      this.searchInputHandler = null;  // Store handler reference for cleanup
      this.searchDebounceTimeout = null;  // Debounce timer for search
      this.focusedCardId = null;  // Track focused card for roving tabindex
    }

    init(containerId, puzzles, onPuzzleSelect) {
      this.container = document.getElementById(containerId);
      this.puzzles = puzzles;
      this.onPuzzleSelect = onPuzzleSelect;

      // Set up search input (with cleanup to prevent memory leaks)
      this.searchInput = document.getElementById('collection-search-input');
      if (this.searchInput) {
        // Remove old handler if exists (prevents stacking on re-init)
        if (this.searchInputHandler) {
          this.searchInput.removeEventListener('input', this.searchInputHandler);
        }
        // Create and store new handler (debounced to avoid excessive re-renders)
        this.searchInputHandler = (e) => {
          this.searchFilter = e.target.value;
          // Debounce render to avoid re-rendering on every keystroke
          if (this.searchDebounceTimeout) {
            clearTimeout(this.searchDebounceTimeout);
          }
          this.searchDebounceTimeout = setTimeout(() => this.render(), 150);
        };
        this.searchInput.addEventListener('input', this.searchInputHandler);
      }

      if (this.container) {
        this.render();
      }

      return this;
    }

    render(options = {}) {
      if (!this.container) return;
      const renderOptions = {
        ...options,
        searchFilter: this.searchFilter
      };
      renderCollection(this.container, this.puzzles, (index) => {
        if (this.onPuzzleSelect) {
          this.onPuzzleSelect(index);
        }
      }, renderOptions);
      // Update roving tabindex after render
      this.updateRovingTabindex();
    }

    show() {
      if (this.container) {
        this.container.style.display = 'block';
        this.visible = true;
        // Clear search filter when showing collection
        this.searchFilter = '';
        if (this.searchInput) {
          this.searchInput.value = '';
        }
        this.render(); // Re-render to update completion status
      }
    }

    hide() {
      if (this.container) {
        this.container.style.display = 'none';
        this.visible = false;
      }
    }

    isVisible() {
      return this.visible;
    }

    // Refresh display (e.g., after completing a puzzle)
    // options.blankPuzzleId: puzzle ID to show with blank placeholder
    refresh(options = {}) {
      if (this.visible) {
        this.render(options);
      }
    }

    // Get all visible puzzle cards (in expanded sections)
    getVisibleCards() {
      if (!this.container) return [];
      const cards = [];
      const sections = this.container.querySelectorAll('.collection-section');
      sections.forEach(section => {
        const grid = section.querySelector('.collection-grid');
        if (grid && grid.style.display !== 'none') {
          const sectionCards = grid.querySelectorAll('.puzzle-card');
          sectionCards.forEach(card => cards.push(card));
        }
      });
      return cards;
    }

    // Find card in specified direction based on visual position
    // direction: 'up', 'down', 'left', 'right'
    findCardInDirection(currentCard, direction) {
      const cards = this.getVisibleCards();
      if (cards.length === 0) return null;

      const currentRect = currentCard.getBoundingClientRect();
      const currentCenterX = currentRect.left + currentRect.width / 2;
      const currentCenterY = currentRect.top + currentRect.height / 2;

      // Tolerance for "same row/column" comparison
      const rowTolerance = currentRect.height * 0.5;
      const colTolerance = currentRect.width * 0.5;

      let bestCandidate = null;
      let bestDistance = Infinity;

      cards.forEach(card => {
        if (card === currentCard) return;

        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let isValid = false;

        switch (direction) {
          case 'left':
            // Must be to the left and roughly same row
            isValid = centerX < currentCenterX - colTolerance &&
                      Math.abs(centerY - currentCenterY) < rowTolerance;
            break;
          case 'right':
            // Must be to the right and roughly same row
            isValid = centerX > currentCenterX + colTolerance &&
                      Math.abs(centerY - currentCenterY) < rowTolerance;
            break;
          case 'up':
            // Must be above (allow any column, prefer closest X)
            isValid = centerY < currentCenterY - rowTolerance;
            break;
          case 'down':
            // Must be below (allow any column, prefer closest X)
            isValid = centerY > currentCenterY + rowTolerance;
            break;
        }

        if (isValid) {
          // Calculate distance (Manhattan for same row/col, Euclidean for up/down)
          let distance;
          if (direction === 'left' || direction === 'right') {
            distance = Math.abs(centerX - currentCenterX);
          } else {
            // For up/down, prioritize closest Y first, then prefer similar X
            const yDist = Math.abs(centerY - currentCenterY);
            const xDist = Math.abs(centerX - currentCenterX);
            distance = yDist * 1000 + xDist; // Heavily weight Y distance
          }

          if (distance < bestDistance) {
            bestDistance = distance;
            bestCandidate = card;
          }
        }
      });

      return bestCandidate;
    }

    // Navigate from a card in response to arrow key
    navigateFromCard(card, key) {
      const directionMap = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right'
      };
      const direction = directionMap[key];
      if (!direction) return;

      const targetCard = this.findCardInDirection(card, direction);
      if (targetCard) {
        // Update tabindex for roving pattern
        card.tabIndex = -1;
        targetCard.tabIndex = 0;
        targetCard.focus();
        this.focusedCardId = targetCard.dataset.puzzleId;

        // Scroll into view if needed
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // Update roving tabindex after render
    updateRovingTabindex() {
      const cards = this.getVisibleCards();
      if (cards.length === 0) return;

      // Find the previously focused card or default to first
      let focusedCard = null;
      if (this.focusedCardId) {
        const candidate = this.container.querySelector(
          `.puzzle-card[data-puzzle-id="${this.focusedCardId}"]`
        );
        // Only use if it's actually in the visible cards array (not in collapsed section)
        if (candidate && cards.includes(candidate)) {
          focusedCard = candidate;
        }
      }

      // If previously focused card not found or not visible, use first visible card
      if (!focusedCard) {
        focusedCard = cards[0];
        this.focusedCardId = focusedCard?.dataset.puzzleId || null;
      }

      // Set all cards to tabindex=-1 except the focused one
      cards.forEach(card => {
        card.tabIndex = (card === focusedCard) ? 0 : -1;
      });
    }

    // Scroll to a specific puzzle by ID, expanding its section if needed
    // options.instant: use instant scroll instead of smooth
    scrollToPuzzle(puzzleId, options = {}) {
      if (!this.container) return;

      // Find the puzzle card by data attribute
      const cards = this.container.querySelectorAll('.puzzle-card');
      let targetCard = null;
      let targetIndex = -1;

      // Find puzzle index by ID
      for (let i = 0; i < this.puzzles.length; i++) {
        const id = getPuzzleId(this.puzzles[i]);
        if (id === puzzleId) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) return;

      // Find the card with this puzzle index
      cards.forEach(card => {
        if (parseInt(card.dataset.puzzleIndex, 10) === targetIndex) {
          targetCard = card;
        }
      });

      if (!targetCard) return;

      // Find the parent section and expand it if collapsed
      const section = targetCard.closest('.collection-section');
      if (section && section.classList.contains('collapsed')) {
        const difficulty = section.dataset.difficulty;
        const grid = section.querySelector('.collection-grid');
        const chevron = section.querySelector('.section-chevron');

        // Expand the section
        section.classList.remove('collapsed');
        if (grid) grid.style.display = 'flex';
        if (chevron) chevron.textContent = '\u25BC';

        // Update stored collapsed state
        let collapsed = getCollapsedSections() || {};
        collapsed[difficulty] = false;
        saveCollapsedSections(collapsed);
      }

      // Scroll the card into view with some padding
      const scrollBehavior = options.instant ? 'instant' : 'smooth';
      setTimeout(() => {
        targetCard.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
      }, options.instant ? 0 : 100);
    }

    // Animate a flying stamp canvas to a puzzle card
    // options.quick: use shorter delay for back button animation
    animateStampTo(puzzleId, flyingStamp, options = {}) {
      if (!this.container || !flyingStamp) return;

      // Find the target card
      const targetCard = this.container.querySelector(`.puzzle-card[data-puzzle-id="${puzzleId}"]`);
      if (!targetCard) {
        flyingStamp.remove();
        return;
      }

      const preview = targetCard.querySelector('.puzzle-card-preview');
      if (!preview) {
        flyingStamp.remove();
        return;
      }

      // Delay before calculating target position (after scroll settles)
      const scrollDelay = 100;

      // Wait for scroll to complete before calculating target position
      setTimeout(() => {
        // Get target position after scroll settles
        const targetRect = preview.getBoundingClientRect();

        // Calculate scale factor to match exact mini canvas dimensions
        // This prevents the visual jump when the stamp is replaced by the actual canvas
        const currentWidth = parseFloat(flyingStamp.style.width);
        const currentHeight = parseFloat(flyingStamp.style.height);

        // Find the puzzle to calculate exact mini canvas dimensions
        const puzzle = this.puzzles.find(p => getPuzzleId(p) === puzzleId);
        let targetWidth, targetHeight;

        if (puzzle) {
          // Match the calculation in renderOutlinedCanvas
          const maxDim = Math.max(puzzle.width, puzzle.height);
          const cellSize = Math.max(2, Math.floor(CONFIG.MINI_CANVAS_SIZE / maxDim));
          const padding = CONFIG.OUTLINE_THICKNESS * 2;
          targetWidth = puzzle.width * cellSize + padding;
          targetHeight = puzzle.height * cellSize + padding;
        } else {
          // Fallback to container-based scaling
          const stampAspect = currentWidth / currentHeight;
          if (stampAspect > 1) {
            targetWidth = targetRect.width;
            targetHeight = targetRect.width / stampAspect;
          } else {
            targetHeight = targetRect.height;
            targetWidth = targetRect.height * stampAspect;
          }
        }

        const scale = targetWidth / currentWidth;

        // Target center position
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;

        // Animate position to center and use transform for scaling (preserves aspect ratio)
        requestAnimationFrame(() => {
          flyingStamp.style.left = (targetCenterX - currentWidth / 2) + 'px';
          flyingStamp.style.top = (targetCenterY - currentHeight / 2) + 'px';
          flyingStamp.style.transform = 'scale(' + scale + ')';
          flyingStamp.classList.add('landed');
        });

        // After animation completes, update the card and remove the flying stamp
        setTimeout(() => {
          // Remove the awaiting-stamp class and re-render the preview with actual thumbnail
          preview.classList.remove('awaiting-stamp');
          preview.innerHTML = '';

          // Find the puzzle and create the mini solution or progress
          const puzzle = this.puzzles.find(p => {
            const id = getPuzzleId(p);
            return id === puzzleId;
          });

          if (puzzle) {
            // Check if completed or just partial progress
            const storage = getStorage();
            const isCompleted = storage ? storage.isPuzzleCompleted(puzzleId) : false;

            if (isCompleted) {
              preview.appendChild(createMiniSolution(puzzle));
            } else {
              // Show partial progress
              const savedGrid = storage ? storage.getPuzzleGrid(puzzleId) : null;
              if (savedGrid) {
                preview.appendChild(createMiniProgress(puzzle, savedGrid));
              }
            }
          }

          // Remove the flying stamp
          flyingStamp.remove();
        }, 650); // Match CSS transition duration + small buffer
      }, scrollDelay);
    }
  }

  // Create singleton
  const collection = new CollectionManager();

  // Expose globally
  window.Cozy.Collection = collection;
})();


// ============================================================
// FILE: src/js/app.js
// ============================================================

// Cozy Garden - PWA Application Module
// Handles PWA lifecycle and service worker

(function() {
  'use strict';

  const App = {
    // State
    isInstalled: false,
    swRegistration: null,
    resizeTimeout: null,

    // Initialize the app
    init() {
      this.checkInstallState();
      this.registerServiceWorker();
      this.setupEventListeners();

      console.log('[App] Cozy Garden initialized');
    },

    // Check if app is installed
    checkInstallState() {
      // Check display-mode
      if (window.matchMedia('(display-mode: standalone)').matches) {
        this.isInstalled = true;
      }
      // iOS Safari
      if (window.navigator.standalone === true) {
        this.isInstalled = true;
      }

      if (this.isInstalled) {
        document.body.classList.add('is-installed');
        console.log('[App] Running as installed PWA');
      }
    },

    // Register service worker
    async registerServiceWorker() {
      if (!('serviceWorker' in navigator)) {
        console.log('[App] Service workers not supported');
        return;
      }

      try {
        this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });

        console.log('[App] Service worker registered:', this.swRegistration.scope);

        // Check for updates
        this.swRegistration.addEventListener('updatefound', () => {
          const newWorker = this.swRegistration.installing;
          console.log('[App] New service worker installing...');

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              this.showUpdateNotification();
            }
          });
        });

      } catch (error) {
        console.error('[App] Service worker registration failed:', error);
      }
    },

    // Show update notification
    showUpdateNotification() {
      // Create a simple update banner (using DOM methods for CSP compliance)
      const banner = document.createElement('div');
      banner.className = 'update-banner';

      const span = document.createElement('span');
      span.textContent = 'A new version is available!';

      const updateBtn = document.createElement('button');
      updateBtn.textContent = 'Update';
      updateBtn.addEventListener('click', () => this.applyUpdate());

      const laterBtn = document.createElement('button');
      laterBtn.textContent = 'Later';
      laterBtn.addEventListener('click', () => banner.remove());

      banner.appendChild(span);
      banner.appendChild(updateBtn);
      banner.appendChild(laterBtn);
      document.body.appendChild(banner);
    },

    // Apply update
    applyUpdate() {
      if (this.swRegistration && this.swRegistration.waiting) {
        this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    },

    // Setup event listeners
    setupEventListeners() {
      // Handle app visibility changes
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.onAppFocus();
        } else {
          this.onAppBlur();
        }
      });

      // Handle page unload - save state
      window.addEventListener('beforeunload', () => {
        this.saveState();
      });

      // Handle orientation changes
      window.addEventListener('orientationchange', () => {
        setTimeout(() => this.handleResize(), 100);
      });

      // Handle resize (debounced to avoid excessive calls)
      window.addEventListener('resize', () => {
        if (this.resizeTimeout) {
          clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => this.handleResize(), 100);
      });
    },

    // App focus handler
    onAppFocus() {
      console.log('[App] App focused');
      // Could trigger data refresh here
    },

    // App blur handler
    onAppBlur() {
      console.log('[App] App blurred');
      this.saveState();
    },

    // Save current state
    saveState() {
      if (window.Cozy.Garden && window.Cozy.Storage) {
        // Game module will handle actual state saving
        console.log('[App] Saving state...');
      }
    },

    // Handle resize
    handleResize() {
      // Trigger any responsive adjustments
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    },

    // Check if running as PWA
    isPWA() {
      return this.isInstalled ||
             window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    },

    // Get app version from service worker
    async getVersion() {
      if (!this.swRegistration || !navigator.serviceWorker.controller) {
        return 'unknown';
      }

      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          resolve(event.data.version || 'unknown');
        };
        navigator.serviceWorker.controller.postMessage(
          { type: 'GET_VERSION' },
          [channel.port2]
        );

        // Timeout fallback
        setTimeout(() => resolve('unknown'), 1000);
      });
    },

    // Share functionality (Web Share API)
    async share(title, text, url) {
      if (navigator.share) {
        try {
          await navigator.share({ title, text, url });
          return true;
        } catch (e) {
          if (e.name !== 'AbortError') {
            console.error('[App] Share failed:', e);
          }
          return false;
        }
      }
      return false;
    },

    // Vibrate (if supported)
    vibrate(pattern = 50) {
      if (navigator.vibrate && window.Cozy.Storage?.getSetting('vibration')) {
        navigator.vibrate(pattern);
      }
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }

  // Expose globally
  window.Cozy.App = App;
})();


// ============================================================
// FILE: src/js/game.js
// ============================================================

/**
 * Cozy Garden - Nonogram Game Logic
 *
 * Core gameplay module handling puzzle rendering, user interaction, and win detection.
 *
 * Architecture:
 * - IIFE pattern with window.Cozy.Garden namespace for public API
 * - Grid state stored in `grid[][]` as {value, certain} objects
 * - DOM elements cached in cellElements[][], rowClueElements[], colClueElements[]
 * - Event handlers support mouse, touch, and keyboard (accessibility)
 *
 * Key flows:
 * - loadPuzzle() → buildPalette() + buildClues() + buildGrid() → restore session
 * - User interaction → fillCell() → updateCellVisual() + updateClueSatisfaction()
 * - Win check via clue validation (not solution comparison)
 *
 * Dependencies:
 * - window.PUZZLE_DATA from data/puzzles.js
 * - window.Cozy.Utils for CONFIG and shared utilities
 * - window.Cozy.Storage for progress persistence
 * - window.Cozy.History for undo/redo
 * - window.Cozy.Screens for navigation
 * - window.Cozy.Zoom for pinch-to-zoom integration
 *
 * @module game
 */

(function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG, getPuzzleId, getPuzzleTitle, renderOutlinedCanvas } = window.Cozy.Utils;

  // Game state
  let currentPuzzle = 0;
  let currentDifficulty = 'easy';
  let selectedColor = 1;
  let grid = [];           // Stores {value, certain} objects
  let isDragging = false;
  let dragColor = null;
  let dragCertain = true;  // Whether current drag creates certain or maybe cells
  let isPencilMode = false;  // Pencil mode for uncertain marks
  let isLoadingPuzzle = false;  // Guard against concurrent puzzle loads

  // Keyboard navigation state (roving tabindex)
  let focusedRow = 0;
  let focusedCol = 0;

  // Event handler references for cleanup (prevents memory leaks)
  let mouseUpHandler = null;
  let gridMouseLeaveHandler = null;
  let gridFocusOutHandler = null;

  // DOM element cache for performance (avoids repeated querySelector calls)
  let cellElements = [];  // 2D array: cellElements[row][col]
  let rowClueElements = [];  // rowClueElements[row]
  let colClueElements = [];  // colClueElements[col]

  // Clue satisfaction state for change detection (enables screen reader announcements)
  let rowSatisfied = [];  // boolean for each row
  let colSatisfied = [];  // boolean for each column

  // Help shown flag now stored in CozyStorage.flags.helpShown

  // === Toast Notification ===
  let toastTimeout = null;

  // Show a toast notification. Uses single-toast pattern: new messages replace
  // previous ones immediately. This is intentional - rapid actions show latest
  // feedback only, which is appropriate for non-critical UI messages.
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    // Clear any existing timeout (new toast replaces old one)
    clearTimeout(toastTimeout);

    // Update content and style
    toast.textContent = message;
    toast.className = 'toast visible';
    if (type === 'success') {
      toast.classList.add('toast-success');
    } else if (type === 'info') {
      toast.classList.add('toast-info');
    }

    // Auto-hide after duration
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, CONFIG.TOAST_DURATION);
  }

  function hideToast() {
    const toast = document.getElementById('toast');
    if (toast) {
      clearTimeout(toastTimeout);
      toast.classList.remove('visible');
    }
  }

  // === Help Modal ===

  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  function populateHelpContent() {
    const helpList = document.getElementById('help-list');
    if (!helpList) return;

    const isTouch = isTouchDevice();

    // Build help content based on device type
    let items = [
      '<li><strong>Select a color</strong> from the palette, then tap cells to fill them</li>',
      '<li><strong>Drag</strong> across cells to fill multiple at once</li>',
      '<li><strong>Long-press</strong> a cell to mark it ✕ (definitely empty)</li>',
      '<li><strong>Pencil mode</strong> marks uncertain guesses — confirm or clear them later</li>'
    ];

    // Add zoom hint for larger puzzles on touch devices
    if (isTouch) {
      items.push('<li><strong>Pinch to zoom</strong> on larger puzzles for easier tapping</li>');
    }

    // Add keyboard shortcuts section for non-touch devices
    if (!isTouch) {
      items.push('<li class="help-section-title">Keyboard Shortcuts</li>');
      items.push('<li><strong>Ctrl+Z</strong> / <strong>Ctrl+Y</strong> — Undo / Redo</li>');
      items.push('<li><strong>P</strong> — Toggle pencil mode</li>');
      items.push('<li><strong>1-9</strong> — Select color by number</li>');
      items.push('<li><strong>+</strong> / <strong>-</strong> — Zoom in / out</li>');
    }

    helpList.innerHTML = items.join('');
  }

  function showHelpModal() {
    const modal = document.getElementById('help-modal');
    if (!modal) return;

    populateHelpContent();
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden'; // Prevent background scroll

    // Focus close button for accessibility
    const closeBtn = modal.querySelector('.help-modal-close');
    if (closeBtn) {
      setTimeout(() => closeBtn.focus(), 100);
    }
  }

  function hideHelpModal() {
    const modal = document.getElementById('help-modal');
    if (!modal) return;

    modal.classList.remove('visible');
    document.body.style.overflow = '';
  }

  function setupHelpModal() {
    const helpBtn = document.getElementById('help-btn');
    const modal = document.getElementById('help-modal');
    const backdrop = modal?.querySelector('.help-modal-backdrop');
    const closeBtn = modal?.querySelector('.help-modal-close');

    if (helpBtn) {
      helpBtn.addEventListener('click', showHelpModal);
    }

    if (backdrop) {
      backdrop.addEventListener('click', hideHelpModal);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', hideHelpModal);
    }

    // Keyboard handling for modal
    document.addEventListener('keydown', (e) => {
      if (!modal?.classList.contains('visible')) return;

      // Close on Escape key
      if (e.key === 'Escape') {
        hideHelpModal();
        return;
      }

      // Focus trap: keep Tab within modal
      if (e.key === 'Tab') {
        // Only one focusable element (close button), so always keep focus there
        if (document.activeElement !== closeBtn) {
          e.preventDefault();
          closeBtn?.focus();
        } else {
          // Already on close button, prevent Tab from leaving
          e.preventDefault();
        }
      }
    });
  }

  /**
   * Set up skip link for keyboard navigation.
   * Focuses the first cell of the grid when activated.
   */
  function setupSkipLink() {
    const skipLink = document.getElementById('skip-to-puzzle');
    if (skipLink) {
      skipLink.addEventListener('click', (e) => {
        e.preventDefault();
        // Focus the first cell of the grid
        const firstCell = cellElements[0]?.[0];
        if (firstCell) {
          firstCell.focus();
        }
      });
    }
  }

  function maybeShowFirstTimeHelp() {
    // Show help modal automatically on first visit
    if (!window.Cozy.Storage?.getFlag('helpShown')) {
      // Small delay so the puzzle renders first
      setTimeout(() => {
        showHelpModal();
        window.Cozy.Storage?.setFlag('helpShown', true);
      }, 500);
    }
  }

  /**
   * Convert puzzle from concise storage format to verbose runtime format.
   * Handles both formats: returns verbose as-is, converts concise format.
   *
   * Concise format (storage): {t, w, h, r, c, p, s} with 0-indexed colors
   * Verbose format (runtime): {title, width, height, row_clues, col_clues, color_map, solution} with 1-indexed colors
   *
   * @param {Object} p - Puzzle in either format
   * @returns {Object|null} Normalized puzzle in verbose format, or null if invalid
   */
  function normalizePuzzle(p) {
    if (!p) return null;
    // Already in verbose format - validate basic structure
    if (p.title !== undefined) {
      if (!p.width || !p.height || !p.row_clues || !p.col_clues || !p.color_map) {
        console.warn('[Game] Invalid verbose puzzle format:', p.title);
        return null;
      }
      return p;
    }
    // Validate concise format has required fields with correct types
    if (!p.t || !p.w || !p.h || !Array.isArray(p.r) || !Array.isArray(p.c) ||
        !Array.isArray(p.p) || !Array.isArray(p.s)) {
      console.warn('[Game] Invalid concise puzzle format, missing or malformed fields:', p.t);
      return null;
    }
    // Validate dimensions are within limits
    if (p.w > CONFIG.MAX_PUZZLE_DIMENSION || p.h > CONFIG.MAX_PUZZLE_DIMENSION || p.w < 1 || p.h < 1) {
      console.warn('[Game] Puzzle dimensions out of range:', p.w, 'x', p.h);
      return null;
    }

    // Convert hex color to RGB array
    function hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
      ] : [0, 0, 0];
    }

    // Convert clues from [[count, colorIdx], ...] to [{count, color}, ...]
    // colorIdx is 0-indexed, convert to 1-indexed
    function convertClues(clues) {
      return clues.map(row => row.map(([count, colorIdx]) => ({
        count: count,
        color: colorIdx + 1
      })));
    }

    // Convert palette from ["#hex", ...] to {1: [r,g,b], 2: [r,g,b], ...}
    function convertPalette(palette) {
      const colorMap = {};
      palette.forEach((hex, idx) => {
        colorMap[idx + 1] = hexToRgb(hex);
      });
      return colorMap;
    }

    // Convert solution from 0-indexed (-1 = empty) to 1-indexed (0 = empty)
    function convertSolution(solution) {
      return solution.map(row => row.map(c => c < 0 ? 0 : c + 1));
    }

    try {
      return {
        title: p.t,
        width: p.w,
        height: p.h,
        row_clues: convertClues(p.r),
        col_clues: convertClues(p.c),
        color_map: convertPalette(p.p),
        solution: convertSolution(p.s)
      };
    } catch (e) {
      console.error('[Game] Failed to convert puzzle:', p.t, e);
      return null;
    }
  }

  // Cache for normalized puzzles (with reference tracking for invalidation)
  let normalizedPuzzles = null;
  let lastRawPuzzleData = null;

  // Get puzzles from global (loaded via script tag)
  function getPuzzles() {
    const raw = window.PUZZLE_DATA || [];
    // Invalidate cache if raw data reference changed (not just length)
    if (!normalizedPuzzles || raw !== lastRawPuzzleData) {
      // Filter out invalid puzzles (normalizePuzzle returns null for invalid)
      normalizedPuzzles = raw.map(normalizePuzzle).filter(p => p !== null);
      lastRawPuzzleData = raw;
    }
    return normalizedPuzzles;
  }

  // === Cell State Helpers ===

  function createCell(value = null, certain = true) {
    return { value: value, certain: certain };
  }

  // Get cell state at position, returning default empty cell if none exists.
  // Note: Returns a copy/default, does NOT create cell in grid. Use setCellDirect to modify.
  function getCell(row, col) {
    return grid[row]?.[col] || createCell();
  }

  function setCellDirect(row, col, value, certain) {
    grid[row][col] = { value: value, certain: certain };
  }

  // === Utility functions ===

  function rgb(color) {
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  }

  // ITU-R BT.601 luma formula - standard weights for perceived brightness
  // Green (0.587) > Red (0.299) > Blue (0.114) matches human eye sensitivity
  function getBrightness(color) {
    return (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000;
  }

  function getDifficulty(title) {
    const t = title.toLowerCase();
    if (t.includes('easy')) return 'easy';
    if (t.includes('medium')) return 'medium';
    if (t.includes('hard')) return 'hard';
    if (t.includes('challenging')) return 'challenging';
    if (t.includes('expert')) return 'expert';
    return 'easy';
  }

  function getStorage() {
    return window.Cozy.Storage || null;
  }

  function getHistory() {
    return window.Cozy.History || null;
  }

  // Check if the puzzle grid is completely empty (all cells null)
  function isPuzzleEmpty() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return true;

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (cell.value !== null) return false;
      }
    }
    return true;
  }

  // Check if the puzzle grid matches the solution exactly (all cells including empties).
  // NOTE: This is stricter than winning. Players win via checkWin() by satisfying clues,
  // which does NOT require marking empty cells. This function requires exact match where
  // solution empty cells (0) must be explicitly marked (not left as null). This is
  // intentional - the Solution button staying enabled after winning is harmless.
  function isPuzzleSolved() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return false;

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        const solutionValue = puzzle.solution[row][col];
        if (cell.value !== solutionValue || !cell.certain) return false;
      }
    }
    return true;
  }

  // Update disabled state of hold-to-confirm buttons
  function updateHoldButtonStates() {
    const resetBtn = document.getElementById('reset-btn');
    const solutionBtn = document.getElementById('solution-btn');

    if (resetBtn) {
      const empty = isPuzzleEmpty();
      resetBtn.disabled = empty;
      resetBtn.setAttribute('aria-label', empty ? 'Reset (puzzle is empty)' : 'Hold to reset puzzle');
    }

    if (solutionBtn) {
      const solved = isPuzzleSolved();
      solutionBtn.disabled = solved;
      solutionBtn.setAttribute('aria-label', solved ? 'Solution (already shown)' : 'Hold to reveal solution');
    }
  }

  // === Screen Reader Announcements ===

  /**
   * Announce a message to screen readers via live region
   * @param {string} message - Text to announce
   */
  function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (el) {
      el.textContent = '';
      // Brief delay ensures screen reader registers the change
      setTimeout(() => { el.textContent = message; }, 50);
    }
  }

  // === Pencil Mode ===

  /**
   * Set pencil mode on or off.
   * Pencil mode marks cells as "uncertain" - they don't count toward win detection.
   * @param {boolean} enabled - Whether to enable pencil mode
   */
  function setPencilMode(enabled) {
    isPencilMode = enabled;
    updatePencilModeUI();
    announce(enabled ? 'Pencil mode' : 'Pen mode');
    closeModeMenu(); // Close menu after selection
  }

  /**
   * Toggle between pen mode (certain marks) and pencil mode (uncertain marks).
   */
  function togglePencilMode() {
    setPencilMode(!isPencilMode);
  }

  function updatePencilModeUI() {
    const penBtn = document.getElementById('pen-mode-btn');
    const pencilBtn = document.getElementById('pencil-mode-btn');
    const menuBtn = document.getElementById('palette-menu-btn');

    if (penBtn) {
      penBtn.classList.toggle('active', !isPencilMode);
      penBtn.setAttribute('aria-checked', String(!isPencilMode));
    }
    if (pencilBtn) {
      pencilBtn.classList.toggle('active', isPencilMode);
      pencilBtn.setAttribute('aria-checked', String(isPencilMode));
    }

    // Update menu button icon based on mode
    if (menuBtn) {
      const svg = menuBtn.querySelector('.menu-icon-svg');
      if (svg) {
        // Remove stroke, use fill for these icons
        svg.removeAttribute('stroke');
        svg.removeAttribute('stroke-width');
        svg.setAttribute('fill', 'currentColor');
        if (isPencilMode) {
          // Pencil icon (dashed lines indicate uncertainty)
          svg.innerHTML = '<path d="M19.07 13.88L13 19.94l-1.41-1.41 6.07-6.06 1.41 1.41zm-5.66-5.66l-6.06 6.07-1.42-1.41 6.07-6.07 1.41 1.41zM17.66 5.99l-2.34 2.34 1.41 1.41 2.34-2.34-1.41-1.41zM3 18v3h3l.01-.01L3 18zm3-3l-1 1 3 3 1-1-3-3z" opacity="0.5"/><path d="M9.17 16.17L7.76 17.59l3.54 3.54 1.41-1.41-3.54-3.55zm10.6-10.6l-3.53-3.54-1.42 1.42 3.54 3.53 1.41-1.41z"/>';
        } else {
          // Solid pen icon
          svg.innerHTML = '<path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"/>';
        }
      }
    }

    document.body.classList.toggle('pencil-mode', isPencilMode);
  }

  // === Mode Menu ===

  function toggleModeMenu() {
    const menu = document.getElementById('mode-menu');
    const menuBtn = document.getElementById('palette-menu-btn');
    if (!menu || !menuBtn) return;

    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      closeModeMenu();
    } else {
      openModeMenu();
    }
  }

  function openModeMenu() {
    const menu = document.getElementById('mode-menu');
    const menuBtn = document.getElementById('palette-menu-btn');
    if (!menu || !menuBtn) return;

    menu.classList.add('open');
    menuBtn.classList.add('menu-open');
    menuBtn.setAttribute('aria-expanded', 'true');

    // Close menu when clicking outside
    setTimeout(() => {
      document.addEventListener('click', handleMenuOutsideClick);
    }, 0);
  }

  function closeModeMenu() {
    const menu = document.getElementById('mode-menu');
    const menuBtn = document.getElementById('palette-menu-btn');
    if (!menu) return;

    menu.classList.remove('open');
    if (menuBtn) {
      menuBtn.classList.remove('menu-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }

    document.removeEventListener('click', handleMenuOutsideClick);
  }

  function handleMenuOutsideClick(e) {
    const menu = document.getElementById('mode-menu');
    const menuBtn = document.getElementById('palette-menu-btn');
    if (!menu || !menuBtn) return;

    if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
      closeModeMenu();
    }
  }

  // Check if there are any pencil marks on the grid
  function hasPencilMarks() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return false;

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (!cell.certain && cell.value !== null) {
          return true;
        }
      }
    }
    return false;
  }

  // Count pencil marks for badge display
  function countPencilMarks() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return 0;

    let count = 0;
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (!cell.certain && cell.value !== null) {
          count++;
        }
      }
    }
    return count;
  }

  function updatePencilActionsVisibility() {
    const pencilActionsSection = document.getElementById('pencil-actions-section');
    const menuBtn = document.getElementById('palette-menu-btn');
    const hasMarks = hasPencilMarks();
    const markCount = hasMarks ? countPencilMarks() : 0;

    // Show/hide pencil actions in menu
    if (pencilActionsSection) {
      pencilActionsSection.classList.toggle('has-marks', hasMarks);
    }

    // Update menu button badge
    if (menuBtn) {
      menuBtn.classList.toggle('has-pencil-marks', hasMarks);
      const badge = menuBtn.querySelector('.pencil-badge');
      if (badge) {
        badge.textContent = markCount > CONFIG.BADGE_MAX_DISPLAY
          ? `${CONFIG.BADGE_MAX_DISPLAY}+`
          : String(markCount);
      }
    }
  }

  // === Batch Operations ===

  /**
   * Clear all pencil (uncertain) marks from the grid.
   * Resets uncertain cells to empty. Recorded as a single undoable action.
   */
  function clearAllPencilMarks() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    const changes = [];

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (!cell.certain && cell.value !== null) {
          changes.push({
            row, col,
            before: { value: cell.value, certain: cell.certain },
            after: { value: null, certain: true }
          });
          setCellDirect(row, col, null, true);
          updateCellVisual(row, col, puzzle);
        }
      }
    }

    if (changes.length > 0) {
      const history = getHistory();
      if (history) {
        history.recordBatchAction('batch-clear', changes);
      }

      // Haptic feedback
      if (window.Cozy.App) window.Cozy.App.vibrate(20);
    }

    updatePencilActionsVisibility();
    saveSession();
  }

  /**
   * Convert all pencil (uncertain) marks to certain marks.
   * Makes all uncertain cells permanent. Recorded as a single undoable action.
   * Triggers win check after confirmation.
   */
  function confirmAllPencilMarks() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    const changes = [];

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (!cell.certain && cell.value !== null) {
          changes.push({
            row, col,
            before: { value: cell.value, certain: cell.certain },
            after: { value: cell.value, certain: true }
          });
          setCellDirect(row, col, cell.value, true);
          updateCellVisual(row, col, puzzle);
        }
      }
    }

    if (changes.length > 0) {
      const history = getHistory();
      if (history) {
        history.recordBatchAction('batch-confirm', changes);
      }

      // Haptic feedback
      if (window.Cozy.App) window.Cozy.App.vibrate([20, 50, 20]);
    }

    updatePencilActionsVisibility();
    checkWin(puzzle);
    saveSession();
  }

  // === Undo/Redo ===

  /**
   * Undo the last action (fill, clear, or batch operation).
   * Restores cells to their previous state and updates UI.
   */
  function performUndo() {
    const history = getHistory();
    if (!history) return;

    const changes = history.undo();
    if (!changes) return;

    const puzzle = getPuzzles()[currentPuzzle];

    for (const change of changes) {
      setCellDirect(change.row, change.col, change.state.value, change.state.certain);
      updateCellVisual(change.row, change.col, puzzle);
    }

    // Haptic feedback
    if (window.Cozy.App) window.Cozy.App.vibrate(15);

    updatePencilActionsVisibility();
    updateClueSatisfaction(puzzle);
    updateHoldButtonStates();
    saveSession();
  }

  /**
   * Redo the last undone action.
   * Restores cells to their "after" state and triggers win check.
   */
  function performRedo() {
    const history = getHistory();
    if (!history) return;

    const changes = history.redo();
    if (!changes) return;

    const puzzle = getPuzzles()[currentPuzzle];

    for (const change of changes) {
      setCellDirect(change.row, change.col, change.state.value, change.state.certain);
      updateCellVisual(change.row, change.col, puzzle);
    }

    // Haptic feedback
    if (window.Cozy.App) window.Cozy.App.vibrate(15);

    updatePencilActionsVisibility();
    updateClueSatisfaction(puzzle);
    updateHoldButtonStates();
    checkWin(puzzle);
    saveSession();
  }

  // === Session Management ===

  function saveSession() {
    const storage = getStorage();
    if (!storage) return;

    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (!puzzle) return;

    const puzzleId = getPuzzleId(puzzle);
    storage.savePuzzleGrid(puzzleId, grid);
    storage.saveSession(currentPuzzle, currentDifficulty, grid);
  }

  function clearSession() {
    const storage = getStorage();
    if (storage) storage.clearSession();
  }

  // === Puzzle Selection UI ===

  function initPuzzleSelect() {
    const puzzles = getPuzzles();
    const container = document.getElementById('puzzle-select');

    const difficulties = [...new Set(puzzles.map(p => getDifficulty(p.title)))];
    const diffOrder = ['easy', 'medium', 'hard', 'challenging', 'expert'];
    difficulties.sort((a, b) => diffOrder.indexOf(a) - diffOrder.indexOf(b));

    const tabsDiv = document.createElement('div');
    tabsDiv.className = 'difficulty-tabs';

    difficulties.forEach(diff => {
      const btn = document.createElement('button');
      btn.className = 'difficulty-tab' + (diff === currentDifficulty ? ' active' : '');
      btn.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
      btn.onclick = () => {
        currentDifficulty = diff;
        document.querySelectorAll('.difficulty-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        updateDropdown();
      };
      tabsDiv.appendChild(btn);
    });

    const dropdownDiv = document.createElement('div');
    dropdownDiv.className = 'puzzle-dropdown';
    const select = document.createElement('select');
    select.id = 'puzzle-select-dropdown';
    select.onchange = (e) => {
      loadPuzzle(parseInt(e.target.value));
    };
    dropdownDiv.appendChild(select);

    container.appendChild(tabsDiv);
    container.appendChild(dropdownDiv);

    updateDropdown();
  }

  function updateDropdown() {
    const puzzles = getPuzzles();
    const select = document.getElementById('puzzle-select-dropdown');
    if (!select) return; // Skip if dropdown doesn't exist (using collection view)
    const storage = getStorage();
    select.innerHTML = '';

    puzzles.forEach((puzzle, idx) => {
      if (getDifficulty(puzzle.title) === currentDifficulty) {
        const opt = document.createElement('option');
        opt.value = idx;

        const puzzleId = getPuzzleId(puzzle);
        const isCompleted = storage ? storage.isPuzzleCompleted(puzzleId) : false;
        opt.textContent = (isCompleted ? '\u2713 ' : '') + puzzle.title;

        if (idx === currentPuzzle) opt.selected = true;
        select.appendChild(opt);
      }
    });

    const filteredPuzzles = puzzles.filter(p => getDifficulty(p.title) === currentDifficulty);
    if (filteredPuzzles.length > 0) {
      const currentInDifficulty = getDifficulty(puzzles[currentPuzzle]?.title) === currentDifficulty;
      if (!currentInDifficulty) {
        const firstIdx = puzzles.findIndex(p => getDifficulty(p.title) === currentDifficulty);
        if (firstIdx >= 0) loadPuzzle(firstIdx);
      }
    }
  }

  // === Core Game Functions ===

  function loadPuzzle(index, restoreGrid = null) {
    // Guard against concurrent puzzle loads (race condition)
    if (isLoadingPuzzle) {
      console.warn('[Game] Puzzle already loading, ignoring request');
      return;
    }
    isLoadingPuzzle = true;

    try {
      const puzzles = getPuzzles();
      const storage = getStorage();
      const history = getHistory();

      // Save current puzzle's grid before switching
      if (index !== currentPuzzle && grid.length > 0 && puzzles[currentPuzzle] && storage) {
        const currentPuzzleId = getPuzzleId(puzzles[currentPuzzle]);
        storage.savePuzzleGrid(currentPuzzleId, grid);
      }

      // Clear history when switching puzzles
      if (history) history.clear();

      // Reset pencil mode when loading a new puzzle
      isPencilMode = false;
      updatePencilModeUI();

      // Reset keyboard focus to top-left cell
      focusedRow = 0;
      focusedCol = 0;

      currentPuzzle = index;
      const puzzle = puzzles[index];
      if (!puzzle) {
        isLoadingPuzzle = false;
        return;
      }

      // Validate puzzle dimensions (security: prevent DOM explosion)
      if (puzzle.width > CONFIG.MAX_PUZZLE_DIMENSION || puzzle.height > CONFIG.MAX_PUZZLE_DIMENSION ||
          puzzle.width < 1 || puzzle.height < 1) {
        console.error(`[Game] Invalid puzzle dimensions: ${puzzle.width}x${puzzle.height}`);
        isLoadingPuzzle = false;
        return;
      }

      const puzzleId = getPuzzleId(puzzle);

      // Initialize or restore grid
      let savedGrid = restoreGrid;
      if (!savedGrid && storage) {
        savedGrid = storage.getPuzzleGrid(puzzleId);
      }

      const hasRestoredGrid = savedGrid && savedGrid.length === puzzle.height;
      if (hasRestoredGrid) {
        // Deep copy
        grid = savedGrid.map(row => row.map(cell =>
          ({ value: cell.value, certain: cell.certain })
        ));
      } else {
        // Create empty grid
        grid = [];
        for (let row = 0; row < puzzle.height; row++) {
          grid.push([]);
          for (let col = 0; col < puzzle.width; col++) {
            grid[row][col] = createCell(null, true);
          }
        }
      }

      selectedColor = 1;
      buildPalette(puzzle);
      buildClues(puzzle);
      buildGrid(puzzle);
      updateCurrentPuzzleTitle();

      // Update cell visuals if grid was restored
      if (hasRestoredGrid) {
        for (let row = 0; row < puzzle.height; row++) {
          for (let col = 0; col < puzzle.width; col++) {
            const cell = getCell(row, col);
            if (cell.value !== null) {
              updateCellVisual(row, col, puzzle);
            }
          }
        }
      }

      // Hide any existing toast when loading a new puzzle
      hideToast();

      const select = document.getElementById('puzzle-select-dropdown');
      if (select) select.value = index;

      const newDiff = getDifficulty(puzzle.title);
      if (newDiff !== currentDifficulty) {
        currentDifficulty = newDiff;
        document.querySelectorAll('.difficulty-tab').forEach(tab => {
          tab.classList.toggle('active', tab.textContent.toLowerCase() === newDiff);
        });
        updateDropdown();
      }

      updatePencilActionsVisibility();
      updateClueSatisfaction(puzzle);

      // Initialize zoom system for this puzzle
      if (window.Cozy.Zoom) {
        window.Cozy.Zoom.initForPuzzle(puzzle);
      }

      // Show help modal on first-ever puzzle load
      maybeShowFirstTimeHelp();

      // Update hold button states based on puzzle state
      updateHoldButtonStates();
    } finally {
      isLoadingPuzzle = false;
    }
  }

  /**
   * Build the color palette UI for a puzzle.
   * Creates eraser button (color 0) plus a button for each puzzle color.
   * Preserves the mode menu if it exists. Adjusts button sizes based on
   * color count for optimal touch targets.
   *
   * @param {Object} puzzle - Puzzle object with color_map
   */
  function buildPalette(puzzle) {
    const palette = document.getElementById('palette');

    // Preserve mode menu before clearing (it may have been appended previously)
    const existingMenu = document.getElementById('mode-menu');
    const menuParent = existingMenu ? existingMenu.parentNode : null;
    if (existingMenu && palette.contains(existingMenu)) {
      // Temporarily move menu out so it's not destroyed by innerHTML = ''
      document.body.appendChild(existingMenu);
    }

    palette.innerHTML = '';

    // Add eraser
    const eraser = document.createElement('button');
    eraser.className = 'color-btn eraser';
    eraser.title = 'Eraser';
    eraser.setAttribute('aria-label', 'Eraser');
    eraser.setAttribute('aria-pressed', selectedColor === 0 ? 'true' : 'false');
    eraser.addEventListener('click', () => selectColor(0));
    palette.appendChild(eraser);

    // Add color buttons
    Object.entries(puzzle.color_map).forEach(([colorId, colorRgb]) => {
      const btn = document.createElement('button');
      const isSelected = parseInt(colorId) === selectedColor;
      btn.className = 'color-btn' + (isSelected ? ' selected' : '');
      btn.style.background = rgb(colorRgb);
      btn.setAttribute('aria-label', `Color ${colorId}`);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      btn.addEventListener('click', () => selectColor(parseInt(colorId)));
      palette.appendChild(btn);
    });

    // Add mode menu button at end of palette
    const menuBtn = document.createElement('button');
    menuBtn.className = 'palette-menu-btn';
    menuBtn.id = 'palette-menu-btn';
    menuBtn.title = 'Drawing mode';
    menuBtn.setAttribute('aria-label', 'Drawing mode menu');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    // Start with pen icon (default mode)
    menuBtn.innerHTML = `
      <svg class="menu-icon-svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"/>
      </svg>
      <span class="pencil-badge">0</span>
    `;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleModeMenu();
    });
    palette.appendChild(menuBtn);

    // Move mode menu inside palette for proper positioning
    const modeMenu = document.getElementById('mode-menu');
    if (modeMenu) {
      palette.appendChild(modeMenu);
    }

    // Add class based on button count for responsive sizing
    // 8 buttons (6 colors + eraser + menu) need smaller sizes on phones
    const buttonCount = palette.querySelectorAll('.color-btn, .palette-menu-btn').length;
    palette.classList.remove('palette-8-buttons', 'palette-7-buttons');
    if (buttonCount >= 8) {
      palette.classList.add('palette-8-buttons');
    } else if (buttonCount === 7) {
      palette.classList.add('palette-7-buttons');
    }
    // 6 or fewer buttons can use full 44px size on all screens
  }

  /**
   * Select a color from the palette for filling cells.
   * @param {number} colorId - Color ID (0 for eraser/X, 1+ for palette colors)
   */
  function selectColor(colorId) {
    selectedColor = colorId;
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];

    document.querySelectorAll('.color-btn').forEach((btn, idx) => {
      let isSelected;
      if (idx === 0) {
        isSelected = colorId === 0;
      } else {
        isSelected = parseInt(Object.keys(puzzle.color_map)[idx - 1]) === colorId;
      }
      btn.classList.toggle('selected', isSelected);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
  }

  /**
   * Create a clue cell element
   * @param {Object|null} clue - Clue object {count, color} or null for empty row/column
   * @param {Object} puzzle - Puzzle object with color_map
   * @param {string} className - CSS class name for the cell
   * @returns {HTMLElement} The clue cell element
   */
  function createClueCell(clue, puzzle, className) {
    const cell = document.createElement('div');
    cell.className = className;

    if (clue === null) {
      // Empty row/column indicator
      cell.textContent = '0';
      cell.style.background = '#333';
    } else {
      const colorRgb = puzzle.color_map[clue.color];
      cell.textContent = clue.count;
      cell.style.background = rgb(colorRgb);
      cell.style.color = getBrightness(colorRgb) > CONFIG.BRIGHTNESS_MIDPOINT ? '#000' : '#fff';
      cell.style.cursor = 'pointer';
      cell.onclick = () => selectColor(clue.color);
    }

    return cell;
  }

  /**
   * Build the row and column clue displays for a puzzle.
   * Creates DOM elements for each clue cell with appropriate colors and
   * click handlers. Caches elements in colClueElements/rowClueElements
   * for fast satisfaction updates.
   *
   * @param {Object} puzzle - Puzzle object with row_clues, col_clues, color_map
   */
  function buildClues(puzzle) {
    // Initialize clue element caches and satisfaction state
    colClueElements = [];
    rowClueElements = [];
    rowSatisfied = new Array(puzzle.height).fill(false);
    colSatisfied = new Array(puzzle.width).fill(false);

    // Column clues
    const colCluesEl = document.getElementById('col-clues');
    colCluesEl.innerHTML = '';
    colCluesEl.style.gridTemplateColumns = `repeat(${puzzle.width}, var(--cell-size))`;

    puzzle.col_clues.forEach((clues, colIndex) => {
      const col = document.createElement('div');
      col.className = 'col-clue';
      col.dataset.col = colIndex;

      if (clues.length === 0) {
        col.appendChild(createClueCell(null, puzzle, 'clue-cell'));
      } else {
        clues.forEach(clue => {
          col.appendChild(createClueCell(clue, puzzle, 'clue-cell'));
        });
      }

      // Cache for fast lookup
      colClueElements[colIndex] = col;
      colCluesEl.appendChild(col);
    });

    // Row clues
    const rowContainer = document.getElementById('row-clues-container');
    rowContainer.innerHTML = '';
    rowContainer.style.gridTemplateRows = `repeat(${puzzle.height}, var(--cell-size))`;

    puzzle.row_clues.forEach((clues, rowIndex) => {
      const rowClues = document.createElement('div');
      rowClues.className = 'row-clues';
      rowClues.dataset.row = rowIndex;

      if (clues.length === 0) {
        rowClues.appendChild(createClueCell(null, puzzle, 'row-clue-cell'));
      } else {
        clues.forEach(clue => {
          rowClues.appendChild(createClueCell(clue, puzzle, 'row-clue-cell'));
        });
      }

      // Cache for fast lookup
      rowClueElements[rowIndex] = rowClues;
      rowContainer.appendChild(rowClues);
    });
  }

  // === Crosshair Hover Effect ===
  let currentHoverRow = -1;
  let currentHoverCol = -1;

  function updateCrosshairHighlight(row, col) {
    // Skip on touch devices
    if (isTouchDevice()) return;

    // Skip if same position
    if (row === currentHoverRow && col === currentHoverCol) return;

    // Clear previous highlights
    clearCrosshairHighlight();

    // Set new position
    currentHoverRow = row;
    currentHoverCol = col;

    if (row < 0 || col < 0) return;
    if (!cellElements[row]) return;

    // Highlight cells in same row (using cache)
    const rowCells = cellElements[row];
    if (rowCells) {
      for (let c = 0; c < rowCells.length; c++) {
        const cellEl = rowCells[c];
        if (cellEl) {
          cellEl.classList.add('highlight-row');
          if (c === col) {
            cellEl.classList.add('highlight-cell');
          }
        }
      }
    }

    // Highlight cells in same column (using cache)
    for (let r = 0; r < cellElements.length; r++) {
      if (r !== row && cellElements[r]?.[col]) {
        cellElements[r][col].classList.add('highlight-col');
      }
    }

    // Highlight corresponding clues (using cache)
    if (rowClueElements[row]) {
      rowClueElements[row].classList.add('highlight-clue');
    }
    if (colClueElements[col]) {
      colClueElements[col].classList.add('highlight-clue');
    }
  }

  function clearCrosshairHighlight() {
    const prevRow = currentHoverRow;
    const prevCol = currentHoverCol;
    currentHoverRow = -1;
    currentHoverCol = -1;

    // Only clear if we had a previous highlight
    if (prevRow < 0 && prevCol < 0) return;

    // Clear only the previously highlighted row and column - O(n) instead of O(n²)
    // Clear the highlighted row
    if (prevRow >= 0 && cellElements[prevRow]) {
      for (let c = 0; c < cellElements[prevRow].length; c++) {
        const cellEl = cellElements[prevRow][c];
        if (cellEl) {
          cellEl.classList.remove('highlight-row', 'highlight-cell');
        }
      }
    }
    // Clear the highlighted column
    if (prevCol >= 0) {
      for (let r = 0; r < cellElements.length; r++) {
        const cellEl = cellElements[r]?.[prevCol];
        if (cellEl) {
          cellEl.classList.remove('highlight-col');
        }
      }
    }

    // Clear clue highlights (only the previously highlighted ones)
    if (prevRow >= 0 && rowClueElements[prevRow]) {
      rowClueElements[prevRow].classList.remove('highlight-clue');
    }
    if (prevCol >= 0 && colClueElements[prevCol]) {
      colClueElements[prevCol].classList.remove('highlight-clue');
    }
  }

  // Move keyboard focus to a specific cell (roving tabindex pattern)
  function moveFocusToCell(newRow, newCol) {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    // Bounds check - stop at edges
    if (newRow < 0 || newRow >= puzzle.height || newCol < 0 || newCol >= puzzle.width) {
      return;
    }

    // Update old cell's tabIndex
    if (cellElements[focusedRow]?.[focusedCol]) {
      cellElements[focusedRow][focusedCol].tabIndex = -1;
    }

    // Update state
    focusedRow = newRow;
    focusedCol = newCol;

    // Update new cell and focus it
    const newCell = cellElements[newRow]?.[newCol];
    if (newCell) {
      newCell.tabIndex = 0;
      newCell.focus();
      // Crosshair highlight is handled by the cell's onfocus handler
    }
  }

  // === Cell Creation Helpers (extracted from buildGrid for clarity) ===

  /**
   * Create a grid cell DOM element with basic attributes
   */
  function createGridCell(row, col) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.row = row;
    cell.dataset.col = col;
    // Accessibility: roving tabindex - only focused cell is tabbable
    cell.tabIndex = (row === focusedRow && col === focusedCol) ? 0 : -1;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `Row ${row + 1}, Column ${col + 1}, empty`);
    return cell;
  }

  /**
   * Attach focus event handlers for keyboard navigation
   */
  function attachCellFocusHandlers(cell, row, col) {
    cell.onfocus = () => {
      // Update roving tabindex state when cell receives focus (via click, tab, or arrow)
      if (focusedRow !== row || focusedCol !== col) {
        // Update old cell's tabIndex
        if (cellElements[focusedRow]?.[focusedCol]) {
          cellElements[focusedRow][focusedCol].tabIndex = -1;
        }
        // Update state
        focusedRow = row;
        focusedCol = col;
        // Ensure this cell has correct tabIndex
        cell.tabIndex = 0;
      }
      // Update crosshair highlight
      updateCrosshairHighlight(row, col);
    };
  }

  /**
   * Attach keyboard event handlers for cell interaction
   */
  function attachCellKeyboardHandlers(cell, row, col) {
    cell.onkeydown = (e) => {
      // Arrow key navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocusToCell(row - 1, col);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocusToCell(row + 1, col);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveFocusToCell(row, col - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveFocusToCell(row, col + 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const history = getHistory();
        if (history) history.beginAction('fill');
        fillCell(row, col, selectedColor, !isPencilMode);
        if (history) history.commitAction();
        updatePencilActionsVisibility();
      } else if (e.key === 'x' || e.key === 'X') {
        // X key marks cell as empty
        e.preventDefault();
        e.stopPropagation(); // Prevent global handler from selecting eraser
        const history = getHistory();
        if (history) history.beginAction('fill');
        fillCell(row, col, 0, !isPencilMode);
        if (history) history.commitAction();
        updatePencilActionsVisibility();
      }
    };
  }

  // === Drag Helpers (shared between mouse and touch handlers) ===

  /**
   * Begin a drag operation - sets up state and fills the initial cell
   * @param {number} row - Cell row
   * @param {number} col - Cell column
   * @param {boolean} isEraser - Whether to use eraser (X mark) instead of selected color
   */
  function beginDrag(row, col, isEraser = false) {
    const history = getHistory();
    if (history) history.beginAction('fill');

    isDragging = true;
    dragColor = isEraser ? 0 : selectedColor;
    dragCertain = !isPencilMode;
    fillCell(row, col, dragColor, dragCertain);

    // Capture actual value after toggle logic for consistent drag
    const cellAfterFill = getCell(row, col);
    dragColor = cellAfterFill.value;
    dragCertain = cellAfterFill.certain;
  }

  /**
   * End a drag operation - commits or cancels the history action
   * @param {boolean} commit - Whether to commit (true) or cancel (false) the action
   */
  function endDrag(commit = true) {
    if (!isDragging) return;

    isDragging = false;
    dragColor = null;

    const history = getHistory();
    if (history) {
      if (commit) {
        history.commitAction();
      } else {
        history.cancelAction();
      }
    }

    updatePencilActionsVisibility();
  }

  /**
   * Attach mouse event handlers for cell interaction
   */
  function attachCellMouseHandlers(cell, row, col) {
    cell.onmousedown = (e) => {
      e.preventDefault();
      cell.focus(); // Explicitly focus since preventDefault blocks default focus
      beginDrag(row, col, e.button === 2);
    };

    cell.onmouseenter = () => {
      updateCrosshairHighlight(row, col);
      if (isDragging) {
        fillCell(row, col, dragColor, dragCertain, true); // skipToggle=true
      }
    };

    cell.oncontextmenu = (e) => {
      e.preventDefault();
    };
  }

  /**
   * Attach touch event handlers with long-press support
   */
  function attachCellTouchHandlers(cell, row, col) {
    let longPressTimer = null;
    let touchStartTime = 0;
    let touchMoved = false;
    let initialTouchRow = row;
    let initialTouchCol = col;

    cell.ontouchstart = (e) => {
      // Don't prevent default here - let zoom handle multi-touch
      if (e.touches.length > 1) return;

      e.preventDefault();
      e.stopPropagation(); // Prevent zoom container from starting pan
      touchMoved = false;
      touchStartTime = Date.now();
      initialTouchRow = row;
      initialTouchCol = col;

      // Notify zoom system for tooltip (pass touch Y for positioning)
      if (window.Cozy.Zoom) {
        const touchY = e.touches[0]?.clientY ?? 0;
        window.Cozy.Zoom.onCellTouchStart(row, col, touchY);
      }

      const history = getHistory();
      if (history) history.beginAction('fill');

      isDragging = true;
      dragColor = selectedColor;
      dragCertain = !isPencilMode;

      // Long press timer for X mark
      longPressTimer = setTimeout(() => {
        if (!touchMoved) {
          // Switch to X mode
          dragColor = 0;
          fillCell(initialTouchRow, initialTouchCol, 0, dragCertain);
          // Capture actual value after fill for consistent drag
          const cellAfterFill = getCell(initialTouchRow, initialTouchCol);
          dragColor = cellAfterFill.value;
          dragCertain = cellAfterFill.certain;
          // Haptic feedback for long-press
          if (window.Cozy.App) window.Cozy.App.vibrate(50);
        }
      }, CONFIG.LONG_PRESS_DELAY);

      // Immediate fill with color (will be undone if long-press triggers)
      fillCell(row, col, dragColor, dragCertain);
      // Capture actual value after toggle logic for consistent drag
      const cellAfterFill = getCell(row, col);
      dragColor = cellAfterFill.value;
      dragCertain = cellAfterFill.certain;
    };

    cell.ontouchmove = (e) => {
      if (e.touches.length > 1) return;
      if (!isDragging) return;

      e.preventDefault();
      e.stopPropagation(); // Prevent zoom container from interfering
      touchMoved = true;
      clearTimeout(longPressTimer);

      // Handle drag-to-fill
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (target && target.classList.contains('cell')) {
        const r = parseInt(target.dataset.row);
        const c = parseInt(target.dataset.col);
        if (!isNaN(r) && !isNaN(c)) {
          fillCell(r, c, dragColor, dragCertain, true); // skipToggle=true
          // Notify zoom system for tooltip update
          if (window.Cozy.Zoom) {
            window.Cozy.Zoom.onCellTouchMove(r, c);
          }
        }
      }
    };

    cell.ontouchend = () => {
      clearTimeout(longPressTimer);
      endDrag(true);

      // Notify zoom system to hide tooltip
      if (window.Cozy.Zoom) {
        window.Cozy.Zoom.onCellTouchEnd();
      }
    };

    cell.ontouchcancel = () => {
      clearTimeout(longPressTimer);
      endDrag(false);

      // Notify zoom system to hide tooltip
      if (window.Cozy.Zoom) {
        window.Cozy.Zoom.onCellTouchEnd();
      }
    };
  }

  /**
   * Build the interactive puzzle grid.
   * Creates cell elements with mouse, touch, and keyboard event handlers.
   * Sets up drag handling, crosshair highlighting, and focus management.
   * Caches elements in cellElements[][] for fast visual updates.
   *
   * @param {Object} puzzle - Puzzle object with width, height
   */
  function buildGrid(puzzle) {
    const gridEl = document.getElementById('grid');
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${puzzle.width}, var(--cell-size))`;
    gridEl.style.gridTemplateRows = `repeat(${puzzle.height}, var(--cell-size))`;

    // Clean up previous event listeners to prevent memory leaks
    if (gridMouseLeaveHandler) {
      gridEl.removeEventListener('mouseleave', gridMouseLeaveHandler);
    }
    if (gridFocusOutHandler) {
      gridEl.removeEventListener('focusout', gridFocusOutHandler);
    }
    if (mouseUpHandler) {
      document.removeEventListener('mouseup', mouseUpHandler);
    }

    // Initialize cell element cache
    cellElements = [];
    for (let r = 0; r < puzzle.height; r++) {
      cellElements[r] = [];
    }

    // Clear highlight when leaving grid (mouse)
    gridMouseLeaveHandler = () => clearCrosshairHighlight();
    gridEl.addEventListener('mouseleave', gridMouseLeaveHandler);

    // Clear highlight when focus leaves grid (keyboard)
    gridFocusOutHandler = (e) => {
      // Only clear if focus is leaving the grid entirely
      if (!gridEl.contains(e.relatedTarget)) {
        clearCrosshairHighlight();
      }
    };
    gridEl.addEventListener('focusout', gridFocusOutHandler);

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = createGridCell(row, col);
        attachCellFocusHandlers(cell, row, col);
        attachCellKeyboardHandlers(cell, row, col);
        attachCellMouseHandlers(cell, row, col);
        attachCellTouchHandlers(cell, row, col);

        // Cache the cell element for fast lookup
        cellElements[row][col] = cell;
        gridEl.appendChild(cell);
      }
    }

    // Mouse up handler (for mouse-based drag)
    mouseUpHandler = () => endDrag(true);
    document.addEventListener('mouseup', mouseUpHandler);
  }

  /**
   * Fill a cell with a color value, handling toggle logic and history.
   *
   * Toggle behavior (when skipToggle=false):
   * - Tapping a pencil cell with same color in pen mode → converts to certain
   * - Tapping a cell with same value/certainty → clears to empty
   *
   * Records changes to history for undo. Updates visual and clue satisfaction.
   *
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @param {number|null} newValue - Color value (0=X, 1+=color, null=empty)
   * @param {boolean} newCertain - Whether mark is certain (pen) or uncertain (pencil)
   * @param {boolean} [skipToggle=false] - Skip toggle logic (used during drag)
   */
  function fillCell(row, col, newValue, newCertain, skipToggle) {
    const puzzle = getPuzzles()[currentPuzzle];
    const currentCell = getCell(row, col);
    const history = getHistory();

    // Determine final state based on current state and action
    let finalValue = newValue;
    let finalCertain = newCertain;

    // Skip toggle logic during drag operations
    if (!skipToggle) {
      // Special case: tapping a maybe cell in pen mode with same color converts to certain
      if (newCertain && !currentCell.certain &&
          currentCell.value === newValue && newValue !== null) {
        finalValue = currentCell.value;
        finalCertain = true;
      }
      // Special case: tapping same state toggles to blank
      else if (currentCell.value === newValue &&
               currentCell.certain === newCertain &&
               newValue !== null) {
        finalValue = null;
        finalCertain = true;
      }
    }

    // Skip if no change
    if (currentCell.value === finalValue && currentCell.certain === finalCertain) {
      return;
    }

    // Record change for undo
    if (history) {
      history.recordChange(row, col, currentCell, { value: finalValue, certain: finalCertain });
    }

    // Apply change
    setCellDirect(row, col, finalValue, finalCertain);
    updateCellVisual(row, col, puzzle);

    // Light haptic on fill
    if (window.Cozy.App) window.Cozy.App.vibrate(10);

    updateClueSatisfaction(puzzle);
    updateHoldButtonStates();
    checkWin(puzzle);
    saveSession();
  }

  function updateCellVisual(row, col, puzzle) {
    // Use cached element for performance
    const cellEl = cellElements[row]?.[col];
    if (!cellEl) return;

    const cell = getCell(row, col);

    // Clear previous classes and styles
    cellEl.classList.remove('marked-empty', 'maybe-empty', 'maybe-color');
    cellEl.style.background = '';
    cellEl.style.setProperty('--cell-color', '');
    cellEl.style.setProperty('--fold-outline-color', '');

    if (cell.value === null) {
      // Blank cell
      cellEl.style.background = 'var(--color-cell)';
    }
    else if (cell.value === 0) {
      // X mark
      if (cell.certain) {
        cellEl.classList.add('marked-empty');
      } else {
        cellEl.classList.add('maybe-empty');
      }
    }
    else {
      // Color
      const colorRgb = puzzle.color_map[cell.value];
      if (colorRgb) {
        const colorStr = `rgb(${colorRgb[0]}, ${colorRgb[1]}, ${colorRgb[2]})`;

        if (cell.certain) {
          cellEl.style.background = colorStr;
        } else {
          cellEl.classList.add('maybe-color');
          cellEl.style.setProperty('--cell-color', colorStr);
          // Set fold outline color based on cell brightness for visibility
          const brightness = getBrightness(colorRgb);
          const outlineColor = brightness > CONFIG.BRIGHTNESS_MIDPOINT
            ? 'rgba(0, 0, 0, 0.6)'
            : 'rgba(255, 255, 255, 0.7)';
          cellEl.style.setProperty('--fold-outline-color', outlineColor);
        }
      }
    }

    // Update aria-label with cell state for screen readers
    let stateDesc;
    if (cell.value === null) {
      stateDesc = 'empty';
    } else if (cell.value === 0) {
      stateDesc = cell.certain ? 'marked empty' : 'maybe empty';
    } else {
      stateDesc = cell.certain ? `color ${cell.value}` : `maybe color ${cell.value}`;
    }
    cellEl.setAttribute('aria-label', `Row ${row + 1}, Column ${col + 1}, ${stateDesc}`);
  }

  /**
   * Extract consecutive color runs from a line of cell values.
   * A "run" is a sequence of consecutive cells with the same non-zero color.
   * Empty cells (0) act as separators between runs.
   *
   * Example: [0, 1, 1, 0, 2, 2, 2, 0] → [{count: 2, color: 1}, {count: 3, color: 2}]
   *
   * @param {number[]} values - Array of cell values (0 = empty, 1+ = color)
   * @returns {Array<{count: number, color: number}>} Array of run objects
   */
  function extractRuns(values) {
    const runs = [];
    let currentColor = null;
    let currentCount = 0;

    for (const value of values) {
      if (value > 0) {
        if (value === currentColor) {
          currentCount++;
        } else {
          if (currentColor !== null) {
            runs.push({ count: currentCount, color: currentColor });
          }
          currentColor = value;
          currentCount = 1;
        }
      } else {
        if (currentColor !== null) {
          runs.push({ count: currentCount, color: currentColor });
          currentColor = null;
          currentCount = 0;
        }
      }
    }

    if (currentColor !== null) {
      runs.push({ count: currentCount, color: currentColor });
    }

    return runs;
  }

  /**
   * Check if extracted runs exactly match the expected clues.
   * Both count and color must match for each run, in order.
   *
   * @param {Array<{count: number, color: number}>} runs - Extracted runs from grid
   * @param {Array<{count: number, color: number}>} clues - Expected clues for the line
   * @returns {boolean} True if runs match clues exactly
   */
  function runsMatchClues(runs, clues) {
    if (runs.length !== clues.length) return false;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].count !== clues[i].count || runs[i].color !== clues[i].color) {
        return false;
      }
    }
    return true;
  }

  /**
   * Update visual styling of row/column clues based on satisfaction.
   * A line is "satisfied" when its certain cells form runs that exactly match
   * the expected clues. Uncertain (pencil) cells prevent satisfaction.
   *
   * Adds/removes 'satisfied' class on clue elements for CSS styling
   * (dimming and strikethrough effect).
   *
   * @param {Object} puzzle - Current puzzle object
   */
  function updateClueSatisfaction(puzzle) {
    // Check each row
    for (let row = 0; row < puzzle.height; row++) {
      const rowValues = [];
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        // Only count certain cells for satisfaction check
        if (!cell.certain) {
          rowValues.push(-1); // Mark as uncertain
        } else {
          rowValues.push(cell.value === null ? 0 : cell.value);
        }
      }

      // Check if row has any uncertain cells
      const hasUncertain = rowValues.includes(-1);
      const cleanValues = rowValues.map(v => v === -1 ? 0 : v);
      const runs = extractRuns(cleanValues);
      const isSatisfied = !hasUncertain && runsMatchClues(runs, puzzle.row_clues[row]);

      // Use cached element for performance
      const rowClueEl = rowClueElements[row];
      if (rowClueEl) {
        rowClueEl.classList.toggle('satisfied', isSatisfied);
      }

      // Announce state changes for screen readers
      if (isSatisfied !== rowSatisfied[row]) {
        rowSatisfied[row] = isSatisfied;
        if (isSatisfied) {
          announce(`Row ${row + 1} complete`);
        } else {
          announce(`Row ${row + 1} incomplete`);
        }
      }
    }

    // Check each column
    for (let col = 0; col < puzzle.width; col++) {
      const colValues = [];
      for (let row = 0; row < puzzle.height; row++) {
        const cell = getCell(row, col);
        if (!cell.certain) {
          colValues.push(-1);
        } else {
          colValues.push(cell.value === null ? 0 : cell.value);
        }
      }

      const hasUncertain = colValues.includes(-1);
      const cleanValues = colValues.map(v => v === -1 ? 0 : v);
      const runs = extractRuns(cleanValues);
      const isSatisfied = !hasUncertain && runsMatchClues(runs, puzzle.col_clues[col]);

      // Use cached element for performance
      const colClueEl = colClueElements[col];
      if (colClueEl) {
        colClueEl.classList.toggle('satisfied', isSatisfied);
      }

      // Announce state changes for screen readers
      if (isSatisfied !== colSatisfied[col]) {
        colSatisfied[col] = isSatisfied;
        if (isSatisfied) {
          announce(`Column ${col + 1} complete`);
        } else {
          announce(`Column ${col + 1} incomplete`);
        }
      }
    }
  }

  /**
   * Check if the puzzle is solved and trigger victory if so.
   *
   * Win condition: All rows AND columns have runs that exactly match their clues,
   * AND no cells are uncertain (pencil marks). This is clue-based validation,
   * not solution comparison - allows winning without explicitly marking empty cells.
   *
   * If won: records completion, clears session, shows victory screen.
   *
   * @param {Object} puzzle - Current puzzle object
   */
  function checkWin(puzzle) {
    // Check for any uncertain (pencil) cells first
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (!cell.certain) return;
      }
    }

    // Check each row's clues are satisfied
    for (let row = 0; row < puzzle.height; row++) {
      const rowValues = [];
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        rowValues.push(cell.value === null ? 0 : cell.value);
      }
      const runs = extractRuns(rowValues);
      if (!runsMatchClues(runs, puzzle.row_clues[row])) return;
    }

    // Check each column's clues are satisfied
    for (let col = 0; col < puzzle.width; col++) {
      const colValues = [];
      for (let row = 0; row < puzzle.height; row++) {
        const cell = getCell(row, col);
        colValues.push(cell.value === null ? 0 : cell.value);
      }
      const runs = extractRuns(colValues);
      if (!runsMatchClues(runs, puzzle.col_clues[col])) return;
    }

    // Puzzle completed!
    announce('Puzzle complete!');

    // Success haptic
    if (window.Cozy.App) window.Cozy.App.vibrate([50, 100, 50]);

    // Record completion
    const storage = getStorage();
    if (storage) {
      const puzzleId = getPuzzleId(puzzle);
      storage.completePuzzle(puzzleId);
      clearSession();
      updateDropdown();
      // Refresh collection to show completion
      const collection = window.Cozy.Collection;
      if (collection) collection.refresh();
    }

    // Clear history after win
    const history = getHistory();
    if (history) history.clear();

    // Show victory screen
    showVictory(puzzle);
  }

  /**
   * Reset the current puzzle to its initial empty state.
   * Clears all cells and records the action for undo. Requires hold-to-confirm.
   */
  function resetPuzzle() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    const history = getHistory();
    const changes = [];

    // Record all non-blank cells for undo and clear them
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (cell.value !== null) {
          changes.push({
            row, col,
            before: { value: cell.value, certain: cell.certain },
            after: { value: null, certain: true }
          });
          // Clear the cell
          cell.value = null;
          cell.certain = true;
          updateCellVisual(row, col, puzzle);
        }
      }
    }

    // Only record to history if there were changes
    if (changes.length > 0) {
      if (history) {
        history.recordBatchAction('reset', changes);
      }

      // Update clue satisfaction
      updateClueSatisfaction(puzzle);

      // Clear saved grid in storage
      const storage = getStorage();
      if (storage) {
        const puzzleId = getPuzzleId(puzzle);
        storage.savePuzzleGrid(puzzleId, null);
      }

      // Update pencil actions visibility
      updatePencilActionsVisibility();
    }

    // Always update button states (even if no changes, puzzle could be empty now)
    updateHoldButtonStates();
  }

  /**
   * Reveal the puzzle solution.
   * Fills all cells with correct values. Recorded for undo. Requires hold-to-confirm.
   * Does NOT trigger win - player didn't solve it themselves.
   */
  function showSolution() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    // Zoom to fit to show full solution
    if (window.Cozy.Zoom) {
      window.Cozy.Zoom.zoomToFit();
    }

    const history = getHistory();
    const changes = [];

    // Record all cell changes for undo
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        const solutionValue = puzzle.solution[row][col];

        // Only record if the cell is different from solution
        if (cell.value !== solutionValue || !cell.certain) {
          changes.push({
            row, col,
            before: { value: cell.value, certain: cell.certain },
            after: { value: solutionValue, certain: true }
          });
        }

        // Apply solution
        cell.value = solutionValue;
        cell.certain = true;
        updateCellVisual(row, col, puzzle);
      }
    }

    // Record to history if there were changes
    if (changes.length > 0 && history) {
      history.recordBatchAction('solution', changes);
    }

    // Update clue satisfaction
    updateClueSatisfaction(puzzle);

    showToast('Solution revealed', 'info');
    updatePencilActionsVisibility();
    updateHoldButtonStates();
  }

  // === Keyboard Shortcuts ===

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl+Z / Cmd+Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z = Redo
      // Ctrl+Y = Redo (Windows)
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
          ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        performRedo();
      }
      // P = Toggle pencil mode
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        togglePencilMode();
      }
      // Number keys 1-9 = Select color
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey) {
        const colorIndex = parseInt(e.key);
        const puzzle = getPuzzles()[currentPuzzle];
        const colorIds = Object.keys(puzzle.color_map).map(Number);
        if (colorIndex <= colorIds.length) {
          selectColor(colorIds[colorIndex - 1]);
        }
      }
      // 0 or X = Select eraser
      if ((e.key === '0' || e.key === 'x') && !e.ctrlKey && !e.metaKey) {
        selectColor(0);
      }
      // Escape = Go back to collection (only on puzzle screen, not when modal is open)
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey) {
        const helpModal = document.getElementById('help-modal');
        const isHelpModalOpen = helpModal?.classList.contains('visible');
        const isOnPuzzleScreen = window.Cozy.Screens?.getCurrentScreen() === window.Cozy.Screens?.SCREENS?.PUZZLE;

        if (isOnPuzzleScreen && !isHelpModalOpen) {
          e.preventDefault();
          showCollection();
        }
      }
    });
  }

  // === Navigation (Screen Manager Integration) ===

  function saveCurrentPuzzle() {
    const puzzles = getPuzzles();
    const storage = getStorage();
    if (grid.length > 0 && puzzles[currentPuzzle] && storage) {
      const puzzleId = getPuzzleId(puzzles[currentPuzzle]);
      storage.savePuzzleGrid(puzzleId, grid);
    }
  }

  /**
   * Navigate to the collection screen.
   * Saves current puzzle progress before navigating.
   */
  function showCollection() {
    saveCurrentPuzzle();
    if (window.Cozy.Screens) {
      window.Cozy.Screens.showScreen(window.Cozy.Screens.SCREENS.COLLECTION);
    }
  }

  /**
   * Navigate to the puzzle screen for a specific puzzle.
   * @param {number} puzzleIndex - Index of the puzzle to show
   */
  function showGame(puzzleIndex) {
    if (window.Cozy.Screens) {
      window.Cozy.Screens.showScreen(window.Cozy.Screens.SCREENS.PUZZLE, { puzzleId: puzzleIndex });
    }
  }

  // Handle screen:puzzle event from ScreenManager
  function handlePuzzleScreen(event) {
    const data = event.detail || {};

    // Load specific puzzle by ID or index
    const puzzles = getPuzzles();
    let puzzleIndex = 0;

    if (data.puzzleId !== undefined) {
      puzzleIndex = data.puzzleId;

      // If puzzleId is a string, find the matching puzzle
      if (typeof data.puzzleId === 'string') {
        puzzleIndex = puzzles.findIndex(p => getPuzzleId(p) === data.puzzleId);
        if (puzzleIndex === -1) puzzleIndex = 0;
      }
    }

    // Always reload puzzle when entering screen (ensures fresh state from storage)
    loadPuzzle(puzzleIndex);
  }

  // Handle screen:collection event from ScreenManager
  function handleCollectionScreen(event) {
    saveCurrentPuzzle();

    const data = event.detail || {};
    const collection = window.Cozy.Collection;

    if (collection) {
      // If animating stamp, render with blank placeholder for target
      if (data.animateStamp && data.scrollToPuzzleId) {
        collection.refresh({ blankPuzzleId: data.scrollToPuzzleId });
      } else {
        collection.refresh();
      }

      // Scroll to specific puzzle if requested (e.g., after victory)
      if (data.scrollToPuzzleId) {
        // Small delay to ensure DOM is updated after refresh
        setTimeout(() => {
          collection.scrollToPuzzle(data.scrollToPuzzleId, {
            instant: data.quickAnimation
          });

          // If animating, fly the stamp to the target
          if (data.animateStamp && data.flyingStamp) {
            collection.animateStampTo(data.scrollToPuzzleId, data.flyingStamp, {
              quick: data.quickAnimation
            });
          }
        }, 50);
      }
    }
  }

  // Show victory screen instead of just updating status
  function showVictory(puzzle) {
    if (window.Cozy.Screens) {
      const puzzleId = getPuzzleId(puzzle);
      const match = puzzle.title.match(/^(.+?)\s*\(/);
      const puzzleName = match ? match[1].trim() : puzzle.title;

      window.Cozy.Screens.showScreen(window.Cozy.Screens.SCREENS.VICTORY, {
        puzzleId: puzzleId,
        puzzleName: puzzleName,
        solution: puzzle.solution,
        palette: puzzle.color_map
      });
    }
  }

  function updateCurrentPuzzleTitle() {
    const titleEl = document.getElementById('current-puzzle-title');
    if (!titleEl) return;

    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (puzzle) {
      // Parse name from title (e.g., "Dandelion 2 (5x7, easy)" -> "Dandelion 2")
      const match = puzzle.title.match(/^(.+?)\s*\(/);
      titleEl.textContent = match ? match[1].trim() : puzzle.title;
    }
  }

  // === Initialization ===

  // Hold-to-confirm button pattern
  const HOLD_DURATION = 1200; // ms

  /**
   * Set up a "hold to confirm" button for destructive actions.
   * User must hold the button for HOLD_DURATION ms to trigger the action.
   * Provides visual feedback via CSS 'holding' class during hold.
   *
   * Supports mouse, touch, and keyboard (Enter/Space) interactions.
   * Cancels if user releases early or moves away from button.
   *
   * @param {HTMLElement} btn - Button element to enhance
   * @param {Function} onConfirm - Callback when hold completes successfully
   */
  function setupHoldButton(btn, onConfirm) {
    if (!btn) return;

    let holdTimer = null;
    let isHolding = false;

    function startHold(e) {
      // Prevent default to avoid text selection on mobile
      if (e.type === 'touchstart') {
        e.preventDefault();
      }

      // Don't start hold if button is disabled
      if (btn.disabled) return;

      if (isHolding) return;
      isHolding = true;
      btn.classList.add('holding');

      holdTimer = setTimeout(() => {
        if (isHolding) {
          // Mark as completed for instant hide (no animation)
          btn.classList.add('hold-complete');
          cancelHold();
          onConfirm();
          // Remove completed class after a tick
          setTimeout(() => btn.classList.remove('hold-complete'), 50);
        }
      }, HOLD_DURATION);
    }

    function cancelHold() {
      isHolding = false;
      btn.classList.remove('holding');
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    }

    // Mouse events
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('mouseup', cancelHold);
    btn.addEventListener('mouseleave', cancelHold);

    // Touch events
    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('touchend', cancelHold);
    btn.addEventListener('touchcancel', cancelHold);

    // Keyboard events (Enter/Space)
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startHold(e);
      }
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        cancelHold();
      }
    });
    btn.addEventListener('blur', cancelHold);

    // Set CSS variable for animation duration
    btn.style.setProperty('--hold-duration', `${HOLD_DURATION}ms`);
  }

  // Setup button event listeners (replaces inline onclick handlers for CSP compliance)
  function setupButtonListeners() {
    // Mode menu buttons
    const penModeBtn = document.getElementById('pen-mode-btn');
    const pencilModeBtn = document.getElementById('pencil-mode-btn');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (penModeBtn) {
      penModeBtn.addEventListener('click', () => setPencilMode(false));
    }
    if (pencilModeBtn) {
      pencilModeBtn.addEventListener('click', () => setPencilMode(true));
    }
    if (undoBtn) {
      undoBtn.addEventListener('click', performUndo);
    }
    if (redoBtn) {
      redoBtn.addEventListener('click', performRedo);
    }

    // Pencil action buttons (in mode menu)
    const clearPencilBtn = document.getElementById('clear-pencil-btn');
    const confirmPencilBtn = document.getElementById('confirm-pencil-btn');

    if (clearPencilBtn) {
      clearPencilBtn.addEventListener('click', () => {
        clearAllPencilMarks();
        closeModeMenu();
      });
    }
    if (confirmPencilBtn) {
      confirmPencilBtn.addEventListener('click', () => {
        confirmAllPencilMarks();
        closeModeMenu();
      });
    }

    // Hold-to-confirm buttons (Reset, Solution)
    const resetBtn = document.getElementById('reset-btn');
    const solutionBtn = document.getElementById('solution-btn');
    setupHoldButton(resetBtn, resetPuzzle);
    setupHoldButton(solutionBtn, showSolution);

    // Back button on puzzle screen
    const puzzleBackBtn = document.querySelector('#screen-puzzle .header-back-btn');
    if (puzzleBackBtn) {
      puzzleBackBtn.addEventListener('click', navigateToCollectionWithStamp);
    }

    // Back button on collection screen (handled by ScreenManager)
    const collectionBackBtn = document.querySelector('#screen-collection .header-back-btn');
    if (collectionBackBtn) {
      collectionBackBtn.addEventListener('click', () => {
        if (window.Cozy.Screens) {
          window.Cozy.Screens.showScreen(window.Cozy.Screens.SCREENS.HOME);
        }
      });
    }
  }

  function init() {
    setupKeyboardShortcuts();
    setupButtonListeners();
    setupHelpModal();
    setupSkipLink();

    // Initialize history UI
    const history = getHistory();
    if (history) history.updateUI();

    // Initialize pencil mode UI
    updatePencilModeUI();

    // Listen for storage reset to clear in-memory grid
    const storage = getStorage();
    if (storage && storage.onChange) {
      storage.onChange((event) => {
        if (event === 'reset') {
          // Clear in-memory grid when storage is reset
          grid = [];
          currentPuzzle = 0;
        }
      });
    }

    // Initialize collection screen
    const collection = window.Cozy.Collection;
    const puzzles = getPuzzles();

    if (collection && puzzles.length > 0) {
      collection.init('collection-screen', puzzles, (index) => {
        // Navigate to puzzle via ScreenManager
        if (window.Cozy.Screens) {
          window.Cozy.Screens.showScreen(window.Cozy.Screens.SCREENS.PUZZLE, { puzzleId: index });
        }
      });
    }

    // Listen for screen events from ScreenManager
    window.addEventListener('screen:puzzle', handlePuzzleScreen);
    window.addEventListener('screen:collection', handleCollectionScreen);

    // Pre-load first puzzle in background (will be shown when puzzle screen activates)
    if (puzzles.length > 0) {
      loadPuzzle(0);
    }
  }

  // Render current grid state to a canvas for stamp animation
  function renderGridToCanvas() {
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (!puzzle || grid.length === 0) return null;

    // Check if there's any progress to show
    let hasProgress = false;
    for (let row = 0; row < puzzle.height && !hasProgress; row++) {
      for (let col = 0; col < puzzle.width && !hasProgress; col++) {
        const cell = getCell(row, col);
        if (cell.value !== null && cell.value > 0) {
          hasProgress = true;
        }
      }
    }
    if (!hasProgress) return null;

    return renderOutlinedCanvas(
      puzzle.width,
      puzzle.height,
      CONFIG.STAMP_CANVAS_SIZE,
      (row, col) => {
        const cell = getCell(row, col);
        if (cell.value !== null && cell.value > 0) {
          const color = puzzle.color_map[cell.value];
          if (color) {
            return color;
          }
        }
        return null;
      }
    );
  }

  /**
   * Navigate to collection screen with a flying stamp animation.
   * Renders current grid progress to a canvas that animates from the grid
   * to the puzzle's card in the collection. Used when pressing back button
   * during puzzle play to give visual feedback of progress.
   */
  function navigateToCollectionWithStamp() {
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (!puzzle) {
      showCollection();
      return;
    }

    const puzzleId = getPuzzleId(puzzle);

    // Try to render current progress to canvas
    const progressCanvas = renderGridToCanvas();
    if (!progressCanvas) {
      // No progress to animate, just navigate
      showCollection();
      return;
    }

    // Get the grid element's position for the starting point
    const gridEl = document.getElementById('grid');
    if (!gridEl) {
      showCollection();
      return;
    }

    const startRect = gridEl.getBoundingClientRect();

    // Create flying stamp from the progress canvas
    const flyingStamp = document.createElement('canvas');
    flyingStamp.width = progressCanvas.width;
    flyingStamp.height = progressCanvas.height;
    const ctx = flyingStamp.getContext('2d');
    ctx.drawImage(progressCanvas, 0, 0);

    // Start at the grid's visual size, preserving aspect ratio
    const canvasAspect = progressCanvas.width / progressCanvas.height;
    const gridAspect = startRect.width / startRect.height;
    let cssWidth, cssHeight;
    if (canvasAspect > gridAspect) {
      // Canvas is wider than grid - fit to width
      cssWidth = startRect.width;
      cssHeight = startRect.width / canvasAspect;
    } else {
      // Canvas is taller than grid - fit to height
      cssHeight = startRect.height;
      cssWidth = startRect.height * canvasAspect;
    }

    // Center within the grid bounds
    const offsetX = (startRect.width - cssWidth) / 2;
    const offsetY = (startRect.height - cssHeight) / 2;

    flyingStamp.className = 'flying-stamp';
    flyingStamp.style.left = (startRect.left + offsetX) + 'px';
    flyingStamp.style.top = (startRect.top + offsetY) + 'px';
    flyingStamp.style.width = cssWidth + 'px';
    flyingStamp.style.height = cssHeight + 'px';
    document.body.appendChild(flyingStamp);

    // Save and navigate to collection with animation
    saveCurrentPuzzle();
    if (window.Cozy.Screens) {
      window.Cozy.Screens.showScreen(window.Cozy.Screens.SCREENS.COLLECTION, {
        scrollToPuzzleId: puzzleId,
        animateStamp: true,
        flyingStamp: flyingStamp,
        quickAnimation: true  // Flag for shorter delay
      });
    }
  }

  /**
   * Clear all game state to initial values.
   * Called when user resets all progress from settings. Clears grid,
   * resets indices, and wipes undo history.
   */
  function clearAllState() {
    grid = [];
    currentPuzzle = 0;
    selectedColor = 1;
    isDragging = false;
    dragColor = null;
    isPencilMode = false;

    const history = getHistory();
    if (history) history.clear();
  }

  // === Zoom Integration API ===

  /**
   * Get clue information for a specific cell position
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {Object|null} Object with rowClues and colClues arrays, each containing {count, color, satisfied}
   */
  function getClueInfo(row, col) {
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (!puzzle) return null;

    // Get row clues with satisfaction status
    const rowClueEl = rowClueElements[row];
    const rowSatisfied = rowClueEl ? rowClueEl.classList.contains('satisfied') : false;
    const rowClues = puzzle.row_clues[row].map(clue => ({
      count: clue.count,
      color: clue.color,
      satisfied: rowSatisfied
    }));

    // Get column clues with satisfaction status
    const colClueEl = colClueElements[col];
    const colSatisfied = colClueEl ? colClueEl.classList.contains('satisfied') : false;
    const colClues = puzzle.col_clues[col].map(clue => ({
      count: clue.count,
      color: clue.color,
      satisfied: colSatisfied
    }));

    return { rowClues, colClues };
  }

  /**
   * Get RGB color array for a color ID
   * @param {number} colorId - Color ID (1-indexed)
   * @returns {number[]|null} RGB array [r, g, b] or null if not found
   */
  function getColorRgb(colorId) {
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (!puzzle || !puzzle.color_map) return null;
    return puzzle.color_map[colorId] || null;
  }

  /**
   * Get the current puzzle object
   * @returns {Object|null} Current puzzle or null
   */
  function getCurrentPuzzle() {
    const puzzles = getPuzzles();
    return puzzles[currentPuzzle] || null;
  }

  // Expose globally
  window.Cozy.Garden = {
    resetPuzzle: resetPuzzle,
    showSolution: showSolution,
    performUndo: performUndo,
    performRedo: performRedo,
    togglePencilMode: togglePencilMode,
    setPencilMode: setPencilMode,
    clearAllPencilMarks: clearAllPencilMarks,
    confirmAllPencilMarks: confirmAllPencilMarks,
    selectColor: selectColor,
    showCollection: showCollection,
    showGame: showGame,
    clearAllState: clearAllState,
    navigateToCollectionWithStamp: navigateToCollectionWithStamp,
    getPuzzleId: getPuzzleId,  // Utility for generating consistent puzzle IDs
    // Zoom integration API
    getClueInfo: getClueInfo,
    getColorRgb: getColorRgb,
    getCurrentPuzzle: getCurrentPuzzle
  };

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


// ============================================================
// FILE: src/js/zoom.js
// ============================================================

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
  let isTooltipLocked = false;      // Lock tooltip during drag
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
    if (!tooltip || isTooltipLocked) return;
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
      const textColor = brightness > CONFIG.BRIGHTNESS_MIDPOINT ? '#333' : '#fff';

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

    isTooltipLocked = false;
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
    isTooltipLocked = true;
    tooltip?.classList.add('dragging');
  }

  function onCellTouchEnd() {
    if (!isZoomedBeyondFit()) return;

    clearTimeout(tooltipShowTimer);
    isTooltipLocked = false;
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
    if (puzzle.width <= CONFIG.AUTO_ZOOM_MIN_SIZE && puzzle.height <= CONFIG.AUTO_ZOOM_MIN_SIZE) return;

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
