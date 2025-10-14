const path = require('path');
const { spawnSync } = require('child_process');

const { collectFiles } = require('./utils');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGETS = ['server.js', 'src', 'server', 'tests', 'scripts'];

function gatherSourceFiles() {
  return collectFiles(
    DEFAULT_TARGETS.map(target => path.join(ROOT, target)),
    { extensions: ['.js'] }
  );
}

function runTypecheck({ files = null, quiet = false } = {}) {
  const targets = files || gatherSourceFiles();
  let checked = 0;
  for (const file of targets) {
    const result = spawnSync(process.execPath, ['--check', file], {
      stdio: 'inherit'
    });
    checked += 1;
    if (result.status !== 0) {
      throw new Error(`Syntax check failed for ${path.relative(ROOT, file)}`);
    }
  }
  if (!quiet) {
    console.log(`Syntax OK for ${checked} JavaScript files.`);
  }
  return { files: targets, count: checked };
}

if (require.main === module) {
  try {
    runTypecheck();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { runTypecheck, gatherSourceFiles };
