// Cozy Garden - PWA Application Module
// Handles PWA lifecycle, install prompt, and offline status

(function() {
  'use strict';

  const App = {
    // State
    deferredPrompt: null,
    isOnline: navigator.onLine,
    isInstalled: false,
    swRegistration: null,
    resizeTimeout: null,

    // Initialize the app
    init() {
      this.checkInstallState();
      this.registerServiceWorker();
      this.setupEventListeners();
      this.setupOnlineStatus();
      this.setupInstallPrompt();

      console.log('[App] Cozy Garden initialized');
    },

    // Check if app is installed
    checkInstallState() {
      // Check display-mode
      if (window.matchMedia('(display-mode: standalone)').matches) {
        this.isInstalled = true;
      }
      // iOS Safari
      if (window.navigator.standalone === true) {
        this.isInstalled = true;
      }

      if (this.isInstalled) {
        document.body.classList.add('is-installed');
        console.log('[App] Running as installed PWA');
      }
    },

    // Register service worker
    async registerServiceWorker() {
      if (!('serviceWorker' in navigator)) {
        console.log('[App] Service workers not supported');
        return;
      }

      try {
        this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });

        console.log('[App] Service worker registered:', this.swRegistration.scope);

        // Check for updates
        this.swRegistration.addEventListener('updatefound', () => {
          const newWorker = this.swRegistration.installing;
          console.log('[App] New service worker installing...');

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              this.showUpdateNotification();
            }
          });
        });

      } catch (error) {
        console.error('[App] Service worker registration failed:', error);
      }
    },

    // Show update notification
    showUpdateNotification() {
      // Create a simple update banner (using DOM methods for CSP compliance)
      const banner = document.createElement('div');
      banner.className = 'update-banner';

      const span = document.createElement('span');
      span.textContent = 'A new version is available!';

      const updateBtn = document.createElement('button');
      updateBtn.textContent = 'Update';
      updateBtn.addEventListener('click', () => this.applyUpdate());

      const laterBtn = document.createElement('button');
      laterBtn.textContent = 'Later';
      laterBtn.addEventListener('click', () => banner.remove());

      banner.appendChild(span);
      banner.appendChild(updateBtn);
      banner.appendChild(laterBtn);
      document.body.appendChild(banner);
    },

    // Apply update
    applyUpdate() {
      if (this.swRegistration && this.swRegistration.waiting) {
        this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    },

    // Setup event listeners
    setupEventListeners() {
      // Handle app visibility changes
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.onAppFocus();
        } else {
          this.onAppBlur();
        }
      });

      // Handle page unload - save state
      window.addEventListener('beforeunload', () => {
        this.saveState();
      });

      // Handle orientation changes
      window.addEventListener('orientationchange', () => {
        setTimeout(() => this.handleResize(), 100);
      });

      // Handle resize (debounced to avoid excessive calls)
      window.addEventListener('resize', () => {
        if (this.resizeTimeout) {
          clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => this.handleResize(), 100);
      });
    },

    // Setup online/offline status
    setupOnlineStatus() {
      const updateOnlineStatus = () => {
        this.isOnline = navigator.onLine;
        document.body.classList.toggle('is-offline', !this.isOnline);

        if (!this.isOnline) {
          this.showOfflineIndicator();
        } else {
          this.hideOfflineIndicator();
        }
      };

      window.addEventListener('online', updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);

      // Initial check
      updateOnlineStatus();
    },

    showOfflineIndicator() {
      let indicator = document.getElementById('offline-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'offline-indicator';
        indicator.className = 'offline-indicator';
        indicator.textContent = 'Playing offline';
        document.body.appendChild(indicator);
      }
      indicator.classList.add('visible');
    },

    hideOfflineIndicator() {
      const indicator = document.getElementById('offline-indicator');
      if (indicator) {
        indicator.classList.remove('visible');
      }
    },

    // Check if install prompt was recently dismissed
    wasInstallPromptDismissed() {
      try {
        const dismissed = localStorage.getItem('cozy_install_dismissed');
        if (!dismissed) return false;
        const dismissedTime = parseInt(dismissed, 10);
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        // Show again after 7 days
        return (Date.now() - dismissedTime) < sevenDays;
      } catch {
        return false;
      }
    },

    // Mark install prompt as dismissed
    markInstallPromptDismissed() {
      try {
        localStorage.setItem('cozy_install_dismissed', Date.now().toString());
      } catch {
        // Ignore storage errors
      }
    },

    // Setup install prompt
    setupInstallPrompt() {
      // Capture the install prompt event
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredPrompt = e;
        // Only show if not recently dismissed
        if (!this.wasInstallPromptDismissed()) {
          this.showInstallButton();
        }
        console.log('[App] Install prompt captured');
      });

      // Handle successful installation
      window.addEventListener('appinstalled', () => {
        this.isInstalled = true;
        this.deferredPrompt = null;
        this.hideInstallButton();
        document.body.classList.add('is-installed');
        console.log('[App] PWA installed successfully');
      });
    },

    // Show install button
    showInstallButton() {
      let btn = document.getElementById('install-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'install-btn';
        btn.className = 'install-btn';
        const span = document.createElement('span');
        span.textContent = 'Install App';
        btn.appendChild(span);
        btn.addEventListener('click', () => this.promptInstall());

        // Add to controls section if exists
        const controls = document.querySelector('.controls');
        if (controls) {
          controls.appendChild(btn);
        }
      }
      btn.style.display = 'inline-flex';
    },

    hideInstallButton() {
      const btn = document.getElementById('install-btn');
      if (btn) {
        btn.style.display = 'none';
      }
    },

    // Trigger install prompt
    async promptInstall() {
      if (!this.deferredPrompt) {
        console.log('[App] No install prompt available');
        return;
      }

      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;

      console.log('[App] Install prompt outcome:', outcome);

      if (outcome === 'accepted') {
        this.deferredPrompt = null;
      } else {
        // User dismissed - track to avoid prompting again too soon
        this.markInstallPromptDismissed();
        this.hideInstallButton();
      }
    },

    // App focus handler
    onAppFocus() {
      console.log('[App] App focused');
      // Could trigger data refresh here
    },

    // App blur handler
    onAppBlur() {
      console.log('[App] App blurred');
      this.saveState();
    },

    // Save current state
    saveState() {
      if (window.CozyGarden && window.CozyStorage) {
        // Game module will handle actual state saving
        console.log('[App] Saving state...');
      }
    },

    // Handle resize
    handleResize() {
      // Trigger any responsive adjustments
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    },

    // Check if running as PWA
    isPWA() {
      return this.isInstalled ||
             window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    },

    // Get app version from service worker
    async getVersion() {
      if (!this.swRegistration || !navigator.serviceWorker.controller) {
        return 'unknown';
      }

      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          resolve(event.data.version || 'unknown');
        };
        navigator.serviceWorker.controller.postMessage(
          { type: 'GET_VERSION' },
          [channel.port2]
        );

        // Timeout fallback
        setTimeout(() => resolve('unknown'), 1000);
      });
    },

    // Share functionality (Web Share API)
    async share(title, text, url) {
      if (navigator.share) {
        try {
          await navigator.share({ title, text, url });
          return true;
        } catch (e) {
          if (e.name !== 'AbortError') {
            console.error('[App] Share failed:', e);
          }
          return false;
        }
      }
      return false;
    },

    // Vibrate (if supported)
    vibrate(pattern = 50) {
      if (navigator.vibrate && window.CozyStorage?.getSetting('vibrationEnabled')) {
        navigator.vibrate(pattern);
      }
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }

  // Expose globally
  window.CozyApp = App;
})();
