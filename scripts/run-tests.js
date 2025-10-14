const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_DIR = path.join(ROOT, 'coverage');
const RAW_DIR = path.join(COVERAGE_DIR, 'tmp');
const TEST_ENTRY = path.join(ROOT, 'tests', 'run-tests.js');
const COVERAGE_TARGETS = ['server.js', 'src/', 'server/'];

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function runNodeTests() {
  const result = spawnSync(
    process.execPath,
    [TEST_ENTRY],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_V8_COVERAGE: RAW_DIR,
        DATABASE_PATH: process.env.DATABASE_PATH || ':memory:'
      }
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Tests failed with exit code ${result.status}`);
  }
}

function loadCoverageEntries() {
  const files = fs.readdirSync(RAW_DIR).filter(name => name.endsWith('.json'));
  const entries = [];
  for (const file of files) {
    const fullPath = path.join(RAW_DIR, file);
    const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    if (Array.isArray(payload.result)) {
      entries.push(...payload.result);
    }
  }
  return entries;
}

function computeLineOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  offsets.push(source.length);
  return offsets;
}

function offsetToLine(offset, lineOffsets) {
  let low = 0;
  let high = lineOffsets.length - 2; // last entry is sentinel
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineOffsets[mid];
    const end = lineOffsets[mid + 1];
    if (offset < start) {
      high = mid - 1;
    } else if (offset >= end) {
      low = mid + 1;
    } else {
      return mid + 1; // convert to 1-indexed line number
    }
  }
  return lineOffsets.length - 1;
}

function addRangeToRecord(record, range) {
  const { startOffset, endOffset, count } = range;
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number') {
    return;
  }
  const effectiveEnd = Math.max(startOffset, endOffset - 1);
  const startLine = offsetToLine(startOffset, record.lineOffsets);
  const endLine = offsetToLine(effectiveEnd, record.lineOffsets);
  for (let line = startLine; line <= endLine; line += 1) {
    const current = record.lineHits.get(line) || 0;
    if (count > current) {
      record.lineHits.set(line, count);
    }
  }
}

function buildCoverageMap(entries) {
  const coverage = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string') {
      continue;
    }
    if (!entry.url.startsWith('file://')) {
      continue;
    }
    const filePath = fileURLToPath(entry.url);
    const relativePath = path.relative(ROOT, filePath);
    if (relativePath.startsWith('..') || relativePath.startsWith('..' + path.sep)) {
      continue;
    }
    const matchesTarget = COVERAGE_TARGETS.some(target => {
      if (target.endsWith('/')) {
        return relativePath.startsWith(target);
      }
      return relativePath === target;
    });
    if (!matchesTarget) {
      continue;
    }
    if (!coverage.has(filePath)) {
      const source = fs.readFileSync(filePath, 'utf8');
      coverage.set(filePath, {
        relativePath,
        source,
        lineOffsets: computeLineOffsets(source),
        lineHits: new Map()
      });
    }
    const record = coverage.get(filePath);
    for (const fn of entry.functions || []) {
      for (const range of fn.ranges || []) {
        addRangeToRecord(record, range);
      }
    }
  }
  return coverage;
}

function renderLcov(coverage) {
  const blocks = [];
  for (const record of coverage.values()) {
    const { relativePath, lineHits } = record;
    const sortedLines = Array.from(lineHits.keys()).sort((a, b) => a - b);
    if (!sortedLines.length) {
      continue;
    }
    let lf = 0;
    let lh = 0;
    const lines = sortedLines.map(lineNumber => {
      const hits = lineHits.get(lineNumber) || 0;
      if (hits >= 0) {
        lf += 1;
      }
      if (hits > 0) {
        lh += 1;
      }
      return `DA:${lineNumber},${hits}`;
    });
    blocks.push(
      ['SF:' + relativePath, ...lines, `LF:${lf}`, `LH:${lh}`, 'end_of_record'].join('\n')
    );
  }
  return blocks.join('\n');
}

function writeCoverageArtifacts(coverage) {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  const lcov = renderLcov(coverage);
  fs.writeFileSync(path.join(COVERAGE_DIR, 'lcov.info'), lcov + '\n', 'utf8');

  let totalLines = 0;
  let coveredLines = 0;
  for (const record of coverage.values()) {
    for (const hits of record.lineHits.values()) {
      totalLines += 1;
      if (hits > 0) {
        coveredLines += 1;
      }
    }
  }
  const summary = {
    totalLines,
    coveredLines,
    coverage: totalLines ? coveredLines / totalLines : 1
  };
  fs.writeFileSync(path.join(COVERAGE_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const percentage = (summary.coverage * 100).toFixed(2);
  console.log(`Coverage: ${coveredLines}/${totalLines} lines (${percentage}%)`);
}

function main() {
  ensureCleanDir(COVERAGE_DIR);
  ensureCleanDir(RAW_DIR);
  console.log('Running test suite with coverage instrumentation...');
  runNodeTests();
  console.log('Collecting V8 coverage results...');
  const entries = loadCoverageEntries();
  console.log(`Coverage entries: ${entries.length}`);
  const coverage = buildCoverageMap(entries);
  console.log(`Tracked files: ${coverage.size}`);
  writeCoverageArtifacts(coverage);
  console.log('Coverage artifacts written.');
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { main };
