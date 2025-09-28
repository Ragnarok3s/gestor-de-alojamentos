const fs = require('fs');
const file = 'server.js';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const filtered = lines.filter(line => !line.includes('\uFFFD'));
fs.writeFileSync(file, filtered.join('\n'), 'utf8');
