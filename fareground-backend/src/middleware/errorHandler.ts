import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError';
import { isProduction } from '../config/env';

/** 404 handler - runs when no route matched the request. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

/**
 * The ONE place where errors become HTTP responses.
 *
 * Express recognises this as an error handler purely because it takes four
 * arguments - do not remove `_next` even though it is unused.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // 1. Invalid request body / params, caught by our zod schemas.
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    });
    return;
  }

  // 2. Errors we threw on purpose, with a status we chose.
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  // 3. Anything else is a bug. Log the details for us, tell the client nothing
  //    useful - error messages are a classic source of information leaks.
  console.error('[error] Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  });
}
