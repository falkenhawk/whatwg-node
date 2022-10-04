// Will be removed after v14 reaches EOL
export class PonyfillAbortError extends Error {
  constructor(reason?: any) {
    super('The operation was aborted.', {
      cause: reason,
    });
    this.name = 'AbortError';
  }

  get reason() {
    return this.cause;
  }
}
