#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require.extensions['.ts'] = require.extensions['.js'];

const tests = [];
const suiteStack = [];
const hookStack = [createHookBucket()];

function createHookBucket() {
  return { beforeEach: [], afterEach: [] };
}

function gatherBeforeEachHooks() {
  const hooks = [];
  hookStack.forEach(bucket => {
    hooks.push(...bucket.beforeEach);
  });
  return hooks;
}

function gatherAfterEachHooks() {
  const hooks = [];
  for (let i = hookStack.length - 1; i >= 0; i -= 1) {
    hooks.push(...hookStack[i].afterEach);
  }
  return hooks;
}

function registerTest(name, fn) {
  const fullName = [...suiteStack, name].join(' ');
  tests.push({
    name: fullName,
    fn,
    beforeEach: gatherBeforeEachHooks(),
    afterEach: gatherAfterEachHooks()
  });
}

function describe(name, fn) {
  suiteStack.push(name);
  hookStack.push(createHookBucket());
  try {
    fn();
  } finally {
    hookStack.pop();
    suiteStack.pop();
  }
}

function it(name, fn) {
  registerTest(name, fn);
}

function formatValue(value) {
  if (typeof value === 'string') return `"${value}"`;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

function buildMatchers(received, inverted = false) {
  function assertResult(pass, message) {
    if (inverted ? pass : !pass) {
      throw new Error(message);
    }
  }

  function matchError(error, expected) {
    if (!expected) return true;
    if (expected instanceof RegExp) {
      return expected.test(error.message);
    }
    if (typeof expected === 'function') {
      return error instanceof expected;
    }
    const expectedMessage = String(expected);
    return error && String(error.message).includes(expectedMessage);
  }

  const api = {
    toBe(expected) {
      const pass = received === expected;
      assertResult(pass, `Expected ${formatValue(received)} ${inverted ? 'not ' : ''}to be ${formatValue(expected)}`);
    },
    toEqual(expected) {
      const { deepStrictEqual } = require('node:assert');
      let pass = true;
      try {
        deepStrictEqual(received, expected);
      } catch (err) {
        pass = false;
      }
      assertResult(pass, `Expected ${formatValue(received)} ${inverted ? 'not ' : ''}to equal ${formatValue(expected)}`);
    },
    toStrictEqual(expected) {
      api.toEqual(expected);
    },
    toMatchObject(expected) {
      const { deepStrictEqual } = require('node:assert');
      let pass = true;
      try {
        if (received == null || typeof received !== 'object') {
          throw new Error('Received value is not an object');
        }
        const subset = {};
        Object.keys(expected || {}).forEach(key => {
          subset[key] = received[key];
        });
        deepStrictEqual(subset, expected);
      } catch (err) {
        pass = false;
      }
      assertResult(pass, `Expected ${formatValue(received)} ${inverted ? 'not ' : ''}to match object ${formatValue(expected)}`);
    },
    toHaveLength(expected) {
      const length = received != null ? received.length : undefined;
      const pass = length === expected;
      assertResult(pass, `Expected value with length ${expected}, received ${length}`);
    },
    toBeTruthy() {
      const pass = !!received;
      assertResult(pass, `Expected ${formatValue(received)} ${inverted ? 'not ' : ''}to be truthy`);
    },
    toBeFalsy() {
      const pass = !received;
      assertResult(pass, `Expected ${formatValue(received)} ${inverted ? 'not ' : ''}to be falsy`);
    },
    toBeDefined() {
      const pass = received !== undefined;
      assertResult(pass, `Expected value to ${inverted ? 'not ' : ''}be defined`);
    },
    toBeUndefined() {
      const pass = received === undefined;
      assertResult(pass, `Expected value to ${inverted ? 'not ' : ''}be undefined`);
    },
    toBeNull() {
      const pass = received === null;
      assertResult(pass, `Expected value to ${inverted ? 'not ' : ''}be null`);
    },
    toContain(expected) {
      let pass = false;
      if (typeof received === 'string') {
        pass = received.includes(expected);
      } else if (Array.isArray(received)) {
        pass = received.some(item => {
          const { deepStrictEqual } = require('node:assert');
          try {
            deepStrictEqual(item, expected);
            return true;
          } catch (err) {
            return false;
          }
        });
      }
      assertResult(pass, `Expected value to ${inverted ? 'not ' : ''}contain ${formatValue(expected)}`);
    },
    toContainEqual(expected) {
      api.toContain(expected);
    },
    toBeInstanceOf(expected) {
      const pass = received instanceof expected;
      assertResult(pass, `Expected value to ${inverted ? 'not ' : ''}be instance of ${expected && expected.name}`);
    },
    toThrow(expected) {
      if (typeof received !== 'function') {
        throw new Error('Received value must be a function to use toThrow');
      }
      let thrown = false;
      let error;
      try {
        received();
      } catch (err) {
        thrown = true;
        error = err;
      }
      const pass = thrown && matchError(error, expected);
      const expectedMessage = expected ? ` ${typeof expected === 'function' ? expected.name : String(expected)}` : '';
      assertResult(pass, `Expected function to ${inverted ? 'not ' : ''}throw${expectedMessage}`);
    }
  };

  Object.defineProperty(api, 'not', {
    enumerable: true,
    get() {
      return buildMatchers(received, !inverted);
    }
  });

  return api;
}

function beforeEach(fn) {
  hookStack[hookStack.length - 1].beforeEach.push(fn);
}

function afterEach(fn) {
  hookStack[hookStack.length - 1].afterEach.push(fn);
}

global.describe = describe;
global.it = it;
global.test = it;
global.expect = received => buildMatchers(received, false);
global.beforeEach = beforeEach;
global.afterEach = afterEach;

global.beforeAll = fn => fn();
global.afterAll = fn => fn();

function resolveRoots(rootDir, roots = []) {
  if (!roots.length) {
    return [rootDir];
  }
  return roots.map(entry => entry.replace(/<rootDir>/g, rootDir));
}

function globToRegExp(pattern) {
  let regexSource = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        const after = pattern[i + 2];
        if (after === '/') {
          regexSource += '(?:.*/)?';
          i += 2;
          continue;
        }
        regexSource += '.*';
        i += 1;
        continue;
      }
      regexSource += '[^/]*';
      continue;
    }
    if (char === '?') {
      regexSource += '.';
      continue;
    }
    if ('\.[]{}()+^$|'.includes(char)) {
      regexSource += `\\${char}`;
      continue;
    }
    if (char === '\\') {
      regexSource += '\\';
      continue;
    }
    regexSource += char;
  }
  return new RegExp('^' + regexSource + '$');
}

function collectTestFiles({ rootDir, config }) {
  const matches = config.testMatch && config.testMatch.length ? config.testMatch : ['**/*.test.js', '**/*.spec.js'];
  const roots = resolveRoots(rootDir, config.roots || []);
  const patterns = matches.map(pattern => globToRegExp(pattern.replace(/<rootDir>/g, rootDir)));
  const files = [];

  function walk(currentPath) {
    let stats;
    try {
      stats = fs.statSync(currentPath);
    } catch (err) {
      return;
    }
    if (stats.isDirectory()) {
      const name = path.basename(currentPath);
      if (name === 'node_modules' || name === '.git') return;
      const entries = fs.readdirSync(currentPath);
      entries.forEach(entry => walk(path.join(currentPath, entry)));
      return;
    }
    if (!stats.isFile()) return;
    const rel = path.relative(rootDir, currentPath).split(path.sep).join('/');
    const isMatch = patterns.some(regex => regex.test(rel));
    if (isMatch) {
      files.push(currentPath);
    }
  }

  roots.forEach(root => walk(root));
  return files;
}

function loadConfig(rootDir) {
  const configPath = path.join(rootDir, 'jest.config.js');
  if (!fs.existsSync(configPath)) return {};
  try {
    return require(configPath);
  } catch (err) {
    console.error('Failed to load jest.config.js:', err.message);
    return {};
  }
}

async function run() {
  const rootDir = process.cwd();
  const config = loadConfig(rootDir);
  const testFiles = collectTestFiles({ rootDir, config });

  if (!testFiles.length) {
    console.log('No tests found.');
    return;
  }

  testFiles.forEach(file => {
    require(file);
  });

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const { name, fn, beforeEach: beforeHooks, afterEach: afterHooks } = test;
    let failedCurrent = false;
    try {
      for (const hook of beforeHooks) {
        const result = hook();
        if (result && typeof result.then === 'function') {
          await result;
        }
      }
      const result = fn();
      if (result && typeof result.then === 'function') {
        await result;
      }
      console.log(`\x1b[32m✓\x1b[0m ${name}`);
      passed += 1;
    } catch (err) {
      failedCurrent = true;
      console.log(`\x1b[31m✗\x1b[0m ${name}`);
      console.error(err && err.stack ? err.stack : err);
      failed += 1;
    } finally {
      for (const hook of afterHooks) {
        try {
          const result = hook();
          if (result && typeof result.then === 'function') {
            await result;
          }
        } catch (err) {
          if (!failedCurrent) {
            console.log(`\x1b[31m✗\x1b[0m ${name} (afterEach)`);
            console.error(err && err.stack ? err.stack : err);
            failed += 1;
            passed -= 1;
          }
        }
      }
    }
  }

  console.log(`\nTests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

run();
