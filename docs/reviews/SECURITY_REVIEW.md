# Security Review: Cozy Garden Nonogram PWA

**Review Date:** 2025-12-13
**Reviewer:** Security Analysis
**Scope:** Client-side PWA with no backend
**Version:** 1.0.0

---

## Executive Summary

Cozy Garden demonstrates **strong security fundamentals** for a client-side puzzle game. The application has a Content Security Policy in place, proper input validation on critical paths, and no backend attack surface. However, there are several **low to medium severity concerns** related to XSS prevention, localStorage handling, and service worker security that should be addressed to meet production security standards.

**Overall Security Rating:** B+ (Good with room for improvement)

---

## Security Strengths

### 1. Content Security Policy (CSP)
**Location:** `/Users/telmo/project/nonogram/src/index.html:9`

The application implements a CSP, though with necessary exceptions:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline';
               style-src 'self' 'unsafe-inline'; img-src 'self' data:;
               font-src 'self'; connect-src 'self'; manifest-src 'self'">
```

**Strengths:**
- Restricts resources to same-origin by default
- No external script sources allowed
- Limited `connect-src` prevents data exfiltration
- `img-src` properly allows `data:` URIs for canvas rendering

**Note:** The `'unsafe-inline'` for scripts is required for the theme detection inline script (lines 17-37) which prevents FOUC (Flash of Unstyled Content). This is an acceptable tradeoff.

### 2. Input Validation and Sanitization

**Puzzle Data Validation** (`/Users/telmo/project/nonogram/src/js/game.js:242-310`)
```javascript
function normalizePuzzle(p) {
  // Validates dimensions against MAX_PUZZLE_DIMENSION (32)
  if (p.w > CONFIG.MAX_PUZZLE_DIMENSION || p.h > CONFIG.MAX_PUZZLE_DIMENSION ||
      p.w < 1 || p.h < 1) {
    console.warn('[Game] Puzzle dimensions out of range:', p.w, 'x', p.h);
    return null;
  }
  // Validates required fields and types
  if (!Array.isArray(p.r) || !Array.isArray(p.c) ||
      !Array.isArray(p.p) || !Array.isArray(p.s)) {
    return null;
  }
}
```

**Search Input Length Limiting** (`/Users/telmo/project/nonogram/src/js/collection.js:327`)
```javascript
const searchFilter = (options.searchFilter || '')
  .toLowerCase()
  .trim()
  .slice(0, CONFIG.MAX_SEARCH_LENGTH);  // Capped at 100 characters
```

This prevents ReDoS (Regular Expression Denial of Service) and excessive memory usage.

### 3. No Direct HTML Injection Points

The application avoids dangerous patterns:
- No use of `eval()` or `Function()` constructors
- No `document.write()` calls
- No `outerHTML` assignments with user data
- URL parameters are sanitized before use

### 4. Service Worker Security

**Scope Restriction** (`/Users/telmo/project/nonogram/src/js/app.js:47-48`)
```javascript
this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
  scope: '/'
});
```

The service worker is properly scoped and only caches same-origin resources.

### 5. localStorage Structure Validation

**Location:** `/Users/telmo/project/nonogram/src/js/storage.js:11-20`

```javascript
function isValidStorageData(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (data.progress !== null && typeof data.progress !== 'object') return false;
  // ... additional validation
  return true;
}
```

Prevents type confusion attacks when parsing localStorage data.

---

## Security Concerns

### MEDIUM Severity Issues

#### 1. Unsafe innerHTML Usage with Untrusted Content

**Risk:** DOM-based XSS if puzzle data is tampered with or sourced externally
**CVSS Score:** 5.4 (Medium)

**Locations:**

1. **Help Modal Content** (`/Users/telmo/project/nonogram/src/js/game.js:135`)
```javascript
helpList.innerHTML = items.join('');
```

While `items` is currently hardcoded, this pattern is dangerous if help content ever becomes dynamic or user-controlled.

**Recommendation:** Use `textContent` or DOM methods:
```javascript
items.forEach(itemHtml => {
  const li = document.createElement('li');
  li.innerHTML = itemHtml;  // Per-item is safer than bulk assignment
  helpList.appendChild(li);
});
```

2. **Clue Tooltip Rendering** (`/Users/telmo/project/nonogram/src/js/zoom.js:324-329`)
```javascript
tooltipRowClues.innerHTML = renderClues(clueInfo.rowClues);
tooltipColClues.innerHTML = renderClues(clueInfo.colClues);
```

The `renderClues()` function builds HTML with color values from puzzle data:
```javascript
function renderClues(clues) {
  return clues.map(clue => {
    const color = window.Cozy.Garden?.getColorRgb?.(clue.color) || [128, 128, 128];
    // ...
    return `<span ... style="background: rgb(${color.join(',')});">
              ${clue.count}
            </span>`;
  }).join('');
}
```

**Risk:** If `clue.count` or color values are tampered with, XSS is possible.

**Recommendation:** Sanitize numeric values:
```javascript
const safeCount = parseInt(clue.count, 10) || 0;
const safeColor = color.map(c => Math.max(0, Math.min(255, parseInt(c, 10) || 0)));
```

3. **Pencil Mode Icon Updates** (`/Users/telmo/project/nonogram/src/js/game.js:486-489`)
```javascript
if (isPencilMode) {
  svg.innerHTML = '<path d="M19.07 13.88L13..."/>';
} else {
  svg.innerHTML = '<path d="M20.71 7.04c.39..."/>';
}
```

**Risk:** Low (hardcoded SVG paths), but violates defense-in-depth principle.

**Recommendation:** Use `setAttribute()` for the `d` attribute instead.

4. **Collection Screen Rendering** (`/Users/telmo/project/nonogram/src/js/collection.js:223-235`)
```javascript
placeholder.innerHTML = QUESTION_MARK_SVG;
```

**Risk:** Low (QUESTION_MARK_SVG is a hardcoded constant), but same principle applies.

5. **Victory Screen Rendering** (`/Users/telmo/project/nonogram/src/js/screens.js:551`)
```javascript
container.innerHTML = '';
```

**Risk:** Very low (just clearing content), but creates pattern for potential misuse.

#### 2. localStorage Tampering and Data Injection

**Risk:** Malicious localStorage data could cause unexpected behavior
**CVSS Score:** 4.3 (Medium)

**Attack Scenario:**
An attacker with access to devtools or a browser extension could:
1. Inject malicious data into `localStorage.cozy_garden_data`
2. Craft oversized arrays to cause DoS
3. Inject script-bearing strings that might be reflected in error messages

**Current Mitigations:**
- `isValidStorageData()` validates structure (good)
- Type checking on critical fields (good)

**Gaps:**
- No size limits on arrays (progress, flags, etc.)
- No validation on string field contents
- Grid data stored as complex nested objects without depth limits

**Locations:**
- `/Users/telmo/project/nonogram/src/js/storage.js:67-89` (init method)
- `/Users/telmo/project/nonogram/src/js/storage.js:328-341` (importData method)
- `/Users/telmo/project/nonogram/src/index.html:20-23` (theme detection script)

**Recommendation:**
Add additional validation:
```javascript
function isValidStorageData(data) {
  // ... existing checks ...

  // Limit progress object size (DoS prevention)
  if (data.progress && Object.keys(data.progress).length > 1000) {
    console.warn('[Storage] Progress object too large');
    return false;
  }

  // Validate string fields don't contain script tags
  if (data.settings?.theme && /<script/i.test(data.settings.theme)) {
    return false;
  }

  return true;
}
```

#### 3. Service Worker Cache Poisoning Risk

**Risk:** Service worker caches could be poisoned if deployed on HTTP
**CVSS Score:** 5.9 (Medium, only if deployed insecurely)

**Location:** `/Users/telmo/project/nonogram/src/sw.js:43-61`

**Current Behavior:**
The service worker caches all static files on install, including JavaScript bundles.

**Risk Scenario:**
If the application is deployed over HTTP (not HTTPS), a MITM attacker could:
1. Inject malicious code into cached JavaScript files
2. Persist the attack through the service worker cache
3. Survive page reloads

**Recommendation:**
1. **Critical:** Ensure production deployment is HTTPS-only
2. Add Subresource Integrity (SRI) checks for critical files:
```javascript
// In build.js, generate SRI hashes
const crypto = require('crypto');
const jsContent = fs.readFileSync('dist/js/app.min.js');
const hash = crypto.createHash('sha384').update(jsContent).digest('base64');
console.log(`Integrity hash: sha384-${hash}`);
```

3. Update manifest.json to require HTTPS:
```json
{
  "start_url": "/?utm_source=pwa",
  "prefer_related_applications": false,
  "background_color": "#faf8f0"
}
```

#### 4. Prototype Pollution via JSON.parse

**Risk:** Malicious localStorage data could pollute Object.prototype
**CVSS Score:** 4.0 (Medium-Low)

**Locations:**
- `/Users/telmo/project/nonogram/src/js/storage.js:69` (storage init)
- `/Users/telmo/project/nonogram/src/js/storage.js:330` (importData)
- `/Users/telmo/project/nonogram/src/index.html:23` (theme detection)

**Attack Vector:**
```javascript
localStorage.setItem('cozy_garden_data',
  '{"__proto__": {"polluted": true}, "version": 1, ...}');
```

**Current Mitigations:**
- Modern browsers (Chrome 88+, Firefox 85+) have built-in prototype pollution protection in `JSON.parse()`

**Recommendation:**
Add explicit protection for older browser support:
```javascript
function safeParse(jsonString) {
  const parsed = JSON.parse(jsonString);
  // Remove dangerous properties
  delete parsed.__proto__;
  delete parsed.constructor;
  delete parsed.prototype;
  return parsed;
}
```

### LOW Severity Issues

#### 5. Missing HTTPS Enforcement in PWA Manifest

**Risk:** PWA could be installed over HTTP in some scenarios
**CVSS Score:** 3.1 (Low)

**Location:** `/Users/telmo/project/nonogram/src/manifest.json`

The manifest doesn't explicitly require HTTPS. While service workers require HTTPS (except localhost), add defense-in-depth.

**Recommendation:**
Add to manifest.json documentation or build process that enforces HTTPS check.

#### 6. No Rate Limiting on Storage Operations

**Risk:** Malicious script could spam localStorage.setItem() causing quota errors
**CVSS Score:** 2.3 (Low)

**Location:** `/Users/telmo/project/nonogram/src/js/storage.js:92-101`

**Recommendation:**
Implement debouncing for save operations (already partially implemented with onChange listeners, but could be more robust):
```javascript
let saveTimeout = null;
save() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.notifyListeners('save');
      return true;
    } catch (e) {
      console.error('[Storage] Failed to save:', e);
      return false;
    }
  }, 100);  // Debounce 100ms
}
```

#### 7. Theme Detection Script in HTML Head

**Risk:** Inline script violates strict CSP
**CVSS Score:** 2.0 (Low - necessary for UX)

**Location:** `/Users/telmo/project/nonogram/src/index.html:17-37`

**Analysis:**
This inline script is necessary to prevent FOUC and reads from localStorage directly. The code is safe because:
1. Only reads localStorage (no user input)
2. Uses `setAttribute()` not `innerHTML`
3. Has try-catch for error handling

**Current State:** Acceptable tradeoff, but document the rationale.

**Recommendation:**
Add comment explaining CSP exception:
```html
<!-- Theme detection inline script required to prevent FOUC.
     CSP 'unsafe-inline' exception is safe here because:
     1. No user input processed
     2. Only reads trusted localStorage
     3. Uses setAttribute() not innerHTML -->
```

#### 8. Missing Input Validation on URL Parameters

**Risk:** Crafted URL parameters could cause unexpected navigation
**CVSS Score:** 2.7 (Low)

**Location:** `/Users/telmo/project/nonogram/src/js/screens.js:401-419`

```javascript
const urlParams = new URLSearchParams(window.location.search);
const action = urlParams.get('action');

if (action === 'continue') {
  // ... loads session
}
```

**Current State:** Safe because `action` is only checked against string literal 'continue'

**Recommendation:**
Add explicit whitelist validation:
```javascript
const VALID_ACTIONS = ['continue'];
const action = urlParams.get('action');

if (action && VALID_ACTIONS.includes(action)) {
  // ... process action
}
```

#### 9. No CSP for Service Worker

**Risk:** Service worker has no CSP restrictions
**CVSS Score:** 2.1 (Low)

**Location:** `/Users/telmo/project/nonogram/src/sw.js`

Service workers run in their own global scope and don't inherit page CSP.

**Recommendation:**
Add CSP headers to service worker via build process or server configuration:
```javascript
// In sw.js
self.addEventListener('install', (event) => {
  // Validate all cached resources are from same origin
  const allSameOrigin = STATIC_FILES.every(file =>
    file.startsWith('/') || file.startsWith(self.location.origin)
  );
  if (!allSameOrigin) {
    throw new Error('[SW] External resources not allowed');
  }
  // ... existing install logic
});
```

---

## Recommendations by Priority

### High Priority (Fix Before Production)

1. **Sanitize innerHTML assignments** - Especially in tooltip rendering and any dynamic content
2. **Add SRI hashes** - For critical JavaScript and CSS files
3. **Enforce HTTPS** - Document deployment requirements, add checks in build process
4. **Strengthen localStorage validation** - Add size limits and content validation

### Medium Priority (Fix Soon)

5. **Add prototype pollution protection** - Wrapper around JSON.parse()
6. **Rate limit storage operations** - Debounce save() method
7. **Whitelist URL parameters** - Explicit validation on `action` parameter
8. **Service worker origin validation** - Ensure all cached resources are same-origin

### Low Priority (Nice to Have)

9. **Document CSP exceptions** - Add comments explaining 'unsafe-inline' necessity
10. **Add CSP to service worker** - Via build process or runtime checks
11. **Implement CSP reporting** - Add `report-uri` to CSP for monitoring violations

---

## Attack Surface Analysis

### Client-Side Only
**Risk:** LOW
Since there's no backend, the attack surface is limited to:
- Client-side code execution (XSS)
- localStorage tampering
- Service worker manipulation

All of these require either:
1. User installing malicious browser extension
2. Physical device access
3. MITM on HTTP (mitigated by HTTPS requirement)

### No External Data Sources
**Risk:** LOW
The application doesn't fetch external data beyond:
- Same-origin static assets (safe)
- Service worker cache (controlled by app)

### No Sensitive Data Stored
**Risk:** LOW
The application only stores:
- Puzzle progress (non-sensitive)
- UI preferences (non-sensitive)
- No PII, credentials, or payment info

---

## PWA-Specific Security Considerations

### 1. Manifest Security
**Status:** ✅ GOOD

The manifest.json properly configures:
- Scope limited to `/`
- No external icon sources
- No external related applications
- Proper orientation lock

### 2. Service Worker Security
**Status:** ⚠️ NEEDS IMPROVEMENT

**Strengths:**
- Cache versioning prevents stale content (`CACHE_NAME = 'cozy-garden-v23'`)
- Proper cleanup of old caches
- Network-first for HTML (gets updates)
- Cache-first for static assets (performance)

**Concerns:**
- No integrity checks on cached resources
- No validation of cache contents
- Could cache malicious content if deployed over HTTP

### 3. Offline Security
**Status:** ✅ GOOD

Offline functionality doesn't introduce additional risks:
- All game logic is client-side
- No sensitive API calls to protect
- Progress stored locally only

---

## Dependency Analysis

### NPM Dependencies (package.json)

**Dev Dependencies:**
- `esbuild@^0.24.0` - Build tool (no runtime risk)
- `sharp@^0.34.5` - Image processing (dev only, no runtime risk)

**Analysis:**
- No runtime dependencies (excellent for security)
- No third-party JavaScript loaded at runtime
- No CDN dependencies
- No analytics or tracking scripts

**Recommendation:**
Regularly audit dev dependencies for vulnerabilities:
```bash
npm audit
```

---

## Recommended Security Headers

For production deployment, configure server to send these headers:

```
# Existing CSP (already in HTML)
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'

# Additional recommended headers
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()

# HTTPS enforcement
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

# Service worker security
Service-Worker-Allowed: /
```

---

## Testing Recommendations

### Security Test Cases

1. **XSS Testing**
   - Inject `<script>alert('XSS')</script>` in localStorage puzzle data
   - Test with malformed puzzle titles containing HTML entities
   - Verify search input sanitization with `<img src=x onerror=alert(1)>`

2. **localStorage Tampering**
   - Inject oversized arrays (10000+ items) in progress object
   - Test with `__proto__` pollution attempts
   - Verify graceful degradation on QuotaExceededError

3. **Service Worker Security**
   - Verify cache integrity after network interruption
   - Test cache poisoning resistance
   - Verify proper cache invalidation on version change

4. **CSP Validation**
   - Use browser dev tools to verify no CSP violations
   - Test with inline event handlers (should be blocked)
   - Verify external scripts are blocked

---

## Secure Coding Guidelines

For future development, follow these practices:

### ✅ DO
- Use `textContent` instead of `innerHTML` for user-generated content
- Validate all data from localStorage before use
- Use parameterized queries (not applicable for this app, but good practice)
- Sanitize numeric inputs with `parseInt()` / `parseFloat()`
- Use strict equality (`===`) for comparisons
- Implement proper error handling with try-catch
- Use `const` and `let` instead of `var` (already done)

### ❌ DON'T
- Use `eval()`, `Function()`, or `setTimeout(string)`
- Trust data from localStorage without validation
- Use `innerHTML` with concatenated strings
- Store sensitive data in localStorage (not applicable here)
- Deploy over HTTP in production
- Use `document.write()`

---

## Conclusion

Cozy Garden demonstrates **solid security practices** for a client-side PWA game. The application has no critical vulnerabilities but would benefit from addressing the medium-severity issues related to innerHTML usage and localStorage validation before production deployment.

The lack of a backend significantly reduces the attack surface, and the use of a Content Security Policy provides strong defense-in-depth. With the recommended improvements, this application would achieve a security rating of **A- (Excellent)**.

### Security Checklist for Production

- [ ] Sanitize all `innerHTML` assignments
- [ ] Add Subresource Integrity (SRI) hashes
- [ ] Deploy exclusively over HTTPS
- [ ] Add prototype pollution protection
- [ ] Implement storage size limits
- [ ] Configure security headers on server
- [ ] Add service worker origin validation
- [ ] Document CSP exceptions
- [ ] Run security audit tools (npm audit, OWASP ZAP)
- [ ] Perform penetration testing on deployed version

---

**Review Completed:** 2025-12-13
**Next Review Due:** After implementing recommended fixes or before major release
