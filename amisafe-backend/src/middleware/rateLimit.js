// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Rate limiting middleware
// ═══════════════════════════════════════════════════════════════
import rateLimit from 'express-rate-limit';

/** Strict limit for report submissions — prevents spam campaigns. */
export const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_REPORTS || '20'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many reports submitted from this IP. Please wait 15 minutes.' },
});

/** Lighter limit for the public dashboard endpoint. */
export const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_DASHBOARD || '60'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please slow down.' },
});

/** Partner API limit — generous, keyed by API key when available. */
export const partnerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.apiKey?.id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Rate limit exceeded for this API key.' },
});
