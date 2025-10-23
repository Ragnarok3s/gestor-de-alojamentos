const fs = require('fs');
const path = require('path');

const { collectFiles } = require('./utils');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['server.js', 'server', 'src', 'scripts', 'tests'];
const ASSET_DIRS = ['public', 'src/modules/backoffice/scripts'];
const SOURCE_EXT = ['.js'];
const ASSET_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.js'];
const ENTRY_POINTS = [
  path.join(ROOT, 'server.js'),
  path.join(ROOT, 'tests', 'run-tests.js'),
  path.join(ROOT, 'scripts', 'analyze-routes.js'),
  path.join(ROOT, 'scripts', 'build-check.js'),
  path.join(ROOT, 'scripts', 'depcheck.js'),
  path.join(ROOT, 'scripts', 'find-unused.js'),
  path.join(ROOT, 'scripts', 'lint.js'),
  path.join(ROOT, 'scripts', 'run-tests.js'),
  path.join(ROOT, 'scripts', 'typecheck.js'),
  path.join(ROOT, 'server', 'kb', 'reindex.js')
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function resolveModule(fromFile, target) {
  if (!target) return null;
  if (target.startsWith('node:')) return null;
  if (target.startsWith('http://') || target.startsWith('https://')) return null;
  if (target.startsWith('#')) return null;

  const fromDir = path.dirname(fromFile);
  const candidatePaths = [];

  if (target.startsWith('.') || target.startsWith('/')) {
    const absolute = target.startsWith('/')
      ? path.join(ROOT, target.replace(/^\/+/, ''))
      : path.resolve(fromDir, target);
    candidatePaths.push(absolute);
  } else if (target.startsWith('src/')) {
    candidatePaths.push(path.join(ROOT, target));
  } else if (target.startsWith('@')) {
    return null;
  } else {
    return null;
  }

  const expanded = [];
  for (const candidate of candidatePaths) {
    expanded.push(candidate);
    expanded.push(candidate + '.js');
    expanded.push(path.join(candidate, 'index.js'));
  }

  for (const candidate of expanded) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function parseDependencies(file) {
  const content = fs.readFileSync(file, 'utf8');
  const dependencies = new Set();
  const requirePattern = /require\((['"])([^'"\n]+)\1\)/g;
  const importPattern = /import\s+[^'";]+\s+from\s+(['"])([^'"\n]+)\1/g;
  const dynamicImportPattern = /import\((['"])([^'"\n]+)\1\)/g;

  const matchAll = (regex) => {
    let match;
    while ((match = regex.exec(content))) {
      const resolved = resolveModule(file, match[2]);
      if (resolved) {
        dependencies.add(resolved);
      }
    }
  };

  matchAll(requirePattern);
  matchAll(importPattern);
  matchAll(dynamicImportPattern);

  return Array.from(dependencies);
}

function buildDependencyGraph() {
  const sourceFiles = collectFiles(
    SOURCE_DIRS.map(entry => path.join(ROOT, entry)),
    { extensions: SOURCE_EXT }
  );
  const graph = new Map();
  for (const file of sourceFiles) {
    try {
      const resolved = path.resolve(file);
      const deps = parseDependencies(resolved);
      graph.set(resolved, deps);
    } catch (err) {
      console.warn(`Falha ao analisar ${path.relative(ROOT, file)}: ${err.message}`);
    }
  }
  return graph;
}

function walkDependencies(graph, entryPoints) {
  const visited = new Set();
  const stack = [...entryPoints];
  while (stack.length) {
    const current = stack.pop();
    const resolved = path.resolve(current);
    if (visited.has(resolved)) continue;
    visited.add(resolved);
    const deps = graph.get(resolved);
    if (!deps) continue;
    for (const dep of deps) {
      if (!visited.has(dep)) {
        stack.push(dep);
      }
    }
  }
  return visited;
}

function findUnusedModules(graph) {
  const reachable = walkDependencies(graph, ENTRY_POINTS.filter(fs.existsSync));
  const unused = [];
  for (const file of graph.keys()) {
    if (!reachable.has(file)) {
      const relative = path.relative(ROOT, file);
      if (relative.startsWith('tests/')) continue;
      if (relative.startsWith('scripts/')) continue;
      if (relative.startsWith('src/modules/backoffice/scripts/')) continue;
      unused.push(relative);
    }
  }
  return unused.sort();
}

function findAssets() {
  const assets = [];
  for (const entry of ASSET_DIRS) {
    const dirPath = path.join(ROOT, entry);
    if (!fs.existsSync(dirPath)) continue;
    const files = collectFiles(dirPath, { extensions: ASSET_EXT });
    assets.push(...files.map(file => path.resolve(file)));
  }
  return assets;
}

function gatherReferenceContent() {
  const files = collectFiles(
    [
      path.join(ROOT, 'src'),
      path.join(ROOT, 'server'),
      path.join(ROOT, 'tests'),
      path.join(ROOT, 'public'),
      path.join(ROOT, 'scripts')
    ],
    { extensions: ['.js', '.ejs', '.css', '.html'] }
  );
  const map = new Map();
  for (const file of files) {
    try {
      map.set(path.resolve(file), fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.warn(`Falha ao ler ${path.relative(ROOT, file)}: ${err.message}`);
    }
  }
  return map;
}

function findUnusedAssets(assets, contentMap) {
  const unused = [];
  for (const asset of assets) {
    const relative = path.relative(ROOT, asset);
    const posixPath = '/' + toPosix(relative);
    let referenced = false;
    for (const content of contentMap.values()) {
      if (content.includes(posixPath) || content.includes(toPosix(relative))) {
        referenced = true;
        break;
      }
    }
    if (!referenced) {
      if (relative.startsWith('src/modules/backoffice/scripts/')) {
        continue;
      }
      unused.push(relative);
    }
  }
  return unused.sort();
}

function main() {
  const graph = buildDependencyGraph();
  const unusedModules = findUnusedModules(graph);
  const assets = findAssets();
  const contentMap = gatherReferenceContent();
  const unusedAssets = findUnusedAssets(assets, contentMap);

  const report = {
    generatedAt: new Date().toISOString(),
    unusedModules,
    unusedAssets
  };

  console.log(JSON.stringify(report, null, 2));

  if (unusedModules.length || unusedAssets.length) {
    console.warn('Itens potencialmente não utilizados detectados. Reveja antes de remover.');
  } else {
    console.log('Nenhum módulo ou asset órfão encontrado.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { main };
