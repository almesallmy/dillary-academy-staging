// api/middleware/auth.js
// Purpose: Centralize authentication/authorization for Express routes.
//
// - requireAuth: ensures a valid Clerk session (401 if not signed in)
// - requireAdminOrInstructor: allows only users with privilege "admin" or "instructor" (403 otherwise)
//
// Prereqs:
//   - CLERK_SECRET_KEY must be set in your environment (backend).
//   - The signed-in Clerk user must have a matching users.clerkId document in Mongo.

import { ClerkExpressRequireAuth } from '@clerk/express';
import User from '../schemas/User.js';

// Enforce that a request has a valid Clerk session.
// Attaches `req.auth` with { userId, ... } when valid.
export const requireAuth = ClerkExpressRequireAuth();

export async function requireAdminOrInstructor(req, res, next) {
  try {
    const clerkId = req.auth?.userId;              // set by ClerkExpressRequireAuth
    if (!clerkId) return res.status(401).json({ message: 'Unauthorized' });

    // Look up the app-level role in Mongo via Clerk user ID.
    const me = await User.findOne({ clerkId }).select('privilege').lean();
    if (!me || !['admin', 'instructor'].includes(me.privilege)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  } catch (err) {
    console.error('requireAdminOrInstructor error:', err);
    return res.status(500).json({ message: 'Auth check failed' });
  }
}