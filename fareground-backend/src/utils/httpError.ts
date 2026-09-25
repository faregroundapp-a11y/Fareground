/**
 * An error that carries an HTTP status code.
 *
 * Anywhere in the app you can simply:
 *     throw new HttpError(400, 'Not enough Walk Points.');
 * and the central error handler turns it into a clean JSON response.
 */
export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';

    // Required so `instanceof HttpError` works when targeting ES5/ES2015+.
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}
