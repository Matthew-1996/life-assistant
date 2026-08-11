export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorPayload(error, requestId) {
  if (error instanceof HttpError) {
    return {
      request_id: requestId,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.status >= 500,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  return {
    request_id: requestId,
    error: {
      code: "internal_error",
      message: "The request could not be completed.",
      retryable: true,
    },
  };
}
