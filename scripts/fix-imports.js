#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Recursively find all .js files in a directory
 */
function findJsFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findJsFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Calculate the relative path from a file to the src root
 */
function getRelativePathToRoot(filePath, distPath) {
  const relativePath = path.relative(path.dirname(filePath), distPath);
  return relativePath || '.';
}

/**
 * Replace tilde imports with relative imports in a file
 */
function fixTildeImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;
  
  const distPath = path.join(__dirname, '..', 'dist');
  const relativeToRoot = getRelativePathToRoot(filePath, distPath);
  
  // Replace require("~/...") with proper relative path
  content = content.replace(/require\(["']~\/([^"']+)["']\)/g, (match, importPath) => {
    modified = true;
    let newPath = path.join(relativeToRoot, importPath).replace(/\\/g, '/');
    // Ensure we always have ./ prefix if path doesn't start with ../
    if (!newPath.startsWith('../') && !newPath.startsWith('./')) {
      newPath = './' + newPath;
    }
    return `require("${newPath}")`;
  });
  
  // Replace from "~/..." with proper relative path
  content = content.replace(/from\s+["']~\/([^"']+)["']/g, (match, importPath) => {
    modified = true;
    let newPath = path.join(relativeToRoot, importPath).replace(/\\/g, '/');
    // Ensure we always have ./ prefix if path doesn't start with ../
    if (!newPath.startsWith('../') && !newPath.startsWith('./')) {
      newPath = './' + newPath;
    }
    return `from "${newPath}"`;
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed imports in: ${path.relative(process.cwd(), filePath)}`);
  }
}

// Main execution
const distPath = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(distPath)) {
  console.error('Error: dist directory not found. Run tsc first.');
  process.exit(1);
}

console.log('Fixing tilde imports in compiled files...');
const jsFiles = findJsFiles(distPath);

if (jsFiles.length === 0) {
  console.error('No .js files found in dist directory.');
  process.exit(1);
}

for (const file of jsFiles) {
  fixTildeImports(file);
}

console.log(`Processed ${jsFiles.length} files.`);