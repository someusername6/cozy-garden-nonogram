// Cozy Garden - Collection Screen
// Displays puzzles grouped by difficulty level

(function() {
  'use strict';

  // Difficulty display order (derived from puzzles, but with preferred ordering)
  const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'challenging', 'expert'];

  // Storage key for collapsed state
  const COLLAPSED_KEY = 'cozy_garden_collapsed_sections';

  // Get collapsed sections from localStorage
  function getCollapsedSections() {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  }

  // Save collapsed sections to localStorage
  function saveCollapsedSections(collapsed) {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch (e) {
      // Ignore storage errors
    }
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

  // Parse puzzle metadata from title
  // Title format: "Name (WxH, difficulty)"
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
    // Fallback: use full title as name
    return {
      name: title,
      width: 0,
      height: 0,
      difficulty: 'unknown'
    };
  }

  // Get puzzle ID from puzzle object
  function getPuzzleId(puzzle) {
    return puzzle.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // Get storage instance
  function getStorage() {
    return window.CozyStorage || null;
  }

  // Group puzzles by difficulty
  function groupPuzzlesByDifficulty(puzzles) {
    const groups = {};

    puzzles.forEach((puzzle, index) => {
      const meta = parsePuzzleTitle(puzzle.title);
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
  function createPuzzleCard(item, onClick) {
    const storage = getStorage();
    const isCompleted = storage ? storage.isPuzzleCompleted(item.id) : false;
    const savedGrid = storage ? storage.getPuzzleGrid(item.id) : null;
    const hasPartialProgress = !isCompleted && hasProgress(savedGrid);

    const card = document.createElement('div');
    card.className = 'puzzle-card' + (isCompleted ? ' completed' : '') + (hasPartialProgress ? ' in-progress' : '');
    card.dataset.puzzleIndex = item.index;

    // Puzzle preview (mini grid or icon)
    const preview = document.createElement('div');
    preview.className = 'puzzle-card-preview';

    if (isCompleted) {
      // Show solved thumbnail
      preview.appendChild(createMiniSolution(item.puzzle));
    } else if (hasPartialProgress) {
      // Show partial progress
      preview.appendChild(createMiniProgress(item.puzzle, savedGrid));
    } else {
      // Show placeholder with size
      const placeholder = document.createElement('div');
      placeholder.className = 'puzzle-card-placeholder';
      placeholder.textContent = `${item.meta.width}x${item.meta.height}`;
      preview.appendChild(placeholder);
    }

    card.appendChild(preview);

    // Puzzle name
    const name = document.createElement('div');
    name.className = 'puzzle-card-name';
    name.textContent = item.meta.name;
    card.appendChild(name);

    // Color count badge
    const colors = Object.keys(item.puzzle.color_map).length;
    const badge = document.createElement('div');
    badge.className = 'puzzle-card-badge';
    badge.textContent = `${colors} colors`;
    card.appendChild(badge);

    // Click handler
    card.addEventListener('click', () => onClick(item.index));

    return card;
  }

  // Create mini solution preview (scaled down)
  function createMiniSolution(puzzle) {
    const canvas = document.createElement('canvas');
    const size = 80; // Preview size (larger for better quality, CSS scales down)
    const cellSize = Math.max(2, Math.floor(size / Math.max(puzzle.width, puzzle.height)));

    canvas.width = puzzle.width * cellSize;
    canvas.height = puzzle.height * cellSize;
    canvas.className = 'puzzle-mini-canvas';

    const ctx = canvas.getContext('2d');

    // Draw solution
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const value = puzzle.solution[row][col];
        if (value > 0) {
          const color = puzzle.color_map[value];
          ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return canvas;
  }

  // Create mini progress preview (partial grid state)
  function createMiniProgress(puzzle, savedGrid) {
    const canvas = document.createElement('canvas');
    const size = 80; // Preview size (larger for better quality, CSS scales down)
    const cellSize = Math.max(2, Math.floor(size / Math.max(puzzle.width, puzzle.height)));

    canvas.width = puzzle.width * cellSize;
    canvas.height = puzzle.height * cellSize;
    canvas.className = 'puzzle-mini-canvas';

    const ctx = canvas.getContext('2d');

    // Draw light grid background
    ctx.fillStyle = '#f0ede5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw saved progress
    for (let row = 0; row < puzzle.height; row++) {
      for (let col = 0; col < puzzle.width; col++) {
        const cell = savedGrid[row]?.[col];
        const value = (typeof cell === 'object' && cell !== null) ? cell.value : cell;

        if (value !== null && value > 0) {
          const color = puzzle.color_map[value];
          if (color) {
            ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      }
    }

    return canvas;
  }

  // Render the collection screen
  function renderCollection(container, puzzles, onPuzzleSelect) {
    container.innerHTML = '';

    const groups = groupPuzzlesByDifficulty(puzzles);
    const sortedDifficulties = getSortedDifficulties(groups);
    const storage = getStorage();

    // Get or calculate collapsed state
    let collapsed = getCollapsedSections();
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

    // Header with overall stats
    const header = document.createElement('div');
    header.className = 'collection-header';

    // Overall stats
    let totalCompleted = 0;
    if (storage) {
      puzzles.forEach((puzzle, index) => {
        if (storage.isPuzzleCompleted(getPuzzleId(puzzle))) {
          totalCompleted++;
        }
      });
    }

    const overallStats = document.createElement('div');
    overallStats.className = 'collection-stats';
    overallStats.textContent = `${totalCompleted} / ${puzzles.length} completed`;
    header.appendChild(overallStats);

    container.appendChild(header);

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
        const card = createPuzzleCard(item, onPuzzleSelect);
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
    }

    init(containerId, puzzles, onPuzzleSelect) {
      this.container = document.getElementById(containerId);
      this.puzzles = puzzles;
      this.onPuzzleSelect = onPuzzleSelect;

      if (this.container) {
        this.render();
      }

      return this;
    }

    render() {
      if (!this.container) return;
      renderCollection(this.container, this.puzzles, (index) => {
        if (this.onPuzzleSelect) {
          this.onPuzzleSelect(index);
        }
      });
    }

    show() {
      if (this.container) {
        this.container.style.display = 'block';
        this.visible = true;
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
    refresh() {
      if (this.visible) {
        this.render();
      }
    }
  }

  // Create singleton
  const collection = new CollectionManager();

  // Expose globally
  window.CozyCollection = collection;
})();
