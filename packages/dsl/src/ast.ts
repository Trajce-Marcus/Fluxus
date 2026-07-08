// AST for FluxScript expressions (GRAMMAR.md §3–§4) and statements (§5).
// Identifier and member names are stored lowercased (the language is case-insensitive).

export type BinaryOp =
  | 'or' | 'and'
  | '=' | '!=' | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/' | '%';

export interface Position {
  line: number;
  col: number;
}

export type Expr =
  | NumberLit
  | StringLit
  | BooleanLit
  | NullLit
  | Ident
  | ListLit
  | ObjectLit
  | Unary
  | Binary
  | InExpr
  | BetweenExpr
  | LikeExpr
  | IsNullExpr
  | Member
  | Call
  | IndexExpr;

export interface NumberLit { kind: 'number'; value: number; pos: Position }
export interface StringLit { kind: 'string'; value: string; pos: Position }
export interface BooleanLit { kind: 'boolean'; value: boolean; pos: Position }
export interface NullLit { kind: 'null'; pos: Position }
export interface Ident { kind: 'ident'; name: string; pos: Position }
export interface ListLit { kind: 'list'; items: Expr[]; pos: Position }
export interface ObjectLit { kind: 'object'; entries: ObjectEntry[]; pos: Position }
export interface ObjectEntry { key: string; value: Expr }
export interface Unary { kind: 'unary'; op: 'not' | '-'; operand: Expr; pos: Position }
export interface Binary { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: Position }
export interface InExpr { kind: 'in'; negated: boolean; target: Expr; source: Expr; pos: Position }
export interface BetweenExpr { kind: 'between'; negated: boolean; target: Expr; lower: Expr; upper: Expr; pos: Position }
export interface LikeExpr { kind: 'like'; negated: boolean; target: Expr; pattern: Expr; pos: Position }
export interface IsNullExpr { kind: 'isnull'; negated: boolean; target: Expr; pos: Position }
export interface Member { kind: 'member'; object: Expr; name: string; pos: Position }
export interface Call { kind: 'call'; callee: Expr; args: Arg[]; pos: Position }
export interface IndexExpr { kind: 'index'; object: Expr; index: Expr; pos: Position }

export interface Arg {
  /** Alias in select/object position: `title: code` */
  alias?: string;
  value: Expr;
  /** Sort direction in orderBy position: `name desc` */
  direction?: 'asc' | 'desc';
}

// ── Statements (scripts tier — GRAMMAR.md §5) ───────────────────────────────────

export type Stmt =
  | LetStmt
  | AssignStmt
  | IfStmt
  | ForEachStmt
  | QueueStmt
  | ReturnStmt
  | ExprStmt;

export interface LetStmt { kind: 'let'; name: string; value: Expr; pos: Position }
/** Assignment in statement position: `x = expr` / `obj.field = expr` (lvalue = ident { . member }). */
export interface AssignStmt { kind: 'assign'; target: Ident | Member; value: Expr; pos: Position }
export interface IfStmt { kind: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[]; pos: Position }
export interface ForEachStmt { kind: 'foreach'; name: string; source: Expr; body: Stmt[]; pos: Position }
/** `queue <service call>` — fire-and-forget, dispatched only after the hook's commit. */
export interface QueueStmt { kind: 'queue'; call: Call; pos: Position }
export interface ReturnStmt { kind: 'return'; value: Expr | null; pos: Position }
export interface ExprStmt { kind: 'exprstmt'; expr: Expr; pos: Position }

/** A script entry point: `{ statement }` (hooks, headless workflows). */
export interface Script { kind: 'script'; body: Stmt[] }

/** A named function declaration (DSL_SPEC §8). */
export interface FunctionDecl {
  kind: 'functiondecl';
  name: string;
  params: string[];
  body: Stmt[];
  pos: Position;
}
