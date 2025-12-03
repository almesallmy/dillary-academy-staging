// api/middleware/rate-limit.js
// Centralized rate-limiting for API routes.
// - apiLimiter: general throttle for all /api traffic
// - burstLimiter: stricter throttle for sensitive endpoints
//
// Notes:
// * app.set('trust proxy', 1) must be enabled in index.js so
//   rate limits use the correct client IP behind Vercel/Proxies.
// * Tunable via env vars without code changes.

import rateLimit from "express-rate-limit";

// Helpers to parse numeric ENV with fallbacks
function n(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : fallback;
}

// Defaults (can be overridden by env)
const WINDOW_MS = n(process.env.RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000); // 5 minutes
const API_MAX = n(process.env.RATE_LIMIT_API_MAX, 300);               // 300 reqs / window / IP
const BURST_WINDOW_MS = n(process.env.RATE_LIMIT_BURST_WINDOW_MS, 60 * 1000); // 1 minute
const BURST_MAX = n(process.env.RATE_LIMIT_BURST_MAX, 30);            // 30 reqs / window / IP

const commonOptions = {
  standardHeaders: true, // add RateLimit-* headers
  legacyHeaders: false,
  message: { message: "Too many requests, please slow down." },
  // Don’t count CORS preflights or health checks (works whether mounted at / or /api)
  skip: (req) => {
    if (req.method === "OPTIONS") return true;
    const p = req.path || "";
    const o = req.originalUrl || "";
    return p === "/health" || o.endsWith("/api/health");
  },
  keyGenerator: (req) => {
    // Trust proxy must be enabled in the app for req.ip to be the client, not Vercel
    return req.ip || req.headers["x-forwarded-for"] || "unknown";
  },
};

export const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: API_MAX,
  ...commonOptions,
});

export const burstLimiter = rateLimit({
  windowMs: BURST_WINDOW_MS,
  max: BURST_MAX,
  ...commonOptions,
});