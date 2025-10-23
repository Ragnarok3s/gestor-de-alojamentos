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
  ignorePatterns: ['node_modules/**', 'public/**', 'legacy/_archive/**', 'reports/**', 'coverage/**'],
  overrides: [
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
    'no-unreachable': 'error'
  }
};
