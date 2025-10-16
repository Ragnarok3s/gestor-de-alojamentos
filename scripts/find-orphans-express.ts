// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;

interface RouteRecord {
  objectName: string;
  methods: string[];
  paths: Array<{ value: string; dynamic: boolean }>;
  file: string;
  loc: t.SourceLocation | null;
  middlewares: string[];
  handlerNode?: t.Function | null;
}

interface MountRecord {
  parent: string;
  child: string;
  prefix: string;
}

interface HandlerFlags {
  isPage: boolean;
  isApi: boolean;
}

interface LinkEdge {
  source: string;
  target: string;
}

function collectFiles(root: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage', '.vercel', '.expo', 'tmp', '.git'].includes(entry.name)) {
        continue;
      }
      collectFiles(full, results);
    } else if (entry.isFile()) {
      if (full.endsWith('.js') || full.endsWith('.ts')) {
        results.push(full);
      }
    }
  }
  return results;
}

function extractPaths(arg: t.Expression | t.SpreadElement | null | undefined): Array<{ value: string; dynamic: boolean }> {
  if (!arg) return [];
  if (t.isStringLiteral(arg)) {
    return [{ value: arg.value || '/', dynamic: false }];
  }
  if (t.isTemplateLiteral(arg) && arg.expressions.length === 0) {
    return [{ value: arg.quasis.map(q => q.value.raw).join(''), dynamic: false }];
  }
  if (t.isArrayExpression(arg)) {
    const items: Array<{ value: string; dynamic: boolean }> = [];
    for (const el of arg.elements) {
      if (t.isStringLiteral(el)) {
        items.push({ value: el.value || '/', dynamic: false });
      } else if (t.isTemplateLiteral(el) && el.expressions.length === 0) {
        items.push({ value: el.quasis.map(q => q.value.raw).join(''), dynamic: false });
      }
    }
    return items;
  }
  return [{ value: '[dynamic]', dynamic: true }];
}

function joinPaths(base: string, child: string): string {
  const baseClean = base === '/' ? '' : base.replace(/\/$/, '');
  if (child === '[dynamic]') {
    return baseClean ? `${baseClean}/*` : '/*';
  }
  if (!child || child === '/') {
    return baseClean || '/';
  }
  const childPart = child.startsWith('/') ? child : `/${child}`;
  const combined = `${baseClean}${childPart}`;
  return combined || '/';
}

function normalizeLinkTarget(target: string): string {
  if (!target) return target;
  try {
    const url = new URL(target, 'https://placeholder.local');
    const pathname = url.pathname || '/';
    return pathname.replace(/\/+/g, '/');
  } catch (err) {
    return target.split('?')[0];
  }
}

interface AnalysisResult {
  routes: Array<RouteRecord & HandlerFlags & { fullPaths: string[]; method: string }>;
  links: LinkEdge[];
}

function analyzeHandlers(route: RouteRecord): HandlerFlags {
  const info: HandlerFlags = { isPage: false, isApi: false };
  const handler = route.handlerNode;
  if (!handler) return info;
  const params = handler.params;
  const resParam = params.length >= 2 && t.isIdentifier(params[1]) ? params[1].name : null;
  if (!handler.body) return info;
  traverse(handler as any, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isMemberExpression(callee) && resParam) {
        if (t.isIdentifier(callee.object, { name: resParam }) && t.isIdentifier(callee.property)) {
          const method = callee.property.name;
          if (method === 'json') {
            info.isApi = true;
          }
          if (method === 'type') {
            const arg = path.node.arguments[0];
            if (t.isStringLiteral(arg)) {
              if (arg.value.includes('json')) info.isApi = true;
              if (arg.value.includes('html')) info.isPage = true;
            }
          }
          if (method === 'send') {
            const first = path.node.arguments[0];
            if (first) {
              if (t.isCallExpression(first) && t.isIdentifier(first.callee, { name: 'layout' })) {
                info.isPage = true;
              } else if (t.isStringLiteral(first) && /<[^>]+>/.test(first.value)) {
                info.isPage = true;
              } else if (t.isTemplateLiteral(first)) {
                info.isPage = true;
              }
            }
          }
          if (method === 'render' || method === 'sendFile') {
            info.isPage = true;
          }
        }
      }
    }
  });
  if (info.isPage) info.isApi = false;
  return info;
}

function analyzeProject(rootDir: string): AnalysisResult {
  const files = collectFiles(rootDir);
  const routes: RouteRecord[] = [];
  const mounts: MountRecord[] = [];
  const appNames = new Set<string>(['app']);
  const routerNames = new Set<string>();

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    let ast: t.File;
    try {
      ast = parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining', 'objectRestSpread']
      });
    } catch (err) {
      continue;
    }

    traverse(ast, {
      Function(path) {
        path.node.params.forEach(param => {
          if (t.isIdentifier(param)) {
            if (param.name === 'app') {
              const binding = path.scope.getBinding(param.name);
              if (binding) binding.setData('expressType', 'app');
              appNames.add(param.name);
            }
            if (param.name === 'router') {
              const binding = path.scope.getBinding(param.name);
              if (binding) binding.setData('expressType', 'router');
              routerNames.add(param.name);
            }
          }
        });
      },
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id)) return;
        const name = path.node.id.name;
        const init = path.node.init;
        if (t.isCallExpression(init)) {
          if (t.isIdentifier(init.callee, { name: 'express' })) {
            const binding = path.scope.getBinding(name);
            if (binding) binding.setData('expressType', 'app');
            appNames.add(name);
          }
          if (t.isMemberExpression(init.callee)) {
            if (t.isIdentifier(init.callee.object, { name: 'express' }) && t.isIdentifier(init.callee.property, { name: 'Router' })) {
              const binding = path.scope.getBinding(name);
              if (binding) binding.setData('expressType', 'router');
              routerNames.add(name);
            }
          }
        }
      },
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.property)) return;
        const method = callee.property.name;
        if (!t.isIdentifier(callee.object)) return;
        const targetName = callee.object.name;
        const binding = path.scope.getBinding(targetName);
        const bindingType = binding?.getData('expressType') || (appNames.has(targetName) ? 'app' : routerNames.has(targetName) ? 'router' : null);
        if (!bindingType) return;

        if (method === 'use') {
          const args = path.node.arguments;
          let prefix = '';
          let startIndex = 0;
          if (args.length && (t.isStringLiteral(args[0]) || (t.isTemplateLiteral(args[0]) && args[0].expressions.length === 0))) {
            prefix = t.isStringLiteral(args[0]) ? args[0].value : args[0].quasis.map(q => q.value.raw).join('');
            startIndex = 1;
          }
          for (let i = startIndex; i < args.length; i++) {
            const arg = args[i];
            if (t.isIdentifier(arg)) {
              const argBinding = path.scope.getBinding(arg.name);
              const type = argBinding?.getData('expressType') || (routerNames.has(arg.name) ? 'router' : null);
              if (type === 'router') {
                mounts.push({ parent: targetName, child: arg.name, prefix: prefix || '/' });
              }
            }
          }
          return;
        }

        const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'all'];
        if (!httpMethods.includes(method)) return;

        const argPaths = path.get('arguments');
        const literalPaths = extractPaths(path.node.arguments[0] as any);
        const middlewares: string[] = [];
        let handlerNode: t.Function | null = null;
        for (let i = 1; i < argPaths.length; i++) {
          const argPath = argPaths[i];
          if (argPath.isFunctionExpression() || argPath.isArrowFunctionExpression()) {
            handlerNode = argPath.node as t.Function;
            break;
          }
          if (argPath.isIdentifier()) {
            middlewares.push(argPath.node.name);
          } else if (argPath.isMemberExpression()) {
            const text = path.get('arguments.' + i).toString();
            middlewares.push(text);
          }
        }

        routes.push({
          objectName: targetName,
          methods: [method.toUpperCase()],
          paths: literalPaths.length ? literalPaths : [{ value: '[dynamic]', dynamic: true }],
          file: file.replace(`${rootDir}${path.sep}`, ''),
          loc: path.node.loc || null,
          middlewares,
          handlerNode
        });
      }
    });
  }

  function resolvePrefixes(name: string, visited = new Set<string>()): string[] {
    if (visited.has(name)) return ['/'];
    visited.add(name);
    const relevant = mounts.filter(m => m.child === name);
    if (!relevant.length) {
      if (appNames.has(name) || name === 'app') return ['/'];
      return ['/'];
    }
    const prefixes: string[] = [];
    for (const mount of relevant) {
      const parents = resolvePrefixes(mount.parent, visited);
      parents.forEach(parent => {
        const base = parent === '/' ? '' : parent.replace(/\/$/, '');
        const prefix = mount.prefix === '/' ? '' : mount.prefix.replace(/\/$/, '');
        const combined = `${base}${prefix.startsWith('/') ? prefix : `/${prefix}`}`.replace(/\/+/g, '/');
        prefixes.push(combined || '/');
      });
    }
    return prefixes.length ? prefixes : ['/'];
  }

  const linkEdges: LinkEdge[] = [];
  const linkRegex = /<(a|form)\b[^>]*(?:href|action)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const getFormRegex = /<form\b[^>]*method\s*=\s*["']get["'][^>]*action\s*=\s*["']([^"']+)["'][^>]*>/gi;

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(code))) {
      const href = match[3];
      if (href && href.startsWith('/')) {
        linkEdges.push({ source: file.replace(`${rootDir}${path.sep}`, ''), target: normalizeLinkTarget(href) });
      }
    }
    while ((match = getFormRegex.exec(code))) {
      const action = match[1];
      if (action && action.startsWith('/')) {
        linkEdges.push({ source: file.replace(`${rootDir}${path.sep}`, ''), target: normalizeLinkTarget(action) });
      }
    }
  }

  const expandedRoutes: AnalysisResult['routes'] = [];
  for (const route of routes) {
    const prefixes = resolvePrefixes(route.objectName);
    const handlerInfo = analyzeHandlers(route);
    for (const method of route.methods) {
      for (const pathEntry of route.paths) {
        prefixes.forEach(prefix => {
          const full = joinPaths(prefix === '/' ? '' : prefix, pathEntry.value);
          expandedRoutes.push({
            ...route,
            method,
            isPage: handlerInfo.isPage,
            isApi: handlerInfo.isApi,
            fullPaths: [full]
          });
        });
      }
    }
  }

  return { routes: expandedRoutes, links: linkEdges };
}

function aggregateLinks(links: LinkEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  links.forEach(edge => {
    const key = normalizeLinkTarget(edge.target);
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key)!.add(edge.source);
  });
  return map;
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[i + 1]);
      i++;
    }
  }
  const { routes, links } = analyzeProject(root);
  const linkMap = aggregateLinks(links);

  const pageRoutes = routes.filter(r => r.isPage);
  const apiRoutes = routes.filter(r => r.isApi);
  const orphanRoutes = pageRoutes.filter(route => {
    const target = route.fullPaths[0];
    const inbound = linkMap.get(target);
    return !inbound || inbound.size === 0;
  });

  const nearOrphans = pageRoutes.filter(route => {
    const target = route.fullPaths[0];
    const inbound = linkMap.get(target);
    return inbound && inbound.size === 1;
  });

  const summary = {
    total_routes: routes.length,
    page_routes: pageRoutes.length,
    api_routes: apiRoutes.length,
    orphans: orphanRoutes.length,
    near_orphans: nearOrphans.length
  };

  const output = {
    summary,
    routes: routes.map(r => ({
      method: r.method,
      path: r.fullPaths[0],
      file: r.file,
      isPage: r.isPage,
      isApi: r.isApi,
      middlewares: r.middlewares
    })),
    links: Array.from(linkMap.entries()).map(([target, sources]) => ({
      target,
      sources: Array.from(sources)
    })),
    orphans: orphanRoutes.map(r => ({ method: r.method, path: r.fullPaths[0], file: r.file })),
    near_orphans: nearOrphans.map(r => ({ method: r.method, path: r.fullPaths[0], file: r.file }))
  };

  console.log(JSON.stringify(output, null, 2));
  if (orphanRoutes.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
