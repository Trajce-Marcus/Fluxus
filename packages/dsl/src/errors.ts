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
