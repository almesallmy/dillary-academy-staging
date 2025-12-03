// api/middleware/security.js
// Centralized security headers (Helmet + strict CSP) for API routes.
// Allows Clerk, Google Fonts, Cloudflare Turnstile (Smart CAPTCHA), and flag SVGs.

import helmet from "helmet";

const security = [
  helmet({
    // Strict-Transport-Security
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },

    // X-Frame-Options
    frameguard: { action: "deny" },

    // Content-Security-Policy
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"],

        // Allow external form submits (Google Forms) & Clerk
        "form-action": [
          "'self'",
          "https://docs.google.com",
          "https://forms.gle",
          "https://clerk.dillaracademy.org"
        ],

        // Scripts needed for Clerk + Cloudflare Turnstile (Smart CAPTCHA)
        "script-src": [
          "'self'",
          "https://clerk.dillaracademy.org",
          "https://challenges.cloudflare.com"
        ],

        // Inline styles are often required by UI libs; allow Google Fonts CSS
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],

        // Fonts from Google Fonts
        "font-src": ["'self'", "https://fonts.gstatic.com"],

        // Images (self, data/blobs, Clerk assets, and flag CDN)
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://clerk.dillaracademy.org",
          "https://flagcdn.com"
        ],

        // XHR / fetch to Clerk APIs
        "connect-src": [
          "'self'",
          "https://clerk.dillaracademy.org",
          "https://api.clerk.com"
        ],

        // Frames for Turnstile + optional Google Forms embeds + Clerk
        "frame-src": [
          "'self'",
          "https://challenges.cloudflare.com",
          "https://docs.google.com",
          "https://clerk.dillaracademy.org"
        ],

        // Upgrade any stray http links
        "upgrade-insecure-requests": [],
      },
    },

    // Referrer-Policy
    referrerPolicy: { policy: "no-referrer" },

    // COEP/CORP defaults can break third-party iframes; keep safe defaults:
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }),

  // Minimal Permissions-Policy
  (req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), geolocation=(), microphone=(), interest-cohort=()"
    );
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    next();
  },
];

export default security;