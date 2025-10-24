const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const viewsRoot = path.join(__dirname, '..', 'views');
const compiledCache = new Map();

const defaultCompileOptions = {
  rmWhitespace: true,
  async: false,
};

const defaultRenderOptions = {
  async: true,
  rmWhitespace: true,
  cache: process.env.NODE_ENV === 'production',
};

function resolveTemplatePath(templatePath) {
  if (!templatePath || typeof templatePath !== 'string') {
    throw new Error('viewRenderer: templatePath deve ser uma string.');
  }
  const normalized = templatePath.trim();
  if (!normalized) {
    throw new Error('viewRenderer: templatePath inválido.');
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.join(viewsRoot, normalized);
}

function getRenderer(templatePath, options = {}) {
  const filename = resolveTemplatePath(templatePath);
  if (compiledCache.has(filename)) {
    return compiledCache.get(filename);
  }
  let source;
  try {
    source = fs.readFileSync(filename, 'utf8');
  } catch (err) {
    console.warn(`viewRenderer: falha ao carregar template ${filename}:`, err.message);
    compiledCache.set(filename, null);
    return null;
  }
  try {
    const compiled = ejs.compile(source, {
      ...defaultCompileOptions,
      ...options,
      filename,
    });
    const renderer = (locals = {}) => compiled(locals);
    compiledCache.set(filename, renderer);
    return renderer;
  } catch (err) {
    console.warn(`viewRenderer: falha ao compilar template ${filename}:`, err.message);
    compiledCache.set(filename, null);
    return null;
  }
}

function clearRendererCache() {
  compiledCache.clear();
}

async function renderView(templatePath, locals = {}, options = {}) {
  const filename = resolveTemplatePath(templatePath);
  const finalOptions = {
    ...defaultRenderOptions,
    ...options,
    filename,
    root: viewsRoot,
  };
  return ejs.renderFile(filename, locals, finalOptions);
}

module.exports = {
  getRenderer,
  clearRendererCache,
  renderView,
  viewsRoot,
};
