// Cozy Garden - Nonogram Game Logic
// Uses window.PUZZLE_DATA loaded from data/puzzles.js
// Uses window.CozyStorage for progress persistence
// Uses window.CozyHistory for undo/redo

(function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG, getPuzzleId, getPuzzleTitle, renderOutlinedCanvas } = window.CozyUtils;

  // Game state
  let currentPuzzle = 0;
  let currentDifficulty = 'easy';
  let selectedColor = 1;
  let grid = [];           // Stores {value, certain} objects
  let isDragging = false;
  let dragColor = null;
  let dragCertain = true;  // Whether current drag creates certain or maybe cells
  let pencilMode = false;  // Pencil mode for uncertain marks
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

  // Help shown flag now stored in CozyStorage.flags.helpShown

  // === Toast Notification ===
  let toastTimeout = null;

  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    // Clear any existing timeout
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

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal?.classList.contains('visible')) {
        hideHelpModal();
      }
    });
  }

  function maybeShowFirstTimeHelp() {
    // Show help modal automatically on first visit
    if (!window.CozyStorage?.getFlag('helpShown')) {
      // Small delay so the puzzle renders first
      setTimeout(() => {
        showHelpModal();
        window.CozyStorage?.setFlag('helpShown', true);
      }, 500);
    }
  }

  // Normalize puzzle from concise format to verbose format
  // Concise: {t, w, h, r, c, p, s} with 0-indexed colors, hex palette
  // Verbose: {title, width, height, row_clues, col_clues, color_map, solution} with 1-indexed colors
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
    // Validate concise format has required fields
    if (!p.t || !p.w || !p.h || !p.r || !p.c || !p.p || !p.s) {
      console.warn('[Game] Invalid concise puzzle format, missing required fields');
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

    return {
      title: p.t,
      width: p.w,
      height: p.h,
      row_clues: convertClues(p.r),
      col_clues: convertClues(p.c),
      color_map: convertPalette(p.p),
      solution: convertSolution(p.s)
    };
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
    return window.CozyStorage || null;
  }

  function getHistory() {
    return window.CozyHistory || null;
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

  function setPencilMode(enabled) {
    pencilMode = enabled;
    updatePencilModeUI();
    announce(enabled ? 'Pencil mode' : 'Pen mode');
    closeModeMenu(); // Close menu after selection
  }

  function togglePencilMode() {
    setPencilMode(!pencilMode);
  }

  function updatePencilModeUI() {
    const penBtn = document.getElementById('pen-mode-btn');
    const pencilBtn = document.getElementById('pencil-mode-btn');
    const menuBtn = document.getElementById('palette-menu-btn');

    if (penBtn) {
      penBtn.classList.toggle('active', !pencilMode);
      penBtn.setAttribute('aria-checked', String(!pencilMode));
    }
    if (pencilBtn) {
      pencilBtn.classList.toggle('active', pencilMode);
      pencilBtn.setAttribute('aria-checked', String(pencilMode));
    }

    // Update menu button icon based on mode
    if (menuBtn) {
      const svg = menuBtn.querySelector('.menu-icon-svg');
      if (svg) {
        // Remove stroke, use fill for these icons
        svg.removeAttribute('stroke');
        svg.removeAttribute('stroke-width');
        svg.setAttribute('fill', 'currentColor');
        if (pencilMode) {
          // Pencil icon (dashed lines indicate uncertainty)
          svg.innerHTML = '<path d="M19.07 13.88L13 19.94l-1.41-1.41 6.07-6.06 1.41 1.41zm-5.66-5.66l-6.06 6.07-1.42-1.41 6.07-6.07 1.41 1.41zM17.66 5.99l-2.34 2.34 1.41 1.41 2.34-2.34-1.41-1.41zM3 18v3h3l.01-.01L3 18zm3-3l-1 1 3 3 1-1-3-3z" opacity="0.5"/><path d="M9.17 16.17L7.76 17.59l3.54 3.54 1.41-1.41-3.54-3.55zm10.6-10.6l-3.53-3.54-1.42 1.42 3.54 3.53 1.41-1.41z"/>';
        } else {
          // Solid pen icon
          svg.innerHTML = '<path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"/>';
        }
      }
    }

    document.body.classList.toggle('pencil-mode', pencilMode);
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
        badge.textContent = markCount > 99 ? '99+' : String(markCount);
      }
    }
  }

  // === Batch Operations ===

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
      if (window.CozyApp) window.CozyApp.vibrate(20);
    }

    updatePencilActionsVisibility();
    saveSession();
  }

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
      if (window.CozyApp) window.CozyApp.vibrate([20, 50, 20]);
    }

    updatePencilActionsVisibility();
    checkWin(puzzle);
    saveSession();
  }

  // === Undo/Redo ===

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
    if (window.CozyApp) window.CozyApp.vibrate(15);

    updatePencilActionsVisibility();
    updateClueSatisfaction(puzzle);
    saveSession();
  }

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
    if (window.CozyApp) window.CozyApp.vibrate(15);

    updatePencilActionsVisibility();
    updateClueSatisfaction(puzzle);
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
      pencilMode = false;
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
      if (window.CozyZoom) {
        window.CozyZoom.initForPuzzle(puzzle);
      }

      // Show help modal on first-ever puzzle load
      maybeShowFirstTimeHelp();
    } finally {
      isLoadingPuzzle = false;
    }
  }

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

  function buildClues(puzzle) {
    // Initialize clue element caches
    colClueElements = [];
    rowClueElements = [];

    // Column clues
    const colCluesEl = document.getElementById('col-clues');
    colCluesEl.innerHTML = '';
    colCluesEl.style.gridTemplateColumns = `repeat(${puzzle.width}, var(--cell-size))`;

    puzzle.col_clues.forEach((clues, colIndex) => {
      const col = document.createElement('div');
      col.className = 'col-clue';
      col.dataset.col = colIndex;

      if (clues.length === 0) {
        const cell = document.createElement('div');
        cell.className = 'clue-cell';
        cell.textContent = '0';
        cell.style.background = '#333';
        col.appendChild(cell);
      } else {
        clues.forEach(clue => {
          const cell = document.createElement('div');
          cell.className = 'clue-cell';
          cell.textContent = clue.count;
          cell.style.background = rgb(puzzle.color_map[clue.color]);
          cell.style.color = getBrightness(puzzle.color_map[clue.color]) > 128 ? '#000' : '#fff';
          cell.style.cursor = 'pointer';
          cell.onclick = () => selectColor(clue.color);
          col.appendChild(cell);
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
        const cell = document.createElement('div');
        cell.className = 'row-clue-cell';
        cell.textContent = '0';
        cell.style.background = '#333';
        rowClues.appendChild(cell);
      } else {
        clues.forEach(clue => {
          const cell = document.createElement('div');
          cell.className = 'row-clue-cell';
          cell.textContent = clue.count;
          cell.style.background = rgb(puzzle.color_map[clue.color]);
          cell.style.color = getBrightness(puzzle.color_map[clue.color]) > 128 ? '#000' : '#fff';
          cell.style.cursor = 'pointer';
          cell.onclick = () => selectColor(clue.color);
          rowClues.appendChild(cell);
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
    cell.setAttribute('aria-label', `Row ${row + 1}, Column ${col + 1}`);
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
        fillCell(row, col, selectedColor, !pencilMode);
        if (history) history.commitAction();
        updatePencilActionsVisibility();
      } else if (e.key === 'x' || e.key === 'X') {
        // X key marks cell as empty
        e.preventDefault();
        e.stopPropagation(); // Prevent global handler from selecting eraser
        const history = getHistory();
        if (history) history.beginAction('fill');
        fillCell(row, col, 0, !pencilMode);
        if (history) history.commitAction();
        updatePencilActionsVisibility();
      }
    };
  }

  /**
   * Attach mouse event handlers for cell interaction
   */
  function attachCellMouseHandlers(cell, row, col) {
    cell.onmousedown = (e) => {
      e.preventDefault();
      cell.focus(); // Explicitly focus since preventDefault blocks default focus
      const history = getHistory();
      if (history) history.beginAction('fill');

      isDragging = true;
      dragColor = e.button === 2 ? 0 : selectedColor;
      dragCertain = !pencilMode;
      fillCell(row, col, dragColor, dragCertain);
      // Capture actual value after toggle logic for consistent drag
      const cellAfterFill = getCell(row, col);
      dragColor = cellAfterFill.value;
      dragCertain = cellAfterFill.certain;
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
      if (window.CozyZoom) {
        const touchY = e.touches[0]?.clientY ?? 0;
        window.CozyZoom.onCellTouchStart(row, col, touchY);
      }

      const history = getHistory();
      if (history) history.beginAction('fill');

      isDragging = true;
      dragColor = selectedColor;
      dragCertain = !pencilMode;

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
          if (window.CozyApp) window.CozyApp.vibrate(50);
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
          if (window.CozyZoom) {
            window.CozyZoom.onCellTouchMove(r, c);
          }
        }
      }
    };

    cell.ontouchend = () => {
      clearTimeout(longPressTimer);

      // If it was a quick tap (not long-press, not drag), ensure we filled
      const tapDuration = Date.now() - touchStartTime;
      if (tapDuration < CONFIG.LONG_PRESS_DELAY && !touchMoved) {
        // Quick tap - already filled in touchstart
      }

      isDragging = false;
      dragColor = null;

      const history = getHistory();
      if (history) history.commitAction();

      updatePencilActionsVisibility();

      // Notify zoom system to hide tooltip
      if (window.CozyZoom) {
        window.CozyZoom.onCellTouchEnd();
      }
    };

    cell.ontouchcancel = () => {
      clearTimeout(longPressTimer);
      isDragging = false;
      dragColor = null;

      const history = getHistory();
      if (history) history.cancelAction();

      // Notify zoom system to hide tooltip
      if (window.CozyZoom) {
        window.CozyZoom.onCellTouchEnd();
      }
    };
  }

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
    mouseUpHandler = () => {
      if (isDragging) {
        isDragging = false;
        dragColor = null;

        const history = getHistory();
        if (history) history.commitAction();

        updatePencilActionsVisibility();
      }
    };
    document.addEventListener('mouseup', mouseUpHandler);
  }

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
    if (window.CozyApp) window.CozyApp.vibrate(10);

    updateClueSatisfaction(puzzle);
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
        }
      }
    }
  }

  // Extract color runs from a line of cell values
  // Returns array of {count, color} objects
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

  // Check if extracted runs match the clues
  function runsMatchClues(runs, clues) {
    if (runs.length !== clues.length) return false;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].count !== clues[i].count || runs[i].color !== clues[i].color) {
        return false;
      }
    }
    return true;
  }

  // Update visual styling of clues based on satisfaction
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
    }
  }

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
    // (Victory screen provides the feedback, no toast needed)

    // Success haptic
    if (window.CozyApp) window.CozyApp.vibrate([50, 100, 50]);

    // Record completion
    const storage = getStorage();
    if (storage) {
      const puzzleId = getPuzzleId(puzzle);
      storage.completePuzzle(puzzleId);
      clearSession();
      updateDropdown();
      // Refresh collection to show completion
      const collection = window.CozyCollection;
      if (collection) collection.refresh();
    }

    // Clear history after win
    const history = getHistory();
    if (history) history.clear();

    // Show victory screen
    showVictory(puzzle);
  }

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
  }

  function showSolution() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    // Zoom to fit to show full solution
    if (window.CozyZoom) {
      window.CozyZoom.zoomToFit();
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
        const isOnPuzzleScreen = window.ScreenManager?.getCurrentScreen() === window.ScreenManager?.SCREENS?.PUZZLE;

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

  // Navigate to collection screen, saving current puzzle first
  function showCollection() {
    saveCurrentPuzzle();
    if (window.ScreenManager) {
      window.ScreenManager.showScreen(window.ScreenManager.SCREENS.COLLECTION);
    }
  }

  // Navigate to puzzle screen
  function showGame(puzzleIndex) {
    if (window.ScreenManager) {
      window.ScreenManager.showScreen(window.ScreenManager.SCREENS.PUZZLE, { puzzleId: puzzleIndex });
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
    const collection = window.CozyCollection;

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
    if (window.ScreenManager) {
      const puzzleId = getPuzzleId(puzzle);
      const match = puzzle.title.match(/^(.+?)\s*\(/);
      const puzzleName = match ? match[1].trim() : puzzle.title;

      window.ScreenManager.showScreen(window.ScreenManager.SCREENS.VICTORY, {
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

  function setupHoldButton(btn, onConfirm) {
    if (!btn) return;

    let holdTimer = null;
    let isHolding = false;

    function startHold(e) {
      // Prevent default to avoid text selection on mobile
      if (e.type === 'touchstart') {
        e.preventDefault();
      }

      if (isHolding) return;
      isHolding = true;
      btn.classList.add('holding');

      holdTimer = setTimeout(() => {
        if (isHolding) {
          cancelHold();
          onConfirm();
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
        if (window.ScreenManager) {
          window.ScreenManager.showScreen(window.ScreenManager.SCREENS.HOME);
        }
      });
    }
  }

  function init() {
    setupKeyboardShortcuts();
    setupButtonListeners();
    setupHelpModal();

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
    const collection = window.CozyCollection;
    const puzzles = getPuzzles();

    if (collection && puzzles.length > 0) {
      collection.init('collection-screen', puzzles, (index) => {
        // Navigate to puzzle via ScreenManager
        if (window.ScreenManager) {
          window.ScreenManager.showScreen(window.ScreenManager.SCREENS.PUZZLE, { puzzleId: index });
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

  // Navigate to collection with stamp animation for partial progress
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
    if (window.ScreenManager) {
      window.ScreenManager.showScreen(window.ScreenManager.SCREENS.COLLECTION, {
        scrollToPuzzleId: puzzleId,
        animateStamp: true,
        flyingStamp: flyingStamp,
        quickAnimation: true  // Flag for shorter delay
      });
    }
  }

  // Clear all game state (called when progress is reset)
  function clearAllState() {
    grid = [];
    currentPuzzle = 0;
    selectedColor = 1;
    isDragging = false;
    dragColor = null;
    pencilMode = false;

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
  window.CozyGarden = {
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
