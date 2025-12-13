/**
 * Screen Manager for Cozy Garden
 * Handles navigation between screens with transitions
 */
const ScreenManager = (function() {
  'use strict';

  // === Shared Utilities ===
  const { CONFIG, initOnce, createFlyingStamp, renderOutlinedCanvas } = window.Cozy.Utils;

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

    // Cache all screen elements and set initial inert state
    Object.values(SCREENS).forEach(screenId => {
      const screen = document.getElementById(`screen-${screenId}`);
      screenElements[screenId] = screen;
      // All screens start as inert; showScreen will remove inert from active screen
      if (screen) {
        screen.setAttribute('inert', '');
      }
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
        if (window.Cozy.Storage) {
          window.Cozy.Storage.setFlag('tutorialComplete', true);
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
      if (currentScreen === SCREENS.PUZZLE && window.Cozy.Zoom) {
        window.Cozy.Zoom.destroy();
      }

      screenElements[currentScreen].classList.remove('screen-active');
      screenElements[currentScreen].classList.add('screen-hidden');
      // Make hidden screen inert (removes from tab order and accessibility tree)
      screenElements[currentScreen].setAttribute('inert', '');
    }

    // Show target screen
    targetScreen.classList.remove('screen-hidden');
    targetScreen.classList.add('screen-active');
    // Remove inert from active screen
    targetScreen.removeAttribute('inert');

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
        const storage = window.Cozy.Storage;
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
      const hasPlayedBefore = window.Cozy.Storage?.getFlag('tutorialCompleted');

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

    initOnce(playBtn, 'click', () => showScreen(SCREENS.COLLECTION));
    initOnce(settingsBtn, 'click', () => showScreen(SCREENS.SETTINGS));

    // Update progress display using CozyStorage
    if (progressEl && window.PUZZLE_DATA) {
      const puzzles = window.PUZZLE_DATA;
      const totalPuzzles = Array.isArray(puzzles) ? puzzles.length : 0;
      let solvedCount = 0;

      if (window.Cozy.Storage && window.Cozy.Garden?.getPuzzleId) {
        puzzles.forEach(puzzle => {
          const puzzleId = window.Cozy.Garden.getPuzzleId(puzzle);
          if (window.Cozy.Storage.isPuzzleCompleted(puzzleId)) {
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
    if (window.Cozy.Zoom) {
      window.Cozy.Zoom.init();
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
    initOnce(continueBtn, 'click', () => {
      // Get the victory canvas for the flying animation
      const victoryCanvas = imageEl ? imageEl.querySelector('canvas') : null;

      if (victoryCanvas) {
        const containerRect = imageEl.getBoundingClientRect();
        const flyingStamp = createFlyingStamp(victoryCanvas, containerRect, { useScale: true });

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

    const canvas = renderOutlinedCanvas(
      width,
      height,
      CONFIG.VICTORY_CANVAS_SIZE,
      (row, col) => {
        const colorIndex = solution[row][col];
        if (colorIndex > 0 && palette[colorIndex]) {
          // Apply colorblind transform for display
          return window.Cozy.Utils.getDisplayColor(palette[colorIndex]);
        }
        return null;
      }
    );

    container.appendChild(canvas);
  }

  // ============================================
  // Settings Screen Helper Functions
  // ============================================

  /**
   * Initialize the theme selector UI.
   * Marks the current theme as active and sets up click handlers.
   */
  function initThemeSelector() {
    const themeOptions = document.querySelectorAll('.theme-option');

    // Get current theme, defaulting to system preference if not set
    let currentTheme = window.Cozy.Storage?.getSetting('theme');
    if (!currentTheme || currentTheme === 'system') {
      currentTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // Mark current theme as active
    themeOptions.forEach(option => {
      const theme = option.dataset.theme;
      const isActive = theme === currentTheme;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // Add click handlers
    themeOptions.forEach(option => {
      initOnce(option, 'click', () => {
        const theme = option.dataset.theme;

        // Update active state and aria-pressed
        themeOptions.forEach(opt => {
          opt.classList.remove('active');
          opt.setAttribute('aria-pressed', 'false');
        });
        option.classList.add('active');
        option.setAttribute('aria-pressed', 'true');

        // Save and apply theme
        if (window.Cozy.Storage) {
          window.Cozy.Storage.setSetting('theme', theme);
        }
        applyTheme(theme);
      });
    });
  }

  /**
   * Initialize the reset progress button with confirmation modal.
   */
  function initResetProgressButton() {
    const resetBtn = document.getElementById('settings-reset-btn');

    initOnce(resetBtn, 'click', () => {
      showConfirmModal({
        title: 'Reset Progress',
        message: 'Are you sure you want to reset all progress? This cannot be undone.',
        confirmText: 'Reset',
        cancelText: 'Cancel',
        danger: true,
        onConfirm: () => {
          // Clear game state (in-memory grid, etc.)
          if (window.Cozy.Garden?.clearAllState) {
            window.Cozy.Garden.clearAllState();
          }

          // Use CozyStorage reset (clears all progress, flags, and UI state)
          if (window.Cozy.Storage?.reset) {
            window.Cozy.Storage.reset();
          }

          // Refresh collection if visible
          if (window.Cozy.Collection) {
            window.Cozy.Collection.refresh();
          }

          showAlertModal({
            title: 'Progress Reset',
            message: 'All progress has been cleared.'
          });
        }
      });
    });
  }

  /**
   * Initialize the debug "Solve All" button with confirmation modal.
   */
  function initDebugSolveAll() {
    const solveAllBtn = document.getElementById('settings-solve-all-btn');

    initOnce(solveAllBtn, 'click', () => {
      showConfirmModal({
        title: 'Debug: Solve All',
        message: 'Mark all puzzles as solved? This is a debug feature.',
        confirmText: 'Solve All',
        cancelText: 'Cancel',
        onConfirm: () => {
          const puzzles = window.PUZZLE_DATA || [];
          const storage = window.Cozy.Storage;

          if (storage) {
            puzzles.forEach(puzzle => {
              // Use shared utility from CozyGarden if available for consistency
              let puzzleId;
              if (window.Cozy.Garden?.getPuzzleId) {
                puzzleId = window.Cozy.Garden.getPuzzleId(puzzle);
              } else {
                // Fallback - handle both concise (t) and verbose (title) formats
                const title = puzzle.t || puzzle.title;
                puzzleId = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
              }
              storage.completePuzzle(puzzleId);
            });
          }

          // Refresh collection if visible
          if (window.Cozy.Collection) {
            window.Cozy.Collection.refresh();
          }

          showAlertModal({
            title: 'All Puzzles Solved',
            message: `Marked ${puzzles.length} puzzles as solved!`
          });
        }
      });
    });
  }

  /**
   * Settings Screen - Main initialization
   */
  function initSettingsScreen() {
    const backBtn = document.getElementById('settings-back-btn');
    const vibrationToggle = document.getElementById('settings-vibration');
    const colorblindSelect = document.getElementById('settings-colorblind');
    const tutorialBtn = document.getElementById('settings-tutorial-btn');

    // Load current settings
    const storage = window.Cozy.Storage;
    if (vibrationToggle) vibrationToggle.checked = storage?.getSetting('vibration') ?? true;
    if (colorblindSelect) colorblindSelect.value = storage?.getSetting('colorblindMode') || 'off';

    // Navigation
    initOnce(backBtn, 'click', goBack);
    initOnce(tutorialBtn, 'click', () => showScreen(SCREENS.TUTORIAL));

    // Setting toggles
    initOnce(vibrationToggle, 'change', () => storage?.setSetting('vibration', vibrationToggle.checked));
    initOnce(colorblindSelect, 'change', () => {
      storage?.setSetting('colorblindMode', colorblindSelect.value);
      // Refresh collection to update puzzle preview colors
      if (window.Cozy.Collection) {
        window.Cozy.Collection.refresh();
      }
    });

    // Feature-specific initialization
    initThemeSelector();
    initResetProgressButton();
    initDebugSolveAll();

    // Focus management
    if (vibrationToggle) {
      setTimeout(() => vibrationToggle.focus(), 100);
    }
  }

  /**
   * Tutorial Screen
   */
  // Tutorial state (module-level so it persists across re-initializations)
  let tutorialCurrentStep = 0;

  function initTutorialScreen() {
    const skipBtn = document.getElementById('tutorial-skip-btn');
    const nextBtn = document.getElementById('tutorial-next-btn');
    const steps = document.querySelectorAll('.tutorial-step');
    const dots = document.querySelectorAll('.tutorial-dot');

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
      window.Cozy.Storage?.setFlag('tutorialCompleted', true);
      showScreen(SCREENS.HOME);
    }

    initOnce(skipBtn, 'click', completeTutorial);

    initOnce(nextBtn, 'click', () => {
      if (tutorialCurrentStep < steps.length - 1) {
        tutorialCurrentStep++;
        showStep(tutorialCurrentStep);
      } else {
        completeTutorial();
      }
    });

    // Reset to first step when entering
    tutorialCurrentStep = 0;
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
   * @param {string} theme - 'light' or 'dark'
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Update theme-color meta tag for browser/PWA chrome
    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', theme === 'dark' ? '#0a1018' : '#4a7c3f');
    }
  }

  /**
   * Initialize theme from saved preference or system default
   */
  function initTheme() {
    let savedTheme = window.Cozy.Storage?.getSetting('theme');
    // Default to system preference if no saved theme (or legacy 'system' value)
    if (!savedTheme || savedTheme === 'system') {
      savedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(savedTheme);
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
    showConfirmModal,
    SCREENS
  };
})();

// Expose globally
window.Cozy.Screens = ScreenManager;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ScreenManager.init();
});
