// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Utilities
// ═══════════════════════════════════════════════════════════════
import crypto from 'crypto';

/**
 * Generate a short pseudonymous report ID — e.g. "AMF-x7k2p9".
 * Collision probability is negligible for pilot scale (<10k reports).
 */
export function generatePseudoId() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes  = crypto.randomBytes(6);
  let   suffix = '';
  for (const b of bytes) suffix += chars[b % chars.length];
  return `AMF-${suffix}`;
}

/** SHA-256 a string and return the hex digest. */
export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Normalise a free-text platform name to a canonical domain.
 * "whatsapp" → "whatsapp.com"   "https://www.facebook.com/post/123" → "facebook.com"
 */
const PLATFORM_MAP = {
  whatsapp: 'whatsapp.com', wa: 'whatsapp.com',
  facebook: 'facebook.com', fb: 'facebook.com',
  twitter: 'twitter.com',   x: 'twitter.com',
  tiktok: 'tiktok.com',
  instagram: 'instagram.com', ig: 'instagram.com',
  youtube: 'youtube.com',   yt: 'youtube.com',
  telegram: 'telegram.org',
  google: 'google.com',
  linkedin: 'linkedin.com',
};

export function normalisePlatform(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (PLATFORM_MAP[cleaned]) return PLATFORM_MAP[cleaned];
  const m = cleaned.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/);
  if (m) return m[1];
  return cleaned.slice(0, 100); // cap length
}

/**
 * Validate an incoming report payload.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
const VALID_HARM_TYPES    = ['deepfake','misinfo','financial','harassment','bias','other'];
const VALID_PRIVACY_LEVELS = ['private','anon','partner'];
const VALID_LANGUAGES     = ['en','sw','ha','yo','am','ig','zu','om'];

export function validateReport(body) {
  const errors = [];

  if (!body.pseudo_id || !/^AMF-[a-z0-9]{6}$/.test(body.pseudo_id)) {
    errors.push('pseudo_id must match AMF-xxxxxx format');
  }
  if (!VALID_HARM_TYPES.includes(body.harm_type)) {
    errors.push(`harm_type must be one of: ${VALID_HARM_TYPES.join(', ')}`);
  }
  if (!VALID_PRIVACY_LEVELS.includes(body.privacy_level)) {
    errors.push(`privacy_level must be one of: ${VALID_PRIVACY_LEVELS.join(', ')}`);
  }
  if (body.language && !VALID_LANGUAGES.includes(body.language)) {
    errors.push(`language must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }
  if (body.feedback && body.feedback.length > 2000) {
    errors.push('feedback must be 2000 characters or fewer');
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}
