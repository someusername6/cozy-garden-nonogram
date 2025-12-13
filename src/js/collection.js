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
    const newCollapsed = !isCollapsed;
    collapsed[difficulty] = newCollapsed;
    saveCollapsedSections(collapsed);

    // Update UI
    section.classList.toggle('collapsed', newCollapsed);
    const grid = section.querySelector('.collection-grid');
    const chevron = section.querySelector('.section-chevron');
    const header = section.querySelector('.collection-section-header');

    if (grid) {
      grid.style.display = newCollapsed ? 'none' : 'flex';
    }
    if (chevron) {
      chevron.textContent = newCollapsed ? '\u25B6' : '\u25BC';
    }

    // Update accessibility attributes
    if (header) {
      header.setAttribute('aria-expanded', !newCollapsed);
      // Update aria-label to reflect new state
      const stats = header.querySelector('.collection-section-stats');
      const statsText = stats ? stats.textContent : '';
      const [completed, total] = statsText.split('/');
      header.setAttribute('aria-label',
        `${formatDifficulty(difficulty)}, ${completed} of ${total} completed, ${newCollapsed ? 'collapsed' : 'expanded'}`);
    }

    // Update roving tabindex after section visibility changes
    if (window.Cozy.Collection) {
      window.Cozy.Collection.updateRovingTabindex();
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
      // Arrow key navigation - delegate to collection manager (unified with headers)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (window.Cozy.Collection) {
          window.Cozy.Collection.navigateFromElement(card, e.key);
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
      const section = renderDifficultySection(
        difficulty,
        groups[difficulty],
        collapsed,
        onPuzzleSelect,
        options
      );
      container.appendChild(section);
    });
  }

  /**
   * Render a single difficulty section with header and puzzle grid.
   * @param {string} difficulty - Difficulty level name
   * @param {Array} puzzleItems - Array of {puzzle, originalIndex, id} for this difficulty
   * @param {Object} collapsed - Map of difficulty -> collapsed state
   * @param {Function} onPuzzleSelect - Callback when puzzle is selected
   * @param {Object} options - Render options (e.g., blankPuzzleId)
   * @returns {HTMLElement} The section element
   */
  function renderDifficultySection(difficulty, puzzleItems, collapsed, onPuzzleSelect, options) {
    const stats = getGroupStats(puzzleItems);
    const isCollapsed = collapsed[difficulty];

    const section = document.createElement('div');
    section.className = 'collection-section' + (isCollapsed ? ' collapsed' : '');
    section.dataset.difficulty = difficulty;

    // Grid ID for aria-controls
    const gridId = `collection-grid-${difficulty}`;

    // Section header (clickable and keyboard accessible)
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'collection-section-header';
    sectionHeader.style.cursor = 'pointer';
    sectionHeader.dataset.difficulty = difficulty;

    // Accessibility: make headers part of unified keyboard navigation
    sectionHeader.tabIndex = -1;  // Part of roving tabindex group
    sectionHeader.setAttribute('role', 'button');
    sectionHeader.setAttribute('aria-expanded', !isCollapsed);
    sectionHeader.setAttribute('aria-controls', gridId);
    sectionHeader.setAttribute('aria-label',
      `${formatDifficulty(difficulty)}, ${stats.completed} of ${stats.total} completed, ${isCollapsed ? 'collapsed' : 'expanded'}`);

    // Chevron indicator
    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
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

    // Keyboard handler for accessibility (Enter/Space to toggle, arrows to navigate)
    sectionHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSection(difficulty, collapsed);
        return;
      }
      // Arrow key navigation - delegate to collection manager
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (window.Cozy.Collection) {
          window.Cozy.Collection.navigateFromElement(sectionHeader, e.key);
        }
      }
    });

    section.appendChild(sectionHeader);

    // Puzzle grid
    const grid = document.createElement('div');
    grid.className = 'collection-grid';
    grid.id = gridId;
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
    return section;
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
      // Track focused element for roving tabindex (either card or header)
      this.focusedCardId = null;
      this.focusedHeaderDifficulty = null;
      // Track ideal X position for consistent column navigation during up/down
      // This persists across vertical navigation, updated only on left/right
      this.idealX = null;
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

    // Get all navigable elements (section headers + visible cards) in DOM order
    getNavigableElements() {
      if (!this.container) return [];
      const elements = [];
      const sections = this.container.querySelectorAll('.collection-section');
      sections.forEach(section => {
        // Add section header (always navigable)
        const header = section.querySelector('.collection-section-header');
        if (header) {
          elements.push(header);
        }
        // Add cards only if section is expanded
        const grid = section.querySelector('.collection-grid');
        if (grid && grid.style.display !== 'none') {
          const sectionCards = grid.querySelectorAll('.puzzle-card');
          sectionCards.forEach(card => elements.push(card));
        }
      });
      return elements;
    }

    // Check if element is a section header
    isHeader(element) {
      return element && element.classList.contains('collection-section-header');
    }

    // Find element in specified direction based on visual position
    // Works with both headers and cards
    // direction: 'up', 'down', 'left', 'right'
    // targetX: optional X position to use for up/down navigation (for column consistency)
    findElementInDirection(currentElement, direction, targetX = null) {
      const elements = this.getNavigableElements();
      if (elements.length === 0) return null;

      const currentRect = currentElement.getBoundingClientRect();
      const currentCenterX = currentRect.left + currentRect.width / 2;
      const currentCenterY = currentRect.top + currentRect.height / 2;
      const isCurrentHeader = this.isHeader(currentElement);

      // For up/down, use targetX if provided (for column consistency)
      // For left/right, always use current element's X
      const searchX = (direction === 'up' || direction === 'down') && targetX !== null
        ? targetX
        : currentCenterX;

      // Tolerance for "same row/column" comparison
      const rowTolerance = currentRect.height * 0.5;
      const colTolerance = currentRect.width * 0.5;

      let bestCandidate = null;
      let bestDistance = Infinity;

      elements.forEach(element => {
        if (element === currentElement) return;

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const isTargetHeader = this.isHeader(element);

        let isValid = false;

        switch (direction) {
          case 'left':
            // Must be to the left and roughly same row
            // Headers span full width, so left/right from header goes nowhere
            if (isCurrentHeader) {
              isValid = false;
            } else {
              isValid = !isTargetHeader &&
                        centerX < currentCenterX - colTolerance &&
                        Math.abs(centerY - currentCenterY) < rowTolerance;
            }
            break;
          case 'right':
            // Must be to the right and roughly same row
            if (isCurrentHeader) {
              isValid = false;
            } else {
              isValid = !isTargetHeader &&
                        centerX > currentCenterX + colTolerance &&
                        Math.abs(centerY - currentCenterY) < rowTolerance;
            }
            break;
          case 'up':
            // Must be above (allow any column, prefer closest to searchX)
            isValid = centerY < currentCenterY - rowTolerance;
            break;
          case 'down':
            // Must be below (allow any column, prefer closest to searchX)
            isValid = centerY > currentCenterY + rowTolerance;
            break;
        }

        if (isValid) {
          // Calculate distance
          let distance;
          if (direction === 'left' || direction === 'right') {
            distance = Math.abs(centerX - currentCenterX);
          } else {
            // For up/down, prioritize closest Y first, then prefer closest to searchX
            const yDist = Math.abs(centerY - currentCenterY);
            const xDist = Math.abs(centerX - searchX);
            distance = yDist * 1000 + xDist; // Heavily weight Y distance
          }

          if (distance < bestDistance) {
            bestDistance = distance;
            bestCandidate = element;
          }
        }
      });

      return bestCandidate;
    }

    // Unified navigation from any element (header or card)
    navigateFromElement(element, key) {
      const directionMap = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right'
      };
      const direction = directionMap[key];
      if (!direction) return;

      const currentRect = element.getBoundingClientRect();
      const currentCenterX = currentRect.left + currentRect.width / 2;

      // For up/down navigation, use idealX for column consistency
      // For left/right, use current position
      let targetElement;
      if (direction === 'up' || direction === 'down') {
        // Initialize idealX from current position if not set
        if (this.idealX === null) {
          this.idealX = currentCenterX;
        }
        targetElement = this.findElementInDirection(element, direction, this.idealX);
      } else {
        targetElement = this.findElementInDirection(element, direction);
      }

      if (targetElement) {
        const targetRect = targetElement.getBoundingClientRect();
        const targetCenterX = targetRect.left + targetRect.width / 2;

        // Update idealX based on movement type
        if (direction === 'left' || direction === 'right') {
          // Horizontal movement: update idealX to new position
          this.idealX = targetCenterX;
        } else if (!this.isHeader(targetElement)) {
          // Vertical movement landing on a card: keep idealX unchanged
          // This maintains column consistency through headers and varying row lengths
          // (idealX is only updated on explicit left/right movement)
        }
        // Note: landing on a header doesn't change idealX either

        // Update tabindex for roving pattern
        element.tabIndex = -1;
        targetElement.tabIndex = 0;
        targetElement.focus();

        // Track focused element
        if (this.isHeader(targetElement)) {
          this.focusedCardId = null;
          this.focusedHeaderDifficulty = targetElement.dataset.difficulty;
        } else {
          this.focusedCardId = targetElement.dataset.puzzleId;
          this.focusedHeaderDifficulty = null;
        }

        // Scroll into view if needed
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // Legacy method - delegates to unified navigation
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
    // Includes both section headers and visible cards in navigation
    updateRovingTabindex() {
      const elements = this.getNavigableElements();
      if (elements.length === 0) return;

      // Find the previously focused element (could be card or header)
      let focusedElement = null;

      // Try to find by card ID first
      if (this.focusedCardId) {
        const candidate = this.container.querySelector(
          `.puzzle-card[data-puzzle-id="${this.focusedCardId}"]`
        );
        // Only use if it's actually visible (not in collapsed section)
        if (candidate && elements.includes(candidate)) {
          focusedElement = candidate;
        }
      }

      // Try to find by header difficulty
      if (!focusedElement && this.focusedHeaderDifficulty) {
        const candidate = this.container.querySelector(
          `.collection-section-header[data-difficulty="${this.focusedHeaderDifficulty}"]`
        );
        if (candidate && elements.includes(candidate)) {
          focusedElement = candidate;
        }
      }

      // If previously focused element not found, use first element (first header)
      if (!focusedElement) {
        focusedElement = elements[0];
        // Update tracking based on element type
        if (this.isHeader(focusedElement)) {
          this.focusedHeaderDifficulty = focusedElement.dataset.difficulty;
          this.focusedCardId = null;
        } else {
          this.focusedCardId = focusedElement?.dataset.puzzleId || null;
          this.focusedHeaderDifficulty = null;
        }
      }

      // Set all elements to tabindex=-1 except the focused one
      elements.forEach(element => {
        element.tabIndex = (element === focusedElement) ? 0 : -1;
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
