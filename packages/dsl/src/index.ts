// @fluxus/dsl — FluxScript grammar, interpreter, and schema-aware validator.
// Phase 1: expressions + queries. Phase 2: scripts (statements, mutations,
// transactional hooks, named functions). See docs/DSL_SPEC.md and docs/GRAMMAR.md.

export { lex } from './lexer';
export { parseExpression, parseScript, parseFunction } from './parser';
export { evaluateExpression, evaluateAst, executeScript, FluxRuntimeError } from './evaluator';
export type { ScriptOptions, ScriptResult } from './evaluator';
export { validateExpression, validateScript, validateFunction, lintSchema } from './validator';
export type { DslSchema, TypeSchema, FieldSchema, Diagnostic, ValidateOptions, ScriptValidateOptions } from './validator';
export { FluxSyntaxError, FluxFailError } from './errors';
export { TokenType, KEYWORDS } from './tokens';
export { FkPointer, DEFAULT_QUOTAS } from './host';
export type { Token } from './tokens';
export type { DslRecord, RecordsHost, RecordsMutationHost, MutationOp, EvalHost, Quotas } from './host';
export type * from './ast';
