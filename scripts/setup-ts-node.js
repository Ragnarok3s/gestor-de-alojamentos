#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const stubPath = path.join(__dirname, 'bin', 'ts-node');
const binDir = path.join(projectRoot, 'node_modules', '.bin');
const destination = path.join(binDir, 'ts-node');

try {
  if (!fs.existsSync(stubPath)) {
    throw new Error('Stub ts-node bin não encontrado.');
  }
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  const sourceContent = fs.readFileSync(stubPath);
  let needsWrite = true;
  if (fs.existsSync(destination)) {
    const current = fs.readFileSync(destination);
    needsWrite = !current.equals(sourceContent);
  }
  if (needsWrite) {
    fs.writeFileSync(destination, sourceContent, { mode: 0o755 });
  } else {
    fs.chmodSync(destination, 0o755);
  }
} catch (err) {
  console.error('[setup-ts-node] Falhou ao preparar stub ts-node:', err.message || err);
  process.exit(1);
}
