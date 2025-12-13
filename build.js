#!/usr/bin/env node

/**
 * Cozy Garden - Production Build Script
 *
 * Creates a minified production build in dist/
 *
 * Usage:
 *   npm run build     - Build production bundle
 *   npm run preview   - Build and serve locally
 *   npm run clean     - Remove dist/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Will be loaded dynamically
let esbuild;

// === Configuration ===

const DIST_DIR = 'dist';

// JS files in dependency order (utils must be first, creates window.Cozy)
const JS_FILES = [
  'js/utils.js',
  'js/storage.js',
  'js/history.js',
  'js/screens.js',
  'js/collection.js',
  'js/app.js',
  'js/game.js',
  'js/zoom.js'
];

// Files to copy as-is
const COPY_FILES = [
  'manifest.json',
  'data/puzzles.js'
];

// Directories to copy
const COPY_DIRS = [
  'assets/icons'
];

// === Helper Functions ===

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function formatSize(bytes) {
  return (bytes / 1024).toFixed(1) + 'KB';
}

function getFileSize(filepath) {
  try {
    return fs.statSync(filepath).size;
  } catch {
    return 0;
  }
}

function contentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

// === Build Steps ===

async function clean() {
  console.log('Cleaning dist/...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  ensureDir(DIST_DIR);
  ensureDir(path.join(DIST_DIR, 'js'));
  ensureDir(path.join(DIST_DIR, 'css'));
  ensureDir(path.join(DIST_DIR, 'data'));
}

async function buildJS() {
  console.log('\nProcessing JavaScript...');

  // Read and concatenate with file markers
  const parts = JS_FILES.map(file => {
    const content = fs.readFileSync(file, 'utf8');
    return `// ============================================================\n// FILE: ${file}\n// ============================================================\n\n${content}`;
  });
  const concatenated = parts.join('\n\n');

  // Calculate sizes
  const sizeBefore = JS_FILES.reduce((sum, f) => sum + getFileSize(f), 0);

  // Write concatenated source (readable, for source map reference)
  const srcFile = path.join(DIST_DIR, 'js/app.src.js');
  fs.writeFileSync(srcFile, concatenated);

  // Minify with source map
  const result = await esbuild.transform(concatenated, {
    minify: true,
    sourcemap: 'external',
    sourcefile: 'app.src.js',
    loader: 'js',
    target: 'es2018'
  });

  // Write minified file with source map reference
  const minFile = path.join(DIST_DIR, 'js/app.min.js');
  fs.writeFileSync(minFile, result.code + '\n//# sourceMappingURL=app.min.js.map');

  // Write source map
  const mapFile = path.join(DIST_DIR, 'js/app.min.js.map');
  fs.writeFileSync(mapFile, result.map);

  const sizeAfter = getFileSize(minFile);
  const reduction = ((1 - sizeAfter / sizeBefore) * 100).toFixed(0);

  console.log(`  Source files: ${JS_FILES.length} files, ${formatSize(sizeBefore)}`);
  console.log(`  Minified:     ${formatSize(sizeAfter)} (${reduction}% reduction)`);
  console.log(`  Source map:   ${formatSize(getFileSize(mapFile))}`);

  return concatenated; // Return for hash calculation
}

async function buildCSS() {
  console.log('\nProcessing CSS...');

  const srcFile = 'css/style.css';
  const sizeBefore = getFileSize(srcFile);

  // Minify with source map
  await esbuild.build({
    entryPoints: [srcFile],
    outfile: path.join(DIST_DIR, 'css/style.min.css'),
    minify: true,
    sourcemap: true,
    target: 'es2018'
  });

  const sizeAfter = getFileSize(path.join(DIST_DIR, 'css/style.min.css'));
  const reduction = ((1 - sizeAfter / sizeBefore) * 100).toFixed(0);

  console.log(`  Source:     ${formatSize(sizeBefore)}`);
  console.log(`  Minified:   ${formatSize(sizeAfter)} (${reduction}% reduction)`);
  console.log(`  Source map: ${formatSize(getFileSize(path.join(DIST_DIR, 'css/style.min.css.map')))}`);

  return fs.readFileSync(srcFile, 'utf8'); // Return for hash calculation
}

async function buildServiceWorker(jsContent, cssContent) {
  console.log('\nGenerating service worker...');

  // Calculate content hash from source files
  const hash = contentHash(jsContent + cssContent);

  // Read original service worker
  let sw = fs.readFileSync('sw.js', 'utf8');

  // Update cache version names
  sw = sw.replace(
    /CACHE_NAME = 'cozy-garden-v\d+'/,
    `CACHE_NAME = 'cozy-garden-v${hash}'`
  );
  sw = sw.replace(
    /STATIC_CACHE = 'cozy-garden-static-v\d+'/,
    `STATIC_CACHE = 'cozy-garden-static-v${hash}'`
  );

  // Update STATIC_FILES array for production paths
  const prodStaticFiles = `STATIC_FILES = [
  '/',
  '/index.html',
  '/css/style.min.css',
  '/js/app.min.js',
  '/js/app.src.js',
  '/data/puzzles.js',
  '/manifest.json',
  // Icons
  '/assets/icons/icon-16.png',
  '/assets/icons/icon-32.png',
  '/assets/icons/icon-72.png',
  '/assets/icons/icon-96.png',
  '/assets/icons/icon-128.png',
  '/assets/icons/icon-144.png',
  '/assets/icons/icon-152.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-384.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/maskable-512.png',
  '/assets/icons/flower-uniform-petals.svg',
  '/assets/icons/magnifying-glass.svg',
  '/assets/icons/wooden-painters-palette.svg',
  '/assets/icons/celebration.svg'
]`;

  sw = sw.replace(
    /STATIC_FILES = \[[\s\S]*?\];/,
    prodStaticFiles + ';'
  );

  fs.writeFileSync(path.join(DIST_DIR, 'sw.js'), sw);
  console.log(`  Cache version: v${hash}`);
}

async function buildHTML() {
  console.log('\nTransforming index.html...');

  let html = fs.readFileSync('index.html', 'utf8');

  // Replace CSS preload hint
  html = html.replace(
    /<link rel="preload" href="css\/style\.css" as="style">/,
    '<link rel="preload" href="css/style.min.css" as="style">'
  );

  // Replace JS preload hints (multiple individual files -> single bundle)
  // Remove all individual JS preloads and add single preload for bundle
  const jsPreloadPattern = /<link rel="preload" href="js\/storage\.js" as="script">[\s\S]*?<link rel="preload" href="js\/game\.js" as="script">/;
  html = html.replace(
    jsPreloadPattern,
    '<link rel="preload" href="js/app.min.js" as="script">'
  );

  // Replace CSS link
  html = html.replace(
    /<link rel="stylesheet" href="css\/style\.css">/,
    '<link rel="stylesheet" href="css/style.min.css">'
  );

  // Replace 8 JS script tags with single minified bundle
  // Match the pattern of script tags (may have newlines/whitespace between)
  const jsScriptPattern = /<script defer src="js\/utils\.js"><\/script>[\s\S]*?<script defer src="js\/zoom\.js"><\/script>/;

  html = html.replace(
    jsScriptPattern,
    '<script defer src="js/app.min.js"></script>'
  );

  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html);
  console.log('  Replaced 8 script tags with 1 bundled script');
  console.log('  Updated CSS and JS preload hints for minified versions');
}

async function copyAssets() {
  console.log('\nCopying assets...');

  // Copy individual files
  for (const file of COPY_FILES) {
    const destDir = path.join(DIST_DIR, path.dirname(file));
    ensureDir(destDir);
    fs.copyFileSync(file, path.join(DIST_DIR, file));
    console.log(`  ${file}`);
  }

  // Copy directories
  for (const dir of COPY_DIRS) {
    copyDir(dir, path.join(DIST_DIR, dir));
    const count = fs.readdirSync(dir).length;
    console.log(`  ${dir}/ (${count} files)`);
  }
}

function reportSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('BUILD COMPLETE');
  console.log('='.repeat(60));

  // Calculate total sizes
  let totalSize = 0;
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        totalSize += getFileSize(fullPath);
      }
    }
  };
  walk(DIST_DIR);

  console.log(`\nOutput directory: ${DIST_DIR}/`);
  console.log(`Total size: ${formatSize(totalSize)}`);

  // Key files
  console.log('\nKey files:');
  const keyFiles = [
    'index.html',
    'css/style.min.css',
    'js/app.min.js',
    'js/app.src.js',
    'data/puzzles.js',
    'sw.js'
  ];
  for (const file of keyFiles) {
    const size = getFileSize(path.join(DIST_DIR, file));
    console.log(`  ${file.padEnd(25)} ${formatSize(size).padStart(10)}`);
  }

  console.log('\nTo test locally:');
  console.log('  npm run preview');
  console.log('  Open http://localhost:3000');
}

// === Main ===

async function build() {
  console.log('Cozy Garden - Production Build\n');

  // Load esbuild (may need npm install first)
  try {
    esbuild = require('esbuild');
  } catch (err) {
    console.error('Error: esbuild not found. Run "npm install" first.');
    process.exit(1);
  }

  const startTime = Date.now();

  try {
    await clean();
    const jsContent = await buildJS();
    const cssContent = await buildCSS();
    await buildServiceWorker(jsContent, cssContent);
    await buildHTML();
    await copyAssets();
    reportSummary();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nBuild completed in ${elapsed}s`);

  } catch (err) {
    console.error('\nBuild failed:', err);
    process.exit(1);
  }
}

build();
