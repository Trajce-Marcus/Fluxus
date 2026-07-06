// @fluxus/dsl — FluxScript grammar, interpreter, and schema-aware validator.
// Phase 1: expressions + queries. See docs/DSL_SPEC.md and docs/GRAMMAR.md.

export { lex } from './lexer';
export { parseExpression } from './parser';
export { evaluateExpression, evaluateAst, FluxRuntimeError } from './evaluator';
export { FluxSyntaxError } from './errors';
export { TokenType, KEYWORDS } from './tokens';
export { FkPointer, DEFAULT_QUOTAS } from './host';
export type { Token } from './tokens';
export type { DslRecord, RecordsHost, EvalHost, Quotas } from './host';
export type * from './ast';
