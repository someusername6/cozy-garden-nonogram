// Cozy Garden - History Module
// Handles undo/redo functionality with action grouping for drag operations

(function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG } = window.CozyUtils;

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
  window.CozyHistory = History;
})();
