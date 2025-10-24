'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('./utils');

const VERSION = '3.1.10';
const DEFAULTS = {
  delimiter: '%',
  openDelimiter: '<',
  closeDelimiter: '>',
  localsName: 'locals',
  rmWhitespace: false,
  context: undefined,
  cache: false,
  filename: undefined,
  root: undefined,
  views: undefined,
  escapeFunction: undefined
};

const cacheStore = {
  data: Object.create(null),
  set(key, fn) {
    this.data[key] = fn;
  },
  get(key) {
    return this.data[key];
  },
  reset() {
    this.data = Object.create(null);
  }
};

function escapeSpecial(str) {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function resolveIncludePath(target, parentFilename, options) {
  if (typeof target !== 'string' || !target.trim()) {
    throw new Error('include path must be a non-empty string');
  }
  let includePath = target.trim();
  if (!path.extname(includePath)) {
    includePath += '.ejs';
  }
  if (path.isAbsolute(includePath)) {
    const root = options.root ? path.resolve(options.root) : path.join(process.cwd(), '');
    return path.join(root, includePath.replace(/^\/+/, ''));
  }
  const views = Array.isArray(options.views) ? options.views : [];
  for (const view of views) {
    const candidate = path.join(view, includePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (parentFilename) {
    return path.resolve(path.dirname(parentFilename), includePath);
  }
  if (options.root) {
    return path.resolve(options.root, includePath);
  }
  return path.resolve(includePath);
}

function resolveTemplatePath(filename, options) {
  if (path.isAbsolute(filename)) return filename;
  const views = Array.isArray(options.views) ? options.views : [];
  for (const view of views) {
    const candidate = path.join(view, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (options.filename) {
    return path.resolve(path.dirname(options.filename), filename);
  }
  if (options.root) {
    return path.resolve(options.root, filename);
  }
  return path.resolve(filename);
}

function parseTemplate(template, options) {
  const open = options.openDelimiter + options.delimiter;
  const close = options.delimiter + options.closeDelimiter;
  const openLen = open.length;
  const closeLen = close.length;
  let cursor = 0;
  let source = '';
  let line = 1;
  const text = options.rmWhitespace ? template.replace(/[ \t]*\n[ \t]*/g, '\n') : template;

  function appendLineCount(str) {
    const match = str.match(/\n/g);
    if (match) line += match.length;
  }

  function addText(textChunk) {
    if (!textChunk) return;
    appendLineCount(textChunk);
    source += `__append(${JSON.stringify(textChunk)});\n`;
  }

  while (cursor < text.length) {
    const openIndex = text.indexOf(open, cursor);
    if (openIndex === -1) {
      addText(text.slice(cursor));
      break;
    }
    if (openIndex > cursor) {
      addText(text.slice(cursor, openIndex));
    }

    if (text.slice(openIndex, openIndex + openLen * 2) === open + open) {
      source += `__append(${JSON.stringify(open)});\n`;
      cursor = openIndex + openLen * 2;
      continue;
    }

    const start = openIndex + openLen;
    const closeIndex = text.indexOf(close, start);
    if (closeIndex === -1) {
      throw new Error('Could not find matching close tag for EJS expression.');
    }
    let content = text.slice(start, closeIndex);
    cursor = closeIndex + closeLen;

    const indicator = content.trim().charAt(0);
    const body = indicator === '=' || indicator === '-' || indicator === '#' ? content.trim().slice(1) : content;
    appendLineCount(content);

    if (indicator === '#') {
      continue;
    }
    if (indicator === '=') {
      source += `__append(__escape(${body.trim()}));\n`;
      continue;
    }
    if (indicator === '-') {
      source += `__append(${body.trim()});\n`;
      continue;
    }
    source += `${content}\n`;
  }

  return { source, line };
}

function compile(template, opts) {
  const options = utils.defaults(opts || {}, DEFAULTS);
  const parsed = parseTemplate(String(template), options);
  const localsName = options.localsName || 'locals';
  const header = `let __output = '';\nconst __append = (value) => { if (value !== undefined && value !== null) __output += value; };\n`;
  const footer = '\nreturn __output;';
  const functionBody = `${header}const __escape = __runtime.escapeFn;\nconst include = __runtime.include;\nwith (${localsName} || {}) {\n${parsed.source}}${footer}`;

  const renderer = new Function(localsName, '__runtime', functionBody);

  const finalFn = function render(data, runtimeOptions = {}) {
    const locals = data || {};
    const runtime = utils.shallowCopy({}, runtimeOptions);
    const baseFilename = runtime.filename || options.filename;
    const mergedOptions = utils.shallowCopy(utils.shallowCopy({}, options), runtime);
    mergedOptions.filename = baseFilename;
    const escapeFn = utils.ensureEscapeFn(runtime.escapeFunction || options.escapeFunction);
    const include = function include(name, includeData = {}) {
      const resolved = resolveIncludePath(name, mergedOptions.filename, mergedOptions);
      const includeOpts = utils.shallowCopy({}, mergedOptions);
      includeOpts.filename = resolved;
      const mergedLocals = utils.shallowCopy(utils.shallowCopy({}, locals), includeData);
      return renderFile(resolved, mergedLocals, includeOpts);
    };
    const runtimeState = { escapeFn, include };
    const reservedProps = new Set(['__append', '__output', '__escape', 'include', '__runtime']);
    const scope = new Proxy(locals, {
      has: (target, prop) => {
        if (typeof prop === 'string' && reservedProps.has(prop)) {
          return false;
        }
        return true;
      },
      get: (target, prop) => {
        if (Object.prototype.hasOwnProperty.call(target, prop)) {
          return target[prop];
        }
        if (typeof prop === 'string' && reservedProps.has(prop)) {
          return undefined;
        }
        return globalThis[prop];
      }
    });
    return renderer.call(mergedOptions.context || this, scope, runtimeState);
  };

  finalFn.filename = options.filename;
  return finalFn;
}

function handleCache(template, options) {
  if (options.cache) {
    if (!options.filename) {
      throw new Error('cache option requires a filename');
    }
    const cached = cacheStore.get(options.filename);
    if (cached) return cached;
    const compiled = compile(template, options);
    cacheStore.set(options.filename, compiled);
    return compiled;
  }
  return compile(template, options);
}

function render(template, data, opts) {
  const options = utils.shallowCopy({}, opts || {});
  const fn = handleCache(String(template), options);
  return fn(data, options);
}

function readTemplateFile(filename, options) {
  const resolved = resolveTemplatePath(filename, options);
  return { filename: resolved, contents: fs.readFileSync(resolved, 'utf8') };
}

function renderFile(filename, data, opts) {
  const options = utils.shallowCopy({ filename }, opts || {});
  const { filename: resolved, contents } = readTemplateFile(filename, options);
  options.filename = resolved;
  const fn = handleCache(contents, options);
  const result = fn(data, options);
  if (options.async) {
    return Promise.resolve(result);
  }
  return result;
}

function clearCache() {
  cacheStore.reset();
}

function __express(filename, data, cb) {
  let promise;
  try {
    promise = renderFile(filename, data, data);
  } catch (err) {
    if (typeof cb === 'function') {
      return cb(err);
    }
    throw err;
  }
  if (typeof cb === 'function') {
    if (promise && typeof promise.then === 'function') {
      promise.then(str => cb(null, str), cb);
    } else {
      cb(null, promise);
    }
  }
  return promise;
}

module.exports = {
  VERSION,
  cache: cacheStore,
  clearCache,
  compile,
  render,
  renderFile,
  __express,
  utils,
  escapeXML: utils.escapeXML
};
