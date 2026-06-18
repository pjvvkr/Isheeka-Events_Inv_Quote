// Lean ESLint config — correctness rules only, deliberately NO stylistic rules,
// so the output is signal (real bugs) not noise. The headline rule is
// `no-use-before-define` for variables: it statically catches the temporal-dead-zone
// crash class (e.g. a state/const referenced in an effect's dependency array before
// it's declared) that the Vite/esbuild build surfaces but the old in-browser Babel
// build silently swallowed. Run with: npm run lint
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'e2e/**', '*.config.js', '*.config.ts'] },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      // The crash-class catcher (variables only; functions/classes hoist fine and the
      // codebase relies on that for cross-referencing components).
      'no-use-before-define': ['warn', { functions: false, classes: false, variables: true }],
      // Cheap, high-confidence correctness rules — all real-bug signal.
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'getter-return': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
