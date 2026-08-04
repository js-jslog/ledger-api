// Deliberately `.mjs` rather than `.ts`: an `eslint.config.ts` requires `jiti` to
// be installed or ESLint 10 aborts at startup. One fewer dependency for a config
// file that gains nothing from being typechecked.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

import resultBindingMustHaveRzSuffix from './eslint-rules/result-binding-must-have-rz-suffix.mjs'

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },

  js.configs.recommended,

  // Type-aware linting, not just syntactic. This is the whole reason `typescript`
  // is pinned to the 6 line in package.json: typescript-eslint declares
  // `typescript@">=4.8.4 <6.1.0"` and hard-aborts on TS 7 rather than warning, so
  // a bare `pnpm add -D typescript` would silently leave this project with no
  // type-aware rules at all. `no-floating-promises` is the one that matters — it
  // is the only mechanical owner of "every promise is awaited".
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Already enabled by the preset above. Restated because it is the mechanical
      // owner of "every promise is awaited", and a rule carrying an invariant should
      // be visible here rather than inherited silently. If it ever reports as
      // redundant, the preset has dropped it, which is the thing worth noticing.
      '@typescript-eslint/no-floating-promises': 'error',

      // An underscore prefix marks a parameter as deliberately unused. Without it,
      // the linter reports such a parameter and offers deletion as the fix — which
      // is wrong wherever a function's arity is part of its contract, because
      // removing the parameter changes what the function is.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: ['**/*.ts'],
    plugins: {
      local: { rules: { 'result-binding-must-have-rz-suffix': resultBindingMustHaveRzSuffix } },
    },
    rules: {
      'local/result-binding-must-have-rz-suffix': 'error',
    },
  },

  // Config files and any other plain JS are outside the TypeScript project, so
  // the type-aware rules have no type information to work from.
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
