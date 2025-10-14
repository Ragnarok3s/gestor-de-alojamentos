const fs = require('fs');
const path = require('path');

const { collectFiles } = require('./utils');

const ROOT = path.resolve(__dirname, '..');

function loadPackageJson() {
  const pkgPath = path.join(ROOT, 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}

function findDependencyUsage(dependency, files) {
  const patterns = [
    `require('${dependency}')`,
    `require("${dependency}")`,
    `from '${dependency}'`,
    `from "${dependency}"`,
    `'${dependency}/`,
    `"${dependency}/`
  ];

  return files.some(file => {
    const content = fs.readFileSync(file, 'utf8');
    return patterns.some(pattern => content.includes(pattern));
  });
}

function main() {
  const pkg = loadPackageJson();
  const dependencies = Object.keys(pkg.dependencies || {});
  const files = collectFiles([
    path.join(ROOT, 'server.js'),
    path.join(ROOT, 'src'),
    path.join(ROOT, 'server'),
    path.join(ROOT, 'tests'),
    path.join(ROOT, 'scripts')
  ], { extensions: ['.js'] });

  const unused = [];
  for (const dependency of dependencies) {
    const used = findDependencyUsage(dependency, files);
    if (!used) {
      unused.push(dependency);
    }
  }

  if (unused.length) {
    console.warn('Potentially unused dependencies found:');
    unused.forEach(dep => console.warn(` - ${dep}`));
    console.warn('Revise manually to confirm dynamic usage before removal.');
    process.exitCode = 1;
  } else {
    console.log('All dependencies appear to be referenced statically.');
  }
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
