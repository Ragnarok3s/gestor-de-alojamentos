const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'coverage',
  '.nyc_output',
  '.cache',
  'uploads',
  'dist'
]);

function collectFiles(entries, { extensions = ['.js'], ignore = DEFAULT_IGNORE } = {}) {
  const rootEntries = Array.isArray(entries) ? entries : [entries];
  const targets = [];
  const allowedExt = extensions ? new Set(extensions) : null;

  for (const entry of rootEntries) {
    if (!entry) continue;
    const startPath = path.resolve(entry);
    walk(startPath, targets, { allowedExt, ignore });
  }

  return targets;
}

function walk(currentPath, targets, { allowedExt, ignore }) {
  let stat;
  try {
    stat = fs.statSync(currentPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }

  if (stat.isDirectory()) {
    const baseName = path.basename(currentPath);
    if (ignore && ignore.has(baseName)) {
      return;
    }
    const entries = fs.readdirSync(currentPath);
    for (const entry of entries) {
      const child = path.join(currentPath, entry);
      walk(child, targets, { allowedExt, ignore });
    }
    return;
  }

  if (allowedExt && !allowedExt.has(path.extname(currentPath))) {
    return;
  }

  targets.push(currentPath);
}

module.exports = {
  collectFiles
};
