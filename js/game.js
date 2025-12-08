// Cozy Garden - Nonogram Game Logic
// Uses window.PUZZLE_DATA loaded from data/puzzles.js
// Uses window.CozyStorage for progress persistence

(function() {
  'use strict';

  // Game state
  let currentPuzzle = 0;
  let currentDifficulty = 'easy';
  let selectedColor = 1;
  let grid = [];
  let isDragging = false;
  let dragColor = null;

  // Get puzzles from global (loaded via script tag)
  function getPuzzles() {
    return window.PUZZLE_DATA || [];
  }

  // Utility functions
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

  // Generate unique puzzle ID from title
  function getPuzzleId(puzzle) {
    return puzzle.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // Get storage instance (may not be available yet)
  function getStorage() {
    return window.CozyStorage || null;
  }

  // Save current session state (saves per-puzzle grid)
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

  // Clear session (called on puzzle completion)
  function clearSession() {
    const storage = getStorage();
    if (storage) storage.clearSession();
  }

  // Puzzle selection UI
  function initPuzzleSelect() {
    const puzzles = getPuzzles();
    const container = document.getElementById('puzzle-select');

    // Get unique difficulties
    const difficulties = [...new Set(puzzles.map(p => getDifficulty(p.title)))];
    const diffOrder = ['easy', 'medium', 'hard', 'challenging', 'expert'];
    difficulties.sort((a, b) => diffOrder.indexOf(a) - diffOrder.indexOf(b));

    // Create tabs
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

    // Create dropdown
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
    const storage = getStorage();
    select.innerHTML = '';

    puzzles.forEach((puzzle, idx) => {
      if (getDifficulty(puzzle.title) === currentDifficulty) {
        const opt = document.createElement('option');
        opt.value = idx;

        // Check if puzzle is completed
        const puzzleId = getPuzzleId(puzzle);
        const isCompleted = storage ? storage.isPuzzleCompleted(puzzleId) : false;
        opt.textContent = (isCompleted ? '\u2713 ' : '') + puzzle.title;

        if (idx === currentPuzzle) opt.selected = true;
        select.appendChild(opt);
      }
    });

    // If current puzzle is not in this difficulty, load first of this difficulty
    const filteredPuzzles = puzzles.filter(p => getDifficulty(p.title) === currentDifficulty);
    if (filteredPuzzles.length > 0) {
      const currentInDifficulty = getDifficulty(puzzles[currentPuzzle]?.title) === currentDifficulty;
      if (!currentInDifficulty) {
        const firstIdx = puzzles.findIndex(p => getDifficulty(p.title) === currentDifficulty);
        if (firstIdx >= 0) loadPuzzle(firstIdx);
      }
    }
  }

  // Core game functions
  function loadPuzzle(index, restoreGrid = null) {
    const puzzles = getPuzzles();
    const storage = getStorage();

    // Save current puzzle's grid before switching to a DIFFERENT puzzle
    if (index !== currentPuzzle && grid.length > 0 && puzzles[currentPuzzle] && storage) {
      const currentPuzzleId = getPuzzleId(puzzles[currentPuzzle]);
      storage.savePuzzleGrid(currentPuzzleId, grid);
    }

    currentPuzzle = index;
    const puzzle = puzzles[index];
    if (!puzzle) return;

    const puzzleId = getPuzzleId(puzzle);

    // Initialize or restore grid (check per-puzzle saved state)
    let savedGrid = restoreGrid;
    if (!savedGrid && storage) {
      savedGrid = storage.getPuzzleGrid(puzzleId);
    }

    const hasRestoredGrid = savedGrid && savedGrid.length === puzzle.height;
    if (hasRestoredGrid) {
      grid = savedGrid.map(row => [...row]);
    } else {
      grid = [];
      for (let row = 0; row < puzzle.height; row++) {
        grid.push(new Array(puzzle.width).fill(null));
      }
    }

    selectedColor = 1;
    buildPalette(puzzle);
    buildClues(puzzle);
    buildGrid(puzzle);

    // Update cell visuals if grid was restored
    if (hasRestoredGrid) {
      for (let row = 0; row < puzzle.height; row++) {
        for (let col = 0; col < puzzle.width; col++) {
          if (grid[row][col] !== null) {
            updateCell(row, col, puzzle);
          }
        }
      }
    }

    document.getElementById('status').textContent = 'Select colors and fill the grid';
    document.getElementById('status').classList.remove('won');

    // Update dropdown selection
    const select = document.getElementById('puzzle-select-dropdown');
    if (select) select.value = index;

    // Update difficulty tab if needed
    const newDiff = getDifficulty(puzzle.title);
    if (newDiff !== currentDifficulty) {
      currentDifficulty = newDiff;
      document.querySelectorAll('.difficulty-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent.toLowerCase() === newDiff);
      });
      updateDropdown();
    }

    // Notify zoom module that puzzle changed (recalculates scale limits)
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

    puzzle.col_clues.forEach(clues => {
      const col = document.createElement('div');
      col.className = 'col-clue';

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

    puzzle.row_clues.forEach(clues => {
      const rowClues = document.createElement('div');
      rowClues.className = 'row-clues';

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

  function buildGrid(puzzle) {
    const gridEl = document.getElementById('grid');
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${puzzle.width}, var(--cell-size))`;

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = row;
        cell.dataset.col = col;

        cell.onmousedown = (e) => {
          e.preventDefault();
          isDragging = true;
          dragColor = selectedColor;
          fillCell(row, col);
        };

        cell.onmouseenter = () => {
          if (isDragging) {
            fillCell(row, col);
          }
        };

        cell.oncontextmenu = (e) => {
          e.preventDefault();
          isDragging = true;
          dragColor = 0;
          fillCell(row, col);
        };

        gridEl.appendChild(cell);
      }
    }

    document.onmouseup = () => {
      isDragging = false;
      dragColor = null;
    };
  }

  function fillCell(row, col) {
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    grid[row][col] = dragColor;
    updateCell(row, col, puzzle);
    checkWin(puzzle);

    // Save session progress (debounced via browser)
    saveSession();
  }

  function updateCell(row, col, puzzle) {
    const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    const value = grid[row][col];

    cell.classList.remove('marked-empty');
    cell.style.background = '';

    if (value === null) {
      cell.style.background = '#faf8f3';
    } else if (value === 0) {
      cell.classList.add('marked-empty');
    } else {
      cell.style.background = rgb(puzzle.color_map[value]);
    }
  }

  function checkWin(puzzle) {
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const expected = puzzle.solution[row][col];
        const actual = grid[row][col];

        if (actual === null) return;
        if (actual !== expected) return;
      }
    }

    // Puzzle completed!
    document.getElementById('status').textContent = 'Puzzle Complete!';
    document.getElementById('status').classList.add('won');

    // Record completion in storage
    const storage = getStorage();
    if (storage) {
      const puzzleId = getPuzzleId(puzzle);
      storage.completePuzzle(puzzleId);
      clearSession();

      // Update dropdown to show completion checkmark
      updateDropdown();
    }
  }

  function resetPuzzle() {
    // Clear saved grid for this puzzle before reloading
    const storage = getStorage();
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    if (storage && puzzle) {
      const puzzleId = getPuzzleId(puzzle);
      storage.savePuzzleGrid(puzzleId, null);
    }
    loadPuzzle(currentPuzzle);
  }

  function showSolution() {
    const puzzles = getPuzzles();
    const puzzle = puzzles[currentPuzzle];
    grid = puzzle.solution.map(row => [...row]);

    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        updateCell(row, col, puzzle);
      }
    }

    document.getElementById('status').textContent = 'Solution revealed';
  }

  // Initialize on DOM ready
  function init() {
    initPuzzleSelect();

    // Try to restore previous session
    const storage = getStorage();
    const session = storage ? storage.getSession() : null;

    if (session && session.puzzleIndex !== undefined) {
      // Restore previous session
      currentDifficulty = session.difficulty || 'easy';

      // Update tab selection
      document.querySelectorAll('.difficulty-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent.toLowerCase() === currentDifficulty);
      });

      updateDropdown();
      loadPuzzle(session.puzzleIndex, session.grid);
    } else {
      loadPuzzle(0);
    }
  }

  // Expose necessary functions globally
  window.CozyGarden = {
    resetPuzzle: resetPuzzle,
    showSolution: showSolution
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
