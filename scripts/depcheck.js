const fs = require('fs');
const path = require('path');

const { collectFiles } = require('./utils');

const ROOT = path.resolve(__dirname, '..');

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    return '';
  }
}

function gatherCandidates() {
  const targets = [
    path.join(ROOT, 'server.js'),
    path.join(ROOT, 'server'),
    path.join(ROOT, 'src'),
    path.join(ROOT, 'tests'),
    path.join(ROOT, 'scripts'),
    path.join(ROOT, 'config'),
    path.join(ROOT, 'docs')
  ];

  const files = collectFiles(targets, { extensions: ['.js', '.cjs', '.mjs', '.json', '.ts'] });
  const rootConfigs = ['jest.config.js', 'tsconfig.json', '.eslintrc.cjs', '.babelrc', 'webpack.config.js'];
  rootConfigs.forEach(file => {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) {
      files.push(full);
    }
  });

  return files;
}

function buildPatterns(dependency) {
  return [
    `require('${dependency}')`,
    `require("${dependency}")`,
    `from '${dependency}'`,
    `from "${dependency}"`,
    `'${dependency}'`,
    `"${dependency}"`,
    `'${dependency}/`,
    `"${dependency}/`,
    `:${dependency}`,
    `${dependency}(`,
    `${dependency}.`
  ];
}

function main() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const dependencies = Object.keys(pkg.dependencies || {});
  const devDependencies = Object.keys(pkg.devDependencies || {});
  const files = gatherCandidates();

  function isReferenced(dep) {
    const patterns = buildPatterns(dep);
    return files.some(file => {
      const content = readFileSafe(file);
      return patterns.some(pattern => content.includes(pattern));
    });
  }

  const unusedDeps = dependencies.filter(dep => !isReferenced(dep));
  const unusedDevDeps = devDependencies
    .filter(dep => dep !== 'jest')
    .filter(dep => !isReferenced(dep));

  if (!unusedDeps.length && !unusedDevDeps.length) {
    console.log('Depcheck: nenhuma dependência órfã encontrada.');
    return;
  }

  if (unusedDeps.length) {
    console.warn('Dependências sem uso detectadas:');
    unusedDeps.forEach(dep => console.warn(` - ${dep}`));
  }

  if (unusedDevDeps.length) {
    console.warn('DevDependencies sem uso detectadas:');
    unusedDevDeps.forEach(dep => console.warn(` - ${dep}`));
  }

  process.exitCode = 1;
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
