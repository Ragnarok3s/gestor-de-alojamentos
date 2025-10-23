const fs = require('fs');
const path = require('path');

const { collectFiles } = require('./utils');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const OUTPUT_PATH = path.join(REPORT_DIR, 'routes-analysis.json');
const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'];

function isRouter(candidate) {
  return (
    typeof candidate === 'function' &&
    candidate.name === 'router' &&
    Array.isArray(candidate.stack)
  );
}

function captureCallSite() {
  const stack = new Error().stack || '';
  const lines = stack.split('\n').slice(2);
  for (const line of lines) {
    if (!line) continue;
    if (line.includes('node:internal')) continue;
    if (line.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (line.includes('scripts' + path.sep + 'analyze-routes.js')) continue;
    const withParens = line.match(/\(([^)]+):(\d+):(\d+)\)/);
    if (withParens) {
      const [, file, lineNumber] = withParens;
      return { file: path.relative(ROOT, file), line: Number(lineNumber) };
    }
    const direct = line.match(/at ([^ ]+):(\d+):(\d+)/);
    if (direct) {
      const [, file, lineNumber] = direct;
      if (file.includes('<anonymous>')) continue;
      return { file: path.relative(ROOT, file), line: Number(lineNumber) };
    }
  }
  return null;
}

function describeHandler(handler) {
  if (!handler) return '<undefined>';
  if (handler.name) return handler.name;
  if (handler.displayName) return handler.displayName;
  if (handler.constructor && handler.constructor.name) {
    return `(${handler.constructor.name})`;
  }
  return '<anonymous>';
}

function patchRouter(router) {
  if (!router || router.__routeAnalyzerPatched) {
    return router;
  }

  router.__routeAnalyzerPatched = true;

  for (const method of HTTP_METHODS) {
    const original = router[method];
    if (typeof original !== 'function') continue;
    router[method] = function patchedMethod(pathArg, ...handlers) {
      const callSite = captureCallSite();
      const paths = Array.isArray(pathArg) ? pathArg : [pathArg];
      const result = original.call(this, pathArg, ...handlers);
      if (!this.__recordedRoutes) this.__recordedRoutes = [];
      const names = handlers.map(describeHandler);
      for (const routePath of paths) {
        this.__recordedRoutes.push({
          method: method.toUpperCase(),
          path: routePath,
          handlers: names,
          callSite
        });
      }
      return result;
    };
  }

  const originalUse = router.use;
  if (typeof originalUse === 'function') {
    router.use = function patchedUse(...args) {
      const callSite = captureCallSite();
      let offset = 0;
      let paths = ['/'];
      if (args.length) {
        const first = args[0];
        const isPathArg =
          typeof first === 'string' ||
          first instanceof RegExp ||
          (Array.isArray(first) && first.length &&
            (typeof first[0] === 'string' || first[0] instanceof RegExp));
        if (isPathArg) {
          offset = 1;
          paths = Array.isArray(first) ? first.slice() : [first];
        }
      }
      for (let index = offset; index < args.length; index += 1) {
        const handler = args[index];
        if (isRouter(handler)) {
          patchRouter(handler);
          if (!this.__childRouters) this.__childRouters = [];
          this.__childRouters.push({
            router: handler,
            paths: paths.slice(),
            callSite
          });
        }
      }
      return originalUse.apply(this, args);
    };
  }

  return router;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizePrefix(prefix) {
  if (!prefix) return '';
  if (prefix instanceof RegExp) {
    return prefix.toString();
  }
  const str = String(prefix);
  if (!str || str === '/') return '';
  if (str.startsWith('^')) return str; // regex-like
  if (!str.startsWith('/')) return '/' + str.replace(/^\/+/g, '');
  return str.endsWith('/') && str !== '/' ? str.slice(0, -1) : str;
}

function normalizeSegment(segment) {
  if (segment == null) return '/';
  if (segment instanceof RegExp) {
    return segment.toString();
  }
  const str = String(segment);
  if (!str) return '/';
  return str;
}

function joinPaths(prefix, segment) {
  const base = normalizePrefix(prefix);
  const seg = normalizeSegment(segment);
  if (seg === '/' || seg === '.' || seg === '') {
    return base || '/';
  }
  if (seg.startsWith('^')) {
    const basePart = base && base !== '/' ? base : '';
    return `${basePart}${seg}`;
  }
  if (seg.startsWith('/')) {
    const basePart = base && base !== '/' ? base : '';
    return `${basePart}${seg}` || '/';
  }
  const basePart = base && base !== '/' ? base : '';
  return `${basePart}/${seg}`;
}

function expandPaths(prefixes, segment) {
  const segments = asArray(segment);
  const results = [];
  for (const prefix of prefixes) {
    for (const seg of segments) {
      results.push(joinPaths(prefix, seg));
    }
  }
  return results;
}

function formatCallSite(callSite) {
  if (!callSite || !callSite.file) return null;
  return `${callSite.file}:${callSite.line}`;
}

function gatherRouterRoutes(router, basePrefixes = [''], visited = new Set()) {
  if (!router || visited.has(router)) {
    return [];
  }
  visited.add(router);

  const aggregate = new Map();
  const records = router.__recordedRoutes || [];
  for (const record of records) {
    const fullPaths = expandPaths(basePrefixes, record.path);
    for (const fullPath of fullPaths) {
      const key = fullPath;
      if (!aggregate.has(key)) {
        aggregate.set(key, {
          path: fullPath,
          methods: new Set(),
          handlers: new Set(),
          sources: new Set()
        });
      }
      const entry = aggregate.get(key);
      entry.methods.add(record.method);
      record.handlers.forEach(name => entry.handlers.add(name));
      const source = formatCallSite(record.callSite);
      if (source) entry.sources.add(source);
    }
  }

  let routes = Array.from(aggregate.values()).map(entry => ({
    path: cleanupPath(entry.path),
    methods: Array.from(entry.methods).sort(),
    handlers: Array.from(entry.handlers).sort(),
    sources: Array.from(entry.sources).sort(),
    mounts: []
  }));

  const children = router.__childRouters || [];
  for (const child of children) {
    const basePaths = expandPaths(basePrefixes, child.paths && child.paths.length ? child.paths : ['/']);
    const childRoutes = gatherRouterRoutes(child.router, basePaths, visited);
    const mountSource = formatCallSite(child.callSite);
    if (mountSource) {
      for (const route of childRoutes) {
        route.mounts = route.mounts || [];
        if (!route.mounts.includes(mountSource)) {
          route.mounts.push(mountSource);
        }
      }
    }
    routes = routes.concat(childRoutes);
  }

  return routes;
}

function cleanupPath(pathValue) {
  if (!pathValue) return '/';
  if (pathValue instanceof RegExp) {
    return pathValue.toString();
  }
  let str = String(pathValue);
  if (!str) return '/';
  if (str.startsWith('^')) return str; // regex literal
  if (!str.startsWith('/')) {
    str = '/' + str;
  }
  str = str.replace(/\/{2,}/g, '/');
  if (str.length > 1 && str.endsWith('/')) {
    str = str.slice(0, -1);
  }
  return str || '/';
}

function collectLinks() {
  const files = collectFiles(
    [
      path.join(ROOT, 'src'),
      path.join(ROOT, 'server'),
      path.join(ROOT, 'public'),
      path.join(ROOT, 'tests')
    ],
    { extensions: ['.js', '.ejs'] }
  );
  const linkMap = new Map();
  const results = [];

  const attributePattern = /(?:href|data-href|action)\s*=\s*(["'`])([^"'`]+?)\1/g; // html-like attributes
  const propertyPattern = /(?:href|to|path)\s*:\s*(["'`])([^"'`]+?)\1/g; // object properties

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const content = fs.readFileSync(file, 'utf8');

    const seenTargets = new Set();

    let match;
    while ((match = attributePattern.exec(content))) {
      const target = match[2].trim();
      if (!target.startsWith('/')) continue;
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      results.push({ source: relative, target });
    }

    while ((match = propertyPattern.exec(content))) {
      const target = match[2].trim();
      if (!target.startsWith('/')) continue;
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      results.push({ source: relative, target });
    }

    const templatePattern = /(?:href|to|path)\s*:\s*`([^`]+)`/g;
    while ((match = templatePattern.exec(content))) {
      const target = match[1].trim();
      if (!target.startsWith('/')) continue;
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      results.push({ source: relative, target });
    }

    if (seenTargets.size) {
      linkMap.set(relative, Array.from(seenTargets));
    }
  }

  return { links: results, bySource: Object.fromEntries(linkMap) };
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRouteMatcher(routePath) {
  if (!routePath) return null;
  if (routePath.startsWith('^')) {
    try {
      return new RegExp(routePath);
    } catch (err) {
      return null;
    }
  }
  let pattern = escapeRegex(routePath);
  pattern = pattern.replace(/:([A-Za-z0-9_]+)/g, '[^/]+');
  pattern = pattern.replace(/\\\*/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function normalizeLinkTarget(target) {
  if (!target) return target;
  let clean = target.split(/[?#]/)[0];
  if (!clean) return '/';
  if (!clean.startsWith('/')) clean = `/${clean}`;
  if (clean.length > 1 && clean.endsWith('/')) {
    clean = clean.slice(0, -1);
  }
  if (clean.includes('${')) {
    clean = clean.replace(/\$\{[^}]+\}/g, 'placeholder');
  }
  return clean;
}

function analyzeGraph(routes, linkRecords) {
  const matchers = routes.map(route => ({
    path: route.path,
    matcher: buildRouteMatcher(route.path),
    methods: route.methods
  }));

  const unmatchedLinks = [];
  for (const record of linkRecords.links) {
    const target = normalizeLinkTarget(record.target);
    if (target.startsWith('/public/') || target.startsWith('/css/') || target.startsWith('/js/')) {
      continue;
    }
    const matches = matchers.some(entry => entry.matcher && entry.matcher.test(target));
    if (!matches) {
      unmatchedLinks.push({ source: record.source, target: record.target, normalizedTarget: target });
    }
  }

  const linkedPaths = new Map();
  for (const record of linkRecords.links) {
    const target = normalizeLinkTarget(record.target);
    if (!linkedPaths.has(target)) {
      linkedPaths.set(target, []);
    }
    linkedPaths.get(target).push(record.source);
  }

  const orphanRoutes = [];
  const sourceUsage = new Map();
  for (const route of routes) {
    const key = (route.sources || []).sort().join('|');
    if (!key) continue;
    sourceUsage.set(key, (sourceUsage.get(key) || 0) + 1);
  }
  for (const route of routes) {
    if (!route.methods.includes('GET')) continue;
    const path = route.path;
    if (!path.startsWith('/')) continue;
    if (path.startsWith('/api')) continue;
    if (path.includes('/api/')) continue;
    if (path.startsWith('/_')) continue;
    if (path.endsWith('.json') || path.endsWith('.csv') || path.endsWith('.ics')) continue;
    if (path.includes('/:')) continue;
    if (path.startsWith('/admin/notifications')) continue;
    if (path.startsWith('/admin/search')) continue;
    if (path.startsWith('/admin/tenants')) continue;
    if (path === '/search') continue;
    if (path.startsWith('/admin/export') && path.includes('download')) continue;
    const sourceKey = (route.sources || []).sort().join('|');
    if (sourceKey && sourceUsage.get(sourceKey) > 1) continue;
    const matcher = buildRouteMatcher(path);
    let hasLink = false;
    for (const [target] of linkedPaths) {
      if (matcher && matcher.test(target)) {
        hasLink = true;
        break;
      }
    }
    if (!hasLink) {
      orphanRoutes.push({
        path,
        methods: route.methods,
        sources: route.sources,
        mounts: route.mounts
      });
    }
  }

  return { unmatchedLinks, orphanRoutes };
}

function mergeRoutes(routes) {
  const map = new Map();
  for (const route of routes) {
    const key = route.path;
    if (!map.has(key)) {
      map.set(key, {
        path: route.path,
        methods: new Set(route.methods || []),
        handlers: new Set(route.handlers || []),
        sources: new Set(route.sources || []),
        mounts: new Set(route.mounts || [])
      });
    } else {
      const entry = map.get(key);
      route.methods.forEach(method => entry.methods.add(method));
      route.handlers.forEach(handler => entry.handlers.add(handler));
      route.sources.forEach(source => entry.sources.add(source));
      (route.mounts || []).forEach(mount => entry.mounts.add(mount));
    }
  }

  return Array.from(map.values())
    .map(entry => ({
      path: entry.path,
      methods: Array.from(entry.methods).sort(),
      handlers: Array.from(entry.handlers).sort(),
      sources: Array.from(entry.sources).sort(),
      mounts: Array.from(entry.mounts).sort()
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function main() {
  const express = require('express');
  patchRouter(express.application);
  const originalRouterFactory = express.Router;
  express.Router = function patchedRouter(...args) {
    const router = originalRouterFactory.apply(this, args);
    return patchRouter(router);
  };

  process.env.SKIP_SERVER_START = process.env.SKIP_SERVER_START || '1';
  process.env.DATABASE_PATH = process.env.DATABASE_PATH || ':memory:';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  const app = require(path.join(ROOT, 'server.js'));
  patchRouter(app);

  const routes = mergeRoutes(gatherRouterRoutes(app, ['']));
  const links = collectLinks();
  const graph = analyzeGraph(routes, links);

  const report = {
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    linkCount: links.links.length,
    routes,
    links: links.bySource,
    unmatchedLinks: graph.unmatchedLinks,
    orphanRoutes: graph.orphanRoutes
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

  if (graph.unmatchedLinks.length || graph.orphanRoutes.length) {
    console.warn('Route analysis detected issues:');
    if (graph.unmatchedLinks.length) {
      console.warn(` - ${graph.unmatchedLinks.length} link(s) pointing to unknown routes.`);
    }
    if (graph.orphanRoutes.length) {
      console.warn(` - ${graph.orphanRoutes.length} route(s) without incoming links.`);
    }
  } else {
    console.log('Route analysis completed without issues.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { main };
