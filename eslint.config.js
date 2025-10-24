const nodeGlobals = {
  __dirname: 'readonly',
  __filename: 'readonly',
  exports: 'readonly',
  module: 'readonly',
  require: 'readonly',
  process: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  FormData: 'readonly'
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly'
};

const jestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  jest: 'readonly'
};

module.exports = [
  {
    ignores: ['node_modules/**', 'public/**', 'legacy/**', 'reports/**', 'coverage/**', 'vendor/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...nodeGlobals
      }
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'import/no-unresolved': 'off',
      'import/no-dynamic-require': 'off'
    }
  },
  {
    files: ['src/**/controllers/**/*.js', 'src/**/views/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program:has(Literal[value=/\\b(SELECT|INSERT|UPDATE|DELETE)\\b/])',
          message: 'SQL inline proibido: mover para repositories/.',
        },
      ],
    },
  },
  {
    files: ['src/**/repositories/**/*.js'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['src/modules/**/*.js'],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        ...browserGlobals,
        __DEFAULT_PANE__: 'readonly',
        __FEATURE_PRESETS__: 'readonly',
        parseExtrasSubmission: 'readonly',
        ValidationError: 'readonly',
        renderExtrasManagementPage: 'readonly'
      }
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        ...jestGlobals,
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly'
      }
    }
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...nodeGlobals
      }
    }
  }
];
