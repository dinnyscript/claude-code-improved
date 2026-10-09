const globals = {
  // browser / extension
  window: 'readonly', document: 'readonly', chrome: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', Blob: 'readonly', confirm: 'readonly', importScripts: 'readonly', globalThis: 'readonly',
  // node (UMD wrappers and tests)
  module: 'writable', require: 'readonly', __dirname: 'readonly', process: 'readonly', Buffer: 'readonly',
};

module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
];
