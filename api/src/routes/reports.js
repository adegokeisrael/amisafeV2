/**
 * routes/reports.js
 *
 * POST /api/reports  — Submit a harm report
 * GET  /api/reports/stats — Aggregate stats (public, no individual data)
 */

import { Router }    from 'express';
import { z }         from 'zod';
import { v4 as uuid } from 'uuid';
import { pool }      from '../db/pool.js';
import { anonymise } from '../services/anonymiser.js';
import { classify }  from '../services/classifier.js';
import { enqueueForClustering } from '../services/pattern-detector.js';
import taxonomy      from '../../../shared/harm-taxonomy.json' assert { type: 'json' };

const router = Router();

// ─── Validation schema ────────────────────────────────────────────────────────
const VALID_CATEGORIES = taxonomy.categories.map(c => c.id);
const VALID_LANGS      = taxonomy.supportedLanguages;
const VALID_DISCLOSURE = taxonomy.disclosureLevels;
const VALID_SEVERITY   = taxonomy.severityLevels;

const ReportSchema = z.object({
  pseudoId:        z.string().min(10).max(60),
  timestamp:       z.string().datetime(),
  url:             z.string().url().optional().or(z.literal('')),
  platform:        z.string().max(60).optional(),
  lang:            z.enum(VALID_LANGS),
  category:        z.enum(VALID_CATEGORIES),
  severity:        z.enum(VALID_SEVERITY).optional().default('medium'),
  disclosure:      z.enum(VALID_DISCLOSURE),
  textNote:        z.string().max(2000).optional(),
  voiceTranscript: z.string().max(3000).optional(),
  screenshot:      z.string().max(1_500_000).optional(), // base64, max ~1MB
});

// ─── POST /api/reports ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  // 1. Validate
  const parsed = ReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid report data', details: parsed.error.flatten() });
  }

  const data = parsed.data;

  // 2. Private reports should never reach the server — sanity check
  if (data.disclosure === 'private') {
    return res.status(400).json({ error: 'Private reports must not be transmitted.' });
  }

  // 3. Anonymise text fields — strip names, phone numbers, addresses
  const [textAnon, transcriptAnon] = await Promise.all([
    data.textNote        ? anonymise(data.textNote)        : Promise.resolve(null),
    data.voiceTranscript ? anonymise(data.voiceTranscript) : Promise.resolve(null),
  ]);

  // 4. AI-assisted severity classification if not supplied
  let severity = data.severity;
  if (textAnon || transcriptAnon) {
    const predicted = await classify(textAnon || transcriptAnon, data.category);
    if (predicted) severity = predicted;
  }

  // 5. Domain-only from URL (never store full URL)
  let urlDomain = null;
  try {
    if (data.url) urlDomain = new URL(data.url).hostname.replace(/^www\./, '');
  } catch { /* ignore invalid URLs */ }

  // 6. Country code from IP geolocation — IP is NOT stored
  const countryCode = req.headers['cf-ipcountry'] || // Cloudflare
                      req.headers['x-country-code'] || null;

  // 7. Screenshot → object storage (simplified; production uses S3/R2)
  let screenshotKey  = null;
  let screenshotHash = null;
  if (data.screenshot) {
    screenshotKey  = `screenshots/${uuid()}`;
    screenshotHash = await hashBase64(data.screenshot);
    // TODO: upload data.screenshot to object storage at screenshotKey
    // await uploadToStorage(screenshotKey, data.screenshot);
  }

  // 8. Persist to database
  const reportId = uuid();
  await pool.query(
    `INSERT INTO reports (
       id, pseudo_id, created_at, report_date,
       category, severity, disclosure, lang,
       screenshot_key, screenshot_hash, has_voice, has_text,
       text_anon, transcript_anon, platform, url_domain, country_code
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
     )`,
    [
      reportId,
      data.pseudoId,
      data.timestamp,
      data.timestamp.slice(0, 10),
      data.category,
      severity,
      data.disclosure,
      data.lang,
      screenshotKey,
      screenshotHash,
      !!data.voiceTranscript,
      !!data.textNote,
      textAnon,
      transcriptAnon,
      data.platform || urlDomain || 'Unknown',
      urlDomain,
      countryCode,
    ]
  );

  // 9. Enqueue for async pattern detection
  await enqueueForClustering(reportId);

  res.status(201).json({ reportId, status: 'received' });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function hashBase64(b64) {
  const buf = Buffer.from(b64, 'base64');
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Buffer.from(hashBuf).toString('hex');
}

export default router;
