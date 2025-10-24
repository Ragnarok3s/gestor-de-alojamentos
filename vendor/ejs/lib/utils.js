'use strict';

const regExpChars = /[|\\{}()\[\]^$+*?.]/g;
const MATCH_HTML = /[&<>"']/g;
const ENCODE_HTML_RULES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function escapeRegExpChars(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(regExpChars, '\\$&');
}

function encodeChar(c) {
  return ENCODE_HTML_RULES[c] || c;
}

function escapeXML(markup) {
  if (markup === undefined || markup === null) return '';
  return String(markup).replace(MATCH_HTML, encodeChar);
}

function shallowCopy(to, from) {
  const target = to || {};
  const source = from || {};
  for (const key in source) {
    if (has(source, key)) {
      target[key] = source[key];
    }
  }
  return target;
}

function defaults(options, defaults) {
  return shallowCopy(shallowCopy({}, defaults), options);
}

function ensureEscapeFn(fn) {
  return typeof fn === 'function' ? fn : escapeXML;
}

function createErrorContext(str, lineno) {
  if (typeof str !== 'string') return '';
  const lines = str.split('\n');
  const start = Math.max(lineno - 3, 0);
  const end = Math.min(lines.length, lineno + 2);
  const context = [];
  for (let i = start; i < end; i++) {
    const curr = i + 1;
    const indicator = curr === lineno ? ' >> ' : '    ';
    context.push(`${indicator}${curr}| ${lines[i]}`);
  }
  return context.join('\n');
}

module.exports = {
  has,
  escapeRegExpChars,
  escapeXML,
  shallowCopy,
  defaults,
  ensureEscapeFn,
  createErrorContext
};
