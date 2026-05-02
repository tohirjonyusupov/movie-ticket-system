class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} [code]       — mashinada o'qiladigan kod, masalan 'SEAT_LOCKED'
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg, code)  { return new AppError(msg, 400, code || 'BAD_REQUEST'); }
  static unauthorized(msg)      { return new AppError(msg, 401, 'UNAUTHORIZED'); }
  static forbidden(msg)         { return new AppError(msg, 403, 'FORBIDDEN'); }
  static notFound(msg)          { return new AppError(msg, 404, 'NOT_FOUND'); }
  static conflict(msg, code)    { return new AppError(msg, 409, code || 'CONFLICT'); }
  static unprocessable(msg)     { return new AppError(msg, 422, 'UNPROCESSABLE'); }
}

module.exports = AppError;
