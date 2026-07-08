/**
 * Raised by `fail('message')` in a script (DSL_SPEC §6): the activity is
 * rejected and nothing persists. The message is user-facing, verbatim.
 */
export class FluxFailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FluxFailError';
  }
}

export class FluxSyntaxError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'FluxSyntaxError';
    this.line = line;
    this.col = col;
  }
}
