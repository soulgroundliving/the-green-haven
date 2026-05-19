// Minimal flat-config ESLint baseline.
//
// Two rules, warn-level only:
//   - no-console  — catches stray console.log in production browser paths
//   - eqeqeq      — flag loose equality; null/undefined exception kept
//
// Warn-only so committing existing code doesn't explode and the gate stays
// non-blocking until a dedicated backfill pass. Two scopes:
//   1. Browser code (shared/, api/) — both rules apply.
//   2. Node code (functions/, tools/) — only eqeqeq; console.log is legitimate
//      for CLI scripts + Cloud Function structured logs.
//
// Run: `npm run lint`. The `lint` script is added in package.json.
// CI / pre-commit integration is out of scope for this initial setup.

export default [
  {
    ignores: [
      'node_modules/**',
      'functions/node_modules/**',
      'functions/lib/**',
      'shared/tailwind.css',
      'shared/tailwind.input.css',
      '.vercel/**',
      'dist/**',
      'build/**',
      '**/*.html',
      '**/*.css',
      '**/*.json',
    ],
  },
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
    },
    rules: {
      'no-console': 'warn',
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
    },
  },
  {
    // Vercel serverless routes — ES modules (`import` / `export default`).
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'warn',
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['functions/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      // tools/ + functions/ legitimately use console for CLI output and CF logs.
      // Enforce eqeqeq only.
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
    },
  },
];
