const fs = require('fs');
const lines = fs.readFileSync('server.js', 'utf8').split(/\r?\n/);
lines.forEach((line, idx) => {
  if (line.includes('coffee') || line.includes('Terra') || line.includes('Caracter�sticas')) {
    console.log(idx, line);
  }
});
