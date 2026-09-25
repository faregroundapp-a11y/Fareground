/**
 * TypeScript "declaration merging": we add our own field to Express's Request
 * type so that `req.userId` is known throughout the codebase.
 * The auth middleware is what actually fills it in.
 */
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
