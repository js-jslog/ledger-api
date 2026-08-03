// NOTE: an `eslint.config.ts` file requires the `jiti` package to be installed
// or ESLint 10 refuses to start. `.mjs` avoids that dependency entirely.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'probe/00-compose', 'eslint.config.mjs'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The invariant §3 delegates to mechanisation instead of the human checklist.
      '@typescript-eslint/no-floating-promises': 'error',

      // Express decides a function is an error handler by fn.length === 4, so the
      // unused fourth parameter is load-bearing. The default no-unused-vars rule
      // reports it, and the obvious "fix" -- deleting the parameter -- silently
      // demotes the error handler to ordinary middleware and reinstates the
      // stack-trace leak probe 02 demonstrates. Underscore-prefixed arguments are
      // exempted so the linter cannot advise breaking the app.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Probes deliberately poke at `any` and at knowingly-wrong types, and
    // supertest types `res.body` as `any`, so asserting on a response body is
    // unavoidably "unsafe" by these rules. Narrowed to the probe tree so the
    // src/ tree keeps the full strictness.
    files: ['probe/**'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
)
