const fs = require('fs');
const path = require('path');

const { gatherSourceFiles, runTypecheck } = require('./typecheck');

function parseArgs(argv) {
  let maxWarnings = Infinity;
  argv.forEach(arg => {
    if (arg.startsWith('--max-warnings=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value)) {
        maxWarnings = value;
      }
    }
  });
  return { maxWarnings };
}

function checkTrailingWhitespace(files) {
  const trailingPattern = /[ \t]+$/;
  const problems = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (trailingPattern.test(line)) {
        const lineNumber = index + 1;
        problems.push({ file, line: lineNumber, message: 'Trailing whitespace' });
      }
    });
  }

  return problems;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { files } = runTypecheck({ quiet: true });
  const issues = checkTrailingWhitespace(files);

  if (issues.length) {
    for (const issue of issues) {
      console.error(`${path.relative(path.resolve(__dirname, '..'), issue.file)}:${issue.line} ${issue.message}`);
    }
    if (issues.length > options.maxWarnings) {
      throw new Error(`Lint failed with ${issues.length} issue(s).`);
    }
  }

  if (issues.length === 0) {
    console.log(`Lint OK para ${files.length} ficheiros JavaScript.`);
  } else {
    console.log(`Lint concluído com ${issues.length} aviso(s) dentro do limite (${options.maxWarnings}).`);
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
