module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script'
  },
  ignorePatterns: ['node_modules/**', 'public/**', 'legacy/_archive/**', 'reports/**', 'coverage/**', 'vendor/**'],
  overrides: [
    {
      files: ['src/**/controllers/**/*.{js,ts}', 'src/**/views/**/*.{js,ts}'],
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
      files: ['src/**/repositories/**/*.{js,ts}'],
      rules: {
        'no-restricted-syntax': 'off'
      }
    },
    {
      files: ['src/modules/**/*.js'],
      env: {
        browser: true
      }
    },
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true,
        node: true
      }
    },
    {
      files: ['scripts/**/*.js'],
      env: {
        node: true
      }
    }
  ],
  rules: {
    'no-unused-vars': 'off',
    'no-undef': 'error',
    'no-unreachable': 'error',
    'import/no-unresolved': 'off',
    'import/no-dynamic-require': 'off'
  }
};
