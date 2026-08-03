// NOTE: an `eslint.config.ts` file requires the `jiti` package to be installed
// or ESLint 10 refuses to start. `.mjs` avoids that dependency entirely.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'probe/00-compose'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The invariant §3 delegates to mechanisation instead of the human checklist.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
)
