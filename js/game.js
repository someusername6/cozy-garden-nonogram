// Cozy Garden - Nonogram Game Logic
// Uses window.PUZZLE_DATA loaded from data/puzzles.js
// Uses window.CozyStorage for progress persistence
// Uses window.CozyHistory for undo/redo

(function() {
  'use strict';

  // Game state
  let currentPuzzle = 0;
  let currentDifficulty = 'easy';
  let selectedColor = 1;
  let grid = [];           // Stores {value, certain} objects
  let isDragging = false;
  let dragColor = null;
  let dragCertain = true;  // Whether current drag creates certain or maybe cells
  let pencilMode = false;  // Pencil mode for uncertain marks

  // Get puzzles from global (loaded via script tag)
  function getPuzzles() {
    return window.PUZZLE_DATA || [];
  }

  // === Cell State Helpers ===

  function createCell(value = null, certain = true) {
    return { value: value, certain: certain };
  }

  function getCell(row, col) {
    const cell = grid[row]?.[col];
    if (!cell) return createCell();
    // Handle legacy format (raw values)
    if (typeof cell !== 'object' || !('value' in cell)) {
      return createCell(cell, true);
    }
    return cell;
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

  function getPuzzleId(puzzle) {
    return puzzle.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function getStorage() {
    return window.CozyStorage || null;
  }

  function getHistory() {
    return window.CozyHistory || null;
  }

  // === Pencil Mode ===

  function setPencilMode(enabled) {
    pencilMode = enabled;
    updatePencilModeUI();
  }

  function togglePencilMode() {
    setPencilMode(!pencilMode);
  }

  function updatePencilModeUI() {
    const penBtn = document.getElementById('pen-mode-btn');
    const pencilBtn = document.getElementById('pencil-mode-btn');

    if (penBtn) penBtn.classList.toggle('active', !pencilMode);
    if (pencilBtn) pencilBtn.classList.toggle('active', pencilMode);

    document.body.classList.toggle('pencil-mode', pencilMode);
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

  function updatePencilActionsVisibility() {
    const pencilActions = document.getElementById('pencil-actions');
    if (pencilActions) {
      pencilActions.style.display = hasPencilMarks() ? 'flex' : 'none';
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

    currentPuzzle = index;
    const puzzle = puzzles[index];
    if (!puzzle) return;

    const puzzleId = getPuzzleId(puzzle);

    // Initialize or restore grid
    let savedGrid = restoreGrid;
    if (!savedGrid && storage) {
      savedGrid = storage.getPuzzleGrid(puzzleId);
    }

    const hasRestoredGrid = savedGrid && savedGrid.length === puzzle.height;
    if (hasRestoredGrid) {
      // Deep copy and migrate format if needed
      grid = savedGrid.map(row => row.map(cell => {
        if (typeof cell === 'object' && 'value' in cell) {
          return { value: cell.value, certain: cell.certain };
        }
        // Legacy format: raw value
        return createCell(cell, true);
      }));
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

    document.getElementById('status').textContent = 'Select colors and fill the grid';
    document.getElementById('status').classList.remove('won');

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

    if (window.CozyZoom && window.CozyZoom.onPuzzleChange) {
      window.CozyZoom.onPuzzleChange();
    }
  }

  function buildPalette(puzzle) {
    const palette = document.getElementById('palette');
    palette.innerHTML = '<span class="palette-label">Colors:</span>';

    // Add eraser
    const eraser = document.createElement('button');
    eraser.className = 'color-btn eraser';
    eraser.title = 'Eraser';
    eraser.onclick = () => selectColor(0);
    palette.appendChild(eraser);

    // Add color buttons
    Object.entries(puzzle.color_map).forEach(([colorId, colorRgb]) => {
      const btn = document.createElement('button');
      btn.className = 'color-btn' + (parseInt(colorId) === selectedColor ? ' selected' : '');
      btn.style.background = rgb(colorRgb);
      btn.onclick = () => selectColor(parseInt(colorId));
      palette.appendChild(btn);
    });
  }

  function selectColor(colorId) {
    selectedColor = colorId;
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];

    document.querySelectorAll('.color-btn').forEach((btn, idx) => {
      if (idx === 0) {
        btn.classList.toggle('selected', colorId === 0);
      } else {
        btn.classList.toggle('selected', parseInt(Object.keys(puzzle.color_map)[idx - 1]) === colorId);
      }
    });
  }

  function buildClues(puzzle) {
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

      rowContainer.appendChild(rowClues);
    });
  }

  // === Crosshair Hover Effect ===
  let currentHoverRow = -1;
  let currentHoverCol = -1;

  // Detect touch device to disable crosshair (causes issues with touch)
  const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

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

    // Highlight cells in same row and column
    document.querySelectorAll('.cell').forEach(cell => {
      const cellRow = parseInt(cell.dataset.row);
      const cellCol = parseInt(cell.dataset.col);

      if (cellRow === row && cellCol === col) {
        cell.classList.add('highlight-cell');
      }
      if (cellRow === row) {
        cell.classList.add('highlight-row');
      }
      if (cellCol === col) {
        cell.classList.add('highlight-col');
      }
    });

    // Highlight corresponding clues
    const rowClue = document.querySelector(`.row-clues[data-row="${row}"]`);
    const colClue = document.querySelector(`.col-clue[data-col="${col}"]`);
    if (rowClue) rowClue.classList.add('highlight-clue');
    if (colClue) colClue.classList.add('highlight-clue');
  }

  function clearCrosshairHighlight() {
    currentHoverRow = -1;
    currentHoverCol = -1;

    document.querySelectorAll('.highlight-row, .highlight-col, .highlight-cell').forEach(el => {
      el.classList.remove('highlight-row', 'highlight-col', 'highlight-cell');
    });
    document.querySelectorAll('.highlight-clue').forEach(el => {
      el.classList.remove('highlight-clue');
    });
  }

  function buildGrid(puzzle) {
    const gridEl = document.getElementById('grid');
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${puzzle.width}, var(--cell-size))`;

    // Clear highlight when leaving grid
    gridEl.onmouseleave = () => clearCrosshairHighlight();

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = row;
        cell.dataset.col = col;

        // === Mouse Events ===
        cell.onmousedown = (e) => {
          e.preventDefault();
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

        // === Touch Events with Long-Press ===
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
          }, 400);

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
            }
          }
        };

        cell.ontouchend = () => {
          clearTimeout(longPressTimer);

          // If it was a quick tap (not long-press, not drag), ensure we filled
          const tapDuration = Date.now() - touchStartTime;
          if (tapDuration < 400 && !touchMoved) {
            // Quick tap - already filled in touchstart
          }

          isDragging = false;
          dragColor = null;

          const history = getHistory();
          if (history) history.commitAction();

          updatePencilActionsVisibility();
        };

        cell.ontouchcancel = () => {
          clearTimeout(longPressTimer);
          isDragging = false;
          dragColor = null;

          const history = getHistory();
          if (history) history.cancelAction();
        };

        gridEl.appendChild(cell);
      }
    }

    // Mouse up handler (for mouse-based drag)
    document.onmouseup = () => {
      if (isDragging) {
        isDragging = false;
        dragColor = null;

        const history = getHistory();
        if (history) history.commitAction();

        updatePencilActionsVisibility();
      }
    };
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

    checkWin(puzzle);
    saveSession();
  }

  function updateCellVisual(row, col, puzzle) {
    const cellEl = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
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

  function checkWin(puzzle) {
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const expected = puzzle.solution[row][col];
        const cell = getCell(row, col);

        // Can't win with uncertain cells
        if (!cell.certain) return;

        if (cell.value === null) return;
        if (cell.value !== expected) return;
      }
    }

    // Puzzle completed!
    document.getElementById('status').textContent = 'Puzzle Complete!';
    document.getElementById('status').classList.add('won');

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

    // Record all non-blank cells for undo
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = getCell(row, col);
        if (cell.value !== null) {
          changes.push({
            row, col,
            before: { value: cell.value, certain: cell.certain },
            after: { value: null, certain: true }
          });
        }
      }
    }

    if (changes.length > 0 && history) {
      history.recordBatchAction('reset', changes);
    }

    // Clear storage and reload
    const storage = getStorage();
    if (storage) {
      const puzzleId = getPuzzleId(puzzle);
      storage.savePuzzleGrid(puzzleId, null);
    }

    // Reload without restoring grid
    loadPuzzle(currentPuzzle);
  }

  function showSolution() {
    const puzzle = getPuzzles()[currentPuzzle];
    if (!puzzle) return;

    // Clear history - showing solution is not undoable
    const history = getHistory();
    if (history) history.clear();

    // Convert solution to new format
    grid = puzzle.solution.map(row =>
      row.map(value => createCell(value, true))
    );

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        updateCellVisual(row, col, puzzle);
      }
    }

    document.getElementById('status').textContent = 'Solution revealed';
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

  // Legacy function - now uses ScreenManager
  function showCollection() {
    saveCurrentPuzzle();
    if (window.ScreenManager) {
      window.ScreenManager.showScreen(window.ScreenManager.SCREENS.COLLECTION);
    }
  }

  // Legacy function - now uses ScreenManager
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

    // Refresh collection to show updated completion status
    const collection = window.CozyCollection;
    if (collection) {
      collection.refresh();

      // Scroll to specific puzzle if requested (e.g., after victory)
      const data = event.detail || {};
      if (data.scrollToPuzzleId) {
        // Small delay to ensure DOM is updated after refresh
        setTimeout(() => {
          collection.scrollToPuzzle(data.scrollToPuzzleId);
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
      const name = match ? match[1].trim() : puzzle.title;
      titleEl.innerHTML = `<strong>${name}</strong>`;
    }
  }

  // === Initialization ===

  function init() {
    setupKeyboardShortcuts();

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
    clearAllState: clearAllState
  };

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
