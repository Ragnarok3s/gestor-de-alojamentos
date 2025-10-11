#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function registerTsExtension() {
  if (require.extensions['.ts']) {
    return;
  }
  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(source, filename);
  };
}

function main() {
  registerTsExtension();
  const [, , target, ...rest] = process.argv;
  if (!target) {
    console.error('Usage: ts-node <file> [args...]');
    process.exit(1);
  }
  const scriptPath = path.resolve(process.cwd(), target);
  process.argv = [process.argv[0], scriptPath, ...rest];
  require(scriptPath);
}

main();
