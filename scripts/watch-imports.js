#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const distPath = path.join(__dirname, '..', 'dist');
const fixImportsPath = path.join(__dirname, 'fix-imports.js');

// Simple file watcher using fs.watch
console.log('Watching for new/changed JS files in dist directory...');

// Keep track of processed files to avoid duplicate processing
const processedFiles = new Set();
const pendingFiles = new Set();
let debounceTimer = null;

function runFixImports() {
  if (pendingFiles.size === 0) return;
  
  console.log(`Running fix-imports for ${pendingFiles.size} files...`);
  pendingFiles.clear();
  
  exec(`node ${fixImportsPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error running fix-imports:', error);
      return;
    }
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
}

function watchFile(filePath) {
  if (!filePath.endsWith('.js')) return;
  
  // Add to pending files and debounce execution
  pendingFiles.add(filePath);
  
  // Clear existing timer
  if (debounceTimer) clearTimeout(debounceTimer);
  
  // Set new timer to run fix-imports after 500ms of no activity
  debounceTimer = setTimeout(runFixImports, 500);
}

// Watch the dist directory
if (fs.existsSync(distPath)) {
  // Initial run to fix any existing files
  console.log('Running initial import fix...');
  exec(`node ${fixImportsPath}`, (error, stdout) => {
    if (stdout) console.log(stdout);
    console.log('Initial import fix complete. Now watching for changes...');
  });
  
  // Set up recursive watcher
  fs.watch(distPath, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.js')) {
      const fullPath = path.join(distPath, filename);
      watchFile(fullPath);
    }
  });
} else {
  console.log('Waiting for dist directory to be created...');
  
  // Watch parent directory for dist creation
  const parentPath = path.join(__dirname, '..');
  fs.watch(parentPath, (eventType, filename) => {
    if (filename === 'dist' && fs.existsSync(distPath)) {
      console.log('dist directory created, starting watch...');
      // Restart the script to properly watch the new directory
      process.exit(0);
    }
  });
}

// Keep the process running
process.on('SIGINT', () => {
  console.log('\nStopping import watcher...');
  process.exit(0);
});