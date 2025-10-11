class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.details = details;
  }
}

class ConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
    this.details = details;
  }
}

function isKnownError(err) {
  return err instanceof ValidationError || err instanceof ConflictError;
}

module.exports = {
  ValidationError,
  ConflictError,
  isKnownError
};
