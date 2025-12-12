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
            // Migrate if needed
            if (this.data.version !== STORAGE_VERSION) {
              this.data = this.migrate(this.data);
            }
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

    // Migrate old data format
    migrate(oldData) {
      const newData = getDefaultData();
      // Copy over compatible fields
      if (oldData.progress) newData.progress = oldData.progress;
      if (oldData.settings) Object.assign(newData.settings, oldData.settings);
      if (oldData.stats) Object.assign(newData.stats, oldData.stats);
      newData.version = STORAGE_VERSION;
      return newData;
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
      // Save the grid (deep copy with object support)
      if (grid) {
        this.data.progress[puzzleId].savedGrid = grid.map(row =>
          row.map(cell => {
            // Handle new object format {value, certain}
            if (typeof cell === 'object' && cell !== null && 'value' in cell) {
              return { value: cell.value, certain: cell.certain };
            }
            // Handle legacy format (raw value) - convert to new format
            return { value: cell, certain: true };
          })
        );
      } else {
        this.data.progress[puzzleId].savedGrid = null;
      }
      this.save();
    }

    // Get saved grid for a puzzle
    // Returns grid in new format: array of {value, certain} objects
    getPuzzleGrid(puzzleId) {
      if (!this.data.progress) return null;
      const progress = this.data.progress[puzzleId];
      if (!progress || !progress.savedGrid) return null;

      // Deep copy with format handling
      return progress.savedGrid.map(row =>
        row.map(cell => {
          // Handle new object format
          if (typeof cell === 'object' && cell !== null && 'value' in cell) {
            return { value: cell.value, certain: cell.certain };
          }
          // Handle legacy format (raw value) - convert to new format
          return { value: cell, certain: true };
        })
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
          row.map(cell => {
            // Handle new object format {value, certain}
            if (typeof cell === 'object' && cell !== null && 'value' in cell) {
              return { value: cell.value, certain: cell.certain };
            }
            // Handle legacy format (raw value) - convert to new format
            return { value: cell, certain: true };
          })
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
      // Ensure flags object exists (migration support)
      if (!this.data.flags) {
        this.data.flags = getDefaultData().flags;
      }
      return this.data.flags[key] || false;
    }

    setFlag(key, value = true) {
      if (!this.data.flags) {
        this.data.flags = getDefaultData().flags;
      }
      this.data.flags[key] = value;
      this.save();
    }

    // === UI State Methods ===

    getUIState(key) {
      // Ensure uiState object exists (migration support)
      if (!this.data.uiState) {
        this.data.uiState = getDefaultData().uiState;
      }
      return this.data.uiState[key];
    }

    setUIState(key, value) {
      if (!this.data.uiState) {
        this.data.uiState = getDefaultData().uiState;
      }
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
        if (imported.version) {
          this.data = this.migrate(imported);
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
  window.CozyStorage = storage;
})();
