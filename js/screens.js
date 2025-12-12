/**
 * Screen Manager for Cozy Garden
 * Handles navigation between screens with transitions
 */
const ScreenManager = (function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG } = window.CozyUtils;

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
        if (window.CozyStorage) {
          window.CozyStorage.setFlag('tutorialComplete', true);
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
      if (currentScreen === SCREENS.PUZZLE && window.CozyZoom) {
        window.CozyZoom.destroy();
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
        const storage = window.CozyStorage;
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
      const hasPlayedBefore = window.CozyStorage?.getFlag('tutorialCompleted');

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

      if (window.CozyStorage && window.CozyGarden?.getPuzzleId) {
        puzzles.forEach(puzzle => {
          const puzzleId = window.CozyGarden.getPuzzleId(puzzle);
          if (window.CozyStorage.isPuzzleCompleted(puzzleId)) {
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
    if (window.CozyZoom) {
      window.CozyZoom.init();
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
    const maxDim = Math.max(width, height);
    // Fit within container with padding for rounded corners
    const targetSize = CONFIG.VICTORY_CANVAS_SIZE;
    const cellSize = Math.max(2, Math.floor(targetSize / maxDim));

    const canvas = document.createElement('canvas');
    canvas.width = width * cellSize;
    canvas.height = height * cellSize;
    const ctx = canvas.getContext('2d');

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const colorIndex = solution[row][col];
        if (colorIndex > 0 && palette[colorIndex]) {
          const color = palette[colorIndex];
          ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

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
    const storage = window.CozyStorage;
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
            if (window.CozyGarden && window.CozyGarden.clearAllState) {
              window.CozyGarden.clearAllState();
            }

            // Use CozyStorage reset (clears all progress, flags, and UI state)
            if (window.CozyStorage && window.CozyStorage.reset) {
              window.CozyStorage.reset();
            }

            // Refresh collection if visible
            if (window.CozyCollection) {
              window.CozyCollection.refresh();
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
    const currentTheme = window.CozyStorage?.getSetting('theme') || 'system';

    // Mark current theme as active
    themeOptions.forEach(option => {
      const theme = option.dataset.theme;
      option.classList.toggle('active', theme === currentTheme);
    });

    // Add click handlers
    themeOptions.forEach(option => {
      if (!option.hasAttribute('data-initialized')) {
        option.addEventListener('click', () => {
          const theme = option.dataset.theme;

          // Update active state
          themeOptions.forEach(opt => opt.classList.remove('active'));
          option.classList.add('active');

          // Save and apply theme
          if (window.CozyStorage) {
            window.CozyStorage.setSetting('theme', theme);
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
            const storage = window.CozyStorage;

            if (storage) {
              puzzles.forEach(puzzle => {
                // Use shared utility from CozyGarden if available for consistency
                let puzzleId;
                if (window.CozyGarden?.getPuzzleId) {
                  puzzleId = window.CozyGarden.getPuzzleId(puzzle);
                } else {
                  // Fallback - handle both concise (t) and verbose (title) formats
                  const title = puzzle.t || puzzle.title;
                  puzzleId = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
                }
                storage.completePuzzle(puzzleId);
              });
            }

            // Refresh collection if visible
            if (window.CozyCollection) {
              window.CozyCollection.refresh();
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
  function initTutorialScreen() {
    const skipBtn = document.getElementById('tutorial-skip-btn');
    const nextBtn = document.getElementById('tutorial-next-btn');
    const steps = document.querySelectorAll('.tutorial-step');
    const dots = document.querySelectorAll('.tutorial-dot');
    let currentStep = 0;

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
      window.CozyStorage?.setFlag('tutorialCompleted', true);
      showScreen(SCREENS.HOME);
    }

    if (skipBtn && !skipBtn.hasAttribute('data-initialized')) {
      skipBtn.addEventListener('click', completeTutorial);
      skipBtn.setAttribute('data-initialized', 'true');
    }

    if (nextBtn && !nextBtn.hasAttribute('data-initialized')) {
      nextBtn.addEventListener('click', () => {
        if (currentStep < steps.length - 1) {
          currentStep++;
          showStep(currentStep);
        } else {
          completeTutorial();
        }
      });
      nextBtn.setAttribute('data-initialized', 'true');
    }

    // Reset to first step when entering
    currentStep = 0;
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
   * @param {string} theme - 'light', 'dark', or 'system'
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Update theme-color meta tag for browser/PWA chrome
    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) {
      const isDark = theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      themeColorMeta.setAttribute('content', isDark ? '#0f0d0c' : '#5c6b4a');
    }
  }

  /**
   * Initialize theme from saved preference or system default
   */
  function initTheme() {
    const savedTheme = window.CozyStorage?.getSetting('theme') || 'system';
    applyTheme(savedTheme);

    // Listen for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const currentTheme = window.CozyStorage?.getSetting('theme') || 'system';
      if (currentTheme === 'system') {
        applyTheme('system'); // Re-apply to update meta tag
      }
    });
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
    SCREENS
  };
})();

// Expose globally
window.ScreenManager = ScreenManager;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ScreenManager.init();
});
