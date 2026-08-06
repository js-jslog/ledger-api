import path from 'node:path'

import { RuleTester } from 'eslint'
// `parser` is re-exported by `typescript-eslint`, deliberately rather than importing
// `@typescript-eslint/parser` directly: pnpm's strict layout does not hoist, so a
// transitive dependency is not resolvable, and declaring it would add a direct
// dependency that has to be defensible in the README table for no gain.
import { describe, it } from 'vitest'
import { parser } from 'typescript-eslint'

import rule from './result-binding-must-have-rz-suffix.mjs'

// RuleTester emits through whatever `describe`/`it` it is handed. vitest's globals are
// off in this project, so wire them explicitly — otherwise RuleTester runs its
// assertions at import time and vitest reports a file with no tests.
RuleTester.describe = describe
RuleTester.it = it

// Neverthrow-shaped declarations, so the rule's
// type query has real types to read without a
// dependency on `neverthrow` itself: `Result` is
// an alias to the `Ok | Err` union, the rest are
// nominal.
const TYPES = `
declare class Ok<T, E> {}
declare class Err<T, E> {}
type Result<T, E> = Ok<T, E> | Err<T, E>;
declare class ResultAsync<T, E> {}
declare function ok<T>(v: T): Ok<T, never>;
declare function err<E>(e: E): Err<never, E>;
declare function okAsync<T>(v: T): ResultAsync<T, never>;
declare function makeResultRz(): Result<number, Error>;
declare function makeResultAsyncRzA(): ResultAsync<number, Error>;
declare function makeNumber(): number;
declare function makeMixed(): Result<number, Error> | ResultAsync<number, Error>;
`

const withTypes = (code) => `${TYPES}\n${code}`

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      // The virtual file RuleTester compiles is not inside this project's
      // `tsconfig.json` `include`, so it lands in the default project — which is
      // what `allowDefaultProject` permits. `tsconfigRootDir` is the repository
      // root because that is where the `tsconfig.json` serving as the default
      // project lives.
      projectService: { allowDefaultProject: ['*.ts'] },
      tsconfigRootDir: path.join(import.meta.dirname, '..'),
    },
  },
})

ruleTester.run('result-binding-must-have-rz-suffix', rule, {
  valid: [
    // Result / ResultAsync unions carry Rz / RzA.
    { code: withTypes(`const fooRz = makeResultRz();`) },
    { code: withTypes(`const fooRzA = makeResultAsyncRzA();`) },
    { code: withTypes(`const fooRz: Result<number, Error> = makeResultRz();`) },
    // A literal Ok / Err may name its variant …
    { code: withTypes(`const fooOk = ok(1);`) },
    { code: withTypes(`const fooErr = err(new Error());`) },
    // … or use the general Rz suffix.
    { code: withTypes(`const fooRz = ok(1);`) },
    { code: withTypes(`const fooRz = err(new Error());`) },
    { code: withTypes(`const fooRzA = okAsync(1);`) },
    // Result-typed parameters, suffixed.
    {
      code: withTypes(`function f(pRz: Result<number, Error>) { return pRz; }`),
    },
    { code: withTypes(`const f = (pOk: Ok<number, Error>) => pOk;`) },
    // Not a Result -> ignored.
    { code: withTypes(`const foo = makeNumber();`) },
    { code: withTypes(`const foo = 5;`) },
    { code: withTypes(`let x;`) },
    // Destructuring is out of scope.
    { code: withTypes(`const { a } = makeResultRz();`) },
    // PINS A KNOWN GAP RATHER THAN BLESSING IT. A union mixing sync and async hits
    // `classify`'s ambiguity guard, which returns null, so this binding is accepted
    // under any name at all. It sits in `valid` because that is the only way
    // RuleTester can record current behaviour — not because an unmarked Result-ish
    // binding is wanted. If the guard is ever made to pick a side, this case is what
    // will tell you. See docs/conventions.md, "What the rule does NOT cover".
    { code: withTypes(`const totallyUnmarked = makeMixed();`) },
  ],
  invalid: [
    {
      code: withTypes(`const foo = makeResultRz();`),
      errors: [{ messageId: 'suffixResult' }],
    },
    {
      code: withTypes(`const foo = makeResultAsyncRzA();`),
      errors: [{ messageId: 'suffixResultAsync' }],
    },
    {
      code: withTypes(`const foo = ok(1);`),
      errors: [{ messageId: 'suffixOk' }],
    },
    {
      code: withTypes(`const foo = err(new Error());`),
      errors: [{ messageId: 'suffixErr' }],
    },
    {
      // Sync suffix on an async binding.
      code: withTypes(`const fooRz = makeResultAsyncRzA();`),
      errors: [{ messageId: 'suffixResultAsync' }],
    },
    {
      // Async suffix on a sync (Ok) binding.
      code: withTypes(`const fooRzA = ok(1);`),
      errors: [{ messageId: 'suffixOk' }],
    },
    {
      // A Result union may not borrow Ok.
      code: withTypes(`const fooOk = makeResultRz();`),
      errors: [{ messageId: 'suffixResult' }],
    },
    {
      // Result-typed parameter.
      code: withTypes(`function f(p: Result<number, Error>) { return p; }`),
      errors: [{ messageId: 'suffixResult' }],
    },
  ],
})
