// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Partner API key auth middleware
// ═══════════════════════════════════════════════════════════════
import { findApiKey, touchApiKey } from '../services/db.js';
import { sha256 } from '../utils/helpers.js';

/**
 * Middleware: require a valid Bearer API key in the Authorization header.
 * Attaches req.apiKey = { id, label, scopes } on success.
 *
 * Usage:
 *   router.get('/partner/reports', requireApiKey, handler);
 *
 * To generate a key and store it:
 *   const raw  = crypto.randomBytes(32).toString('hex');   // show to partner ONCE
 *   const hash = sha256(raw);                              // store in api_keys table
 *   INSERT INTO api_keys (key_hash, label) VALUES (hash, 'Paradigm Initiative');
 */
export async function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing API key. Send: Authorization: Bearer <key>',
    });
  }

  const rawKey  = authHeader.slice(7).trim();
  const keyHash = sha256(rawKey);

  try {
    const apiKey = await findApiKey(keyHash);

    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (apiKey.revoked) {
      return res.status(403).json({ error: 'API key has been revoked' });
    }

    // Update last_used_at asynchronously (don't block the request)
    touchApiKey(apiKey.id).catch(console.error);

    req.apiKey = apiKey;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Authentication service unavailable' });
  }
}

/**
 * Check that the authenticated key has a specific scope.
 * Usage: requireScope('export:bulk')
 */
export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return res.status(403).json({
        error: `This key does not have the '${scope}' scope`,
      });
    }
    next();
  };
}
