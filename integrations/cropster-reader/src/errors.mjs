export class ReaderError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = "ReaderError";
    this.code = code;
    this.status = status;
  }
}

export function safeFailure(error) {
  return error instanceof ReaderError
    ? { status: error.status, code: error.code }
    : { status: 503, code: "CROPSTER_UNAVAILABLE" };
}
