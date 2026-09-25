import { Router } from 'express';
import { z } from 'zod';
import { googleSignIn, loginUser, registerUser } from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';

export const authRouter = Router();

/**
 * zod schemas describe what a valid request body looks like. `.parse()` either
 * returns a fully typed object or throws a ZodError, which our error handler
 * turns into a 400 with a helpful list of problems. This means a handler never
 * has to write `if (!req.body.email)` by hand.
 */
const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(32, 'Username must be at most 32 characters.')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers and underscores.'),
  email: z.string().trim().email('Please provide a valid email address.').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be at most 128 characters.'),
});

const loginSchema = z.object({
  email: z.string().trim().email('Please provide a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

/** POST /auth/register - create an account and return a token. */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(input);

    // 201 Created is the correct status for "a new thing now exists".
    res.status(201).json(result);
  }),
);

/** POST /auth/login - exchange email + password for a token. */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(input);

    res.status(200).json(result);
  }),
);

const googleSchema = z.object({
  idToken: z.string().min(20, 'Missing Google ID token.').max(5_000),
});

/** POST /auth/google - sign in (or sign up) with a Google ID token. */
authRouter.post(
  '/google',
  asyncHandler(async (req, res) => {
    const { idToken } = googleSchema.parse(req.body);
    const result = await googleSignIn(idToken);
    res.status(result.created ? 201 : 200).json(result);
  }),
);
