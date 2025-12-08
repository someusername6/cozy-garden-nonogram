// Cozy Garden - Storage Module
// Handles progress persistence using localStorage with IndexedDB fallback

(function() {
  'use strict';

  const STORAGE_KEY = 'cozy_garden_data';
  const STORAGE_VERSION = 1;

  // Default data structure
  function getDefaultData() {
    return {
      version: STORAGE_VERSION,
      progress: {}, // puzzleId -> { completed: bool, bestTime: ms, attempts: int }
      settings: {
        soundEnabled: true,
        vibrationEnabled: true,
        theme: 'light',
        showTimer: true,
        autoMarkComplete: true
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
          this.data = JSON.parse(stored);
          // Migrate if needed
          if (this.data.version !== STORAGE_VERSION) {
            this.data = this.migrate(this.data);
          }
        } else {
          this.data = getDefaultData();
          this.save();
        }
      } catch (e) {
        console.warn('[Storage] Failed to load, using defaults:', e);
        this.data = getDefaultData();
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
        lastPlayed: null
      };
    }

    // Mark puzzle as completed
    completePuzzle(puzzleId, timeMs) {
      const progress = this.getPuzzleProgress(puzzleId);
      const wasNew = !progress.completed;

      progress.completed = true;
      progress.attempts += 1;
      progress.lastPlayed = Date.now();

      if (progress.bestTime === null || timeMs < progress.bestTime) {
        progress.bestTime = timeMs;
      }

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
    saveSession(puzzleIndex, difficulty, grid, startTime) {
      this.data.currentSession = {
        puzzleIndex,
        difficulty,
        grid: grid ? grid.map(row => [...row]) : null,
        startTime
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
        grid: null,
        startTime: null
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
