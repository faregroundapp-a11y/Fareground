import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not understand `async` route handlers: if one of them rejects,
 * Express never finds out and the request hangs forever.
 *
 * Wrapping a handler in `asyncHandler` forwards any rejection to `next(error)`,
 * which lands in our central error handler.
 *
 *     router.post('/buy', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
