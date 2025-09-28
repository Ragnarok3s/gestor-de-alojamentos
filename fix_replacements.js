const fs = require('fs');
const file = 'server.js';
let text = fs.readFileSync(file, 'utf8');
const replacements = [
  ['Booking Engine  Front', 'Booking Engine — Front'],
];
fs.writeFileSync(file, text, 'utf8');
