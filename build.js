/**
 * build.js — bundles CodeMirror 6 into a single IIFE file.
 *
 * Run automatically via `npm install` (prepare script) or manually with
 * `node build.js`. Output: public/cm.bundle.js
 *
 * Using esbuild instead of CDN imports because CodeMirror 6 is split across
 * dozens of packages that share @codemirror/state and @codemirror/view.
 * Loading them separately from a CDN causes "multiple instances" errors
 * because each URL gets its own module instance, breaking instanceof checks.
 * Bundling everything together into one file guarantees a single instance.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Ensure public/ exists (it should, but just in case)
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'));
}

const outfile = path.join(__dirname, 'public', 'cm.bundle.js');

esbuild.build({
  entryPoints: [path.join(__dirname, 'src', 'editor.js')],
  bundle: true,
  outfile,
  format: 'iife',        // wraps output in an IIFE, assigns to window.CM
  globalName: 'CM',      // access via window.CM in room.html
  minify: true,          // always minify — reduces ~1.2 MB bundle to ~400 KB
  sourcemap: false,
  target: ['es2020'],
  logLevel: 'info',
}).then(() => {
  const size = (fs.statSync(outfile).size / 1024).toFixed(1);
  console.log(`✓  Built public/cm.bundle.js (${size} KB)`);
}).catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
