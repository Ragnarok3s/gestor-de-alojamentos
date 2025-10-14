const fs = require('fs');
const path = require('path');

const { gatherSourceFiles, runTypecheck } = require('./typecheck');

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
  const { files } = runTypecheck({ quiet: true });
  const issues = checkTrailingWhitespace(files);
  if (issues.length) {
    for (const issue of issues) {
      console.error(`${path.relative(path.resolve(__dirname, '..'), issue.file)}:${issue.line} ${issue.message}`);
    }
    throw new Error(`Lint failed with ${issues.length} issue(s).`);
  }
  console.log(`Lint OK for ${files.length} JavaScript files.`);
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
