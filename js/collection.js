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

  // Get puzzle title, handling both concise (t) and verbose (title) formats
  function getPuzzleTitle(puzzle) {
    return puzzle.t || puzzle.title;
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
    const title = getPuzzleTitle(puzzle);
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // Get storage instance
  function getStorage() {
    return window.CozyStorage || null;
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
    // Accessibility: make cards keyboard accessible
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${item.meta.name}, ${item.meta.width} by ${item.meta.height}${isCompleted ? ', completed' : ''}`);

    // Keyboard handler for accessibility
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(item.index);
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
  // options.blankPuzzleId: puzzle ID to render with blank placeholder (for stamp animation)
  // options.searchFilter: string to filter puzzles by name prefix
  function renderCollection(container, puzzles, onPuzzleSelect, options = {}) {
    container.innerHTML = '';

    // Filter puzzles by search term if provided, preserving original indices
    const searchFilter = (options.searchFilter || '').toLowerCase().trim();

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
    }

    init(containerId, puzzles, onPuzzleSelect) {
      this.container = document.getElementById(containerId);
      this.puzzles = puzzles;
      this.onPuzzleSelect = onPuzzleSelect;

      // Set up search input
      this.searchInput = document.getElementById('collection-search-input');
      if (this.searchInput) {
        this.searchInput.addEventListener('input', (e) => {
          this.searchFilter = e.target.value;
          this.render();
        });
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

        // Calculate scale factor to fit within target (preserving aspect ratio)
        const currentWidth = parseFloat(flyingStamp.style.width);
        const currentHeight = parseFloat(flyingStamp.style.height);
        const stampAspect = currentWidth / currentHeight;

        let targetWidth, targetHeight;
        if (stampAspect > 1) {
          targetWidth = targetRect.width;
          targetHeight = targetRect.width / stampAspect;
        } else {
          targetHeight = targetRect.height;
          targetWidth = targetRect.height * stampAspect;
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
  window.CozyCollection = collection;
})();
