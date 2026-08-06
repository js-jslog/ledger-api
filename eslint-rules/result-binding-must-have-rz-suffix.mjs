// A Result / ResultAsync binding carries a
// legibility suffix so error flow is visible
// at a glance: `…Rz` (sync) / `…RzA` (async).
// A binding whose type is literally `Ok` or
// `Err` may instead announce that variant with
// `…Ok` / `…Err` (a `…Rz` still passes, an
// Ok/Err being a Result). See docs/conventions.md,
// "Naming: `Rz` marks a `Result`".
//
// Type-aware: the binding's resolved type is
// the whole classification. No producer lists,
// no factory-name exclusion, no callee-name
// heuristics — the type checker has already
// worked out whether a call, a chained
// combinator (`.andThen`, `.map`, …) or an
// annotation yields a Result, so the rule just
// reads the answer. A factory such as
// `validatorFor` is covered for free: it returns
// the function it makes, whose type is not a
// Result.
//
// WHAT THIS RULE IS NOT. It does not detect a
// Result that is created and discarded — that is
// R17, it needs a rule that inspects expression
// statements rather than bindings, and this is
// not that rule. It also cannot see a missing
// underscore: `getAppIdRz` passes, because the
// producer/`_` half of the convention is a claim
// about a function's return type rather than
// about the type of the binding itself.

// Classify a ts.Type into a neverthrow variant,
// or null (not a Result). The Result /
// ResultAsync alias or symbol decides directly;
// a concrete `Ok` / `Err` is reported as such,
// so its own suffix is allowed. A bare union is
// unwrapped: an Ok/Err mix is a Result, a mixed
// sync/async union is ambiguous (null), nullish
// members are ignored.
const classify = (type) => {
  const alias = type.aliasSymbol && type.aliasSymbol.getName()
  if (alias === 'ResultAsync') return 'resultAsync'
  if (alias === 'Result') return 'result'
  const sym = (type.getSymbol && type.getSymbol()) || type.symbol
  const name = sym ? (sym.getName ? sym.getName() : sym.name) : ''
  if (name === 'ResultAsync') return 'resultAsync'
  if (name === 'Result') return 'result'
  if (name === 'Ok') return 'ok'
  if (name === 'Err') return 'err'
  if (type.isUnion && type.isUnion()) {
    let seen = null
    for (const member of type.types) {
      const kind = classify(member)
      if (!kind) continue
      if (seen && seen !== kind) {
        // Ok/Err/Result members together are
        // still a Result; other mixes ambiguous.
        const sync = (k) => k === 'ok' || k === 'err' || k === 'result'
        if (sync(seen) && sync(kind)) {
          seen = 'result'
          continue
        }
        return null
      }
      seen = kind
    }
    return seen
  }
  return null
}

const endsRz = (name) => /Rz$/.test(name)
const endsRzA = (name) => /RzA$/.test(name)

// Per variant: does the name carry an allowed
// suffix, and which message names it.
const EXPECTATION = {
  resultAsync: { ok: endsRzA, messageId: 'suffixResultAsync' },
  result: { ok: endsRz, messageId: 'suffixResult' },
  ok: { ok: (n) => endsRz(n) || /Ok$/.test(n), messageId: 'suffixOk' },
  err: { ok: (n) => endsRz(n) || /Err$/.test(n), messageId: 'suffixErr' },
}

const DOC = 'docs/conventions.md, "Naming: `Rz` marks a `Result`"'

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'require a Result/ResultAsync binding to carry the …Rz / …RzA legibility suffix (…Ok / …Err allowed for a literal Ok / Err)',
      category: 'Suggestions',
      recommended: false,
    },
    schema: [],
    messages: {
      suffixResultAsync: `A ResultAsync binding should be suffixed …RzA so error flow is visible at a glance (${DOC}).`,
      suffixResult: `A Result binding should be suffixed …Rz so error flow is visible at a glance (${DOC}).`,
      suffixOk: `An Ok binding should be suffixed …Ok or …Rz so error flow is visible at a glance (${DOC}).`,
      suffixErr: `An Err binding should be suffixed …Err or …Rz so error flow is visible at a glance (${DOC}).`,
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices
    if (!services || !services.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error(
        'result-binding-must-have-rz-suffix is type-aware and needs type ' +
          'information. Set parserOptions.project (or projectService) for ' +
          'the files this rule runs on.',
      )
    }
    const checker = services.program.getTypeChecker()

    // A plain `Identifier` name binding only:
    // destructuring patterns are out of scope, as
    // attribution to a single Result is unclear.
    const check = (idNode) => {
      if (!idNode || idNode.type !== 'Identifier') return
      const tsNode = services.esTreeNodeToTSNodeMap.get(idNode)
      if (!tsNode) return
      const variant = classify(checker.getTypeAtLocation(tsNode))
      if (!variant) return
      const expectation = EXPECTATION[variant]
      if (!expectation.ok(idNode.name)) {
        context.report({ node: idNode, messageId: expectation.messageId })
      }
    }

    return {
      VariableDeclarator(node) {
        check(node.id)
      },
      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression'(node) {
        for (const param of node.params) check(param)
      },
    }
  },
}
