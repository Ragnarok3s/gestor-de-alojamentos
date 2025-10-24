#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'config', 'depcruise.json');
const srcRoot = path.join(repoRoot, 'src');

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`arch-check: não foi possível ler ${configPath}:`, error.message);
    process.exit(1);
  }
}

function collectSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolute));
    } else if (entry.isFile() && /\.(cjs|mjs|js|ts)$/i.test(entry.name)) {
      const relative = path.relative(repoRoot, absolute);
      files.push({
        absolute,
        relative,
        posixRelative: toPosix(relative),
        content: fs.readFileSync(absolute, 'utf8'),
      });
    }
  }
  return files;
}

function extractSpecifiers(content) {
  const specifiers = new Set();
  const requireRegex = /require\(\s*['"]([^'\"]+)['"]\s*\)/g;
  const importFromRegex = /from\s+['"]([^'\"]+)['"]/g;
  const sideEffectImportRegex = /import\s+['"]([^'\"]+)['"]/g;

  let match;
  while ((match = requireRegex.exec(content))) {
    specifiers.add(match[1]);
  }
  while ((match = importFromRegex.exec(content))) {
    specifiers.add(match[1]);
  }
  while ((match = sideEffectImportRegex.exec(content))) {
    specifiers.add(match[1]);
  }

  return Array.from(specifiers);
}

function resolveCandidates(specifier, filePath) {
  if (!specifier.startsWith('.')) {
    return [{ type: 'module', value: specifier }];
  }
  const base = path.resolve(path.dirname(filePath), specifier);
  const guesses = [base];
  const suffixes = ['', '.js', '.ts', '.cjs', '.mjs', '.jsx', '.tsx'];
  for (const suffix of suffixes) {
    const candidate = base + suffix;
    guesses.push(candidate);
  }
  for (const suffix of ['.js', '.ts', '.cjs', '.mjs', '.jsx', '.tsx']) {
    guesses.push(path.join(base, 'index' + suffix));
  }
  const seen = new Set();
  return guesses
    .map((candidate) => path.relative(repoRoot, candidate))
    .filter((relative) => {
      const key = toPosix(relative);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((relative) => ({ type: 'path', value: toPosix(relative) }));
}

function main() {
  if (!fs.existsSync(srcRoot)) {
    console.log('arch-check: diretório src não encontrado, nada para verificar.');
    return;
  }

  const config = loadConfig();
  const rules = Array.isArray(config.forbidden) ? config.forbidden : [];
  if (rules.length === 0) {
    console.log('arch-check: nenhuma regra configurada.');
    return;
  }

  const files = collectSourceFiles(srcRoot);
  const violations = [];

  for (const file of files) {
    const specifiers = extractSpecifiers(file.content);
    if (specifiers.length === 0) continue;

    for (const rule of rules) {
      const fromPattern = rule.from && rule.from.path ? rule.from.path : null;
      const toPattern = rule.to && rule.to.path ? rule.to.path : null;
      if (!fromPattern || !toPattern) continue;

      const fromRegex = new RegExp(fromPattern);
      if (!fromRegex.test(file.posixRelative)) continue;

      const toRegex = new RegExp(toPattern);
      for (const specifier of specifiers) {
        const candidates = resolveCandidates(specifier, file.absolute);
        for (const candidate of candidates) {
          const target = candidate.type === 'module' ? candidate.value : candidate.value;
          if (toRegex.test(target)) {
            violations.push({
              rule: rule.name || 'regra sem nome',
              file: file.posixRelative,
              specifier,
              target,
            });
            break;
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('arch-check: foram encontradas dependências proibidas:');
    for (const violation of violations) {
      console.error(` - [${violation.rule}] ${violation.file} importa "${violation.specifier}" (${violation.target})`);
    }
    process.exit(1);
  }

  console.log('arch-check: nenhuma dependência proibida encontrada.');
}

main();
