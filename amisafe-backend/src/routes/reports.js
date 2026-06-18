// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — POST /api/reports
//  Receives evidence from the Chrome extension, processes files,
//  and writes a pseudonymous report to PostgreSQL.
// ═══════════════════════════════════════════════════════════════
import { Router }  from 'express';
import multer      from 'multer';
import { insertReport, findReportByPseudoId } from '../services/db.js';
import { processEvidenceFiles }               from '../services/media.js';
import { deleteFromR2 }                       from '../services/r2.js';
import { validateReport, normalisePlatform }  from '../utils/helpers.js';
import { reportLimiter }                      from '../middleware/rateLimit.js';

const router = Router();

// Multer: memory storage (we process files before writing anywhere)
// Max sizes: screenshot 8MB, voice 10MB, video 30MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 30 * 1024 * 1024, files: 3 },
  fileFilter(_req, file, cb) {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
      'video/webm', 'video/mp4',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

const evidenceFields = upload.fields([
  { name: 'screenshot', maxCount: 1 },
  { name: 'voice_note', maxCount: 1 },
  { name: 'video_clip', maxCount: 1 },
]);

// ── POST /api/reports ─────────────────────────────────────────
// Body (multipart/form-data):
//   pseudo_id       string   required  e.g. "AMF-x7k2p9"
//   harm_type       string   required  deepfake|misinfo|financial|harassment|bias|other
//   privacy_level   string   required  private|anon|partner
//   language        string   optional  en|sw|ha|yo|am|ig|zu|om  (default: en)
//   platform_url    string   optional  full URL or domain
//   feedback        string   optional  free-text account ≤2000 chars
//   tags            string   optional  JSON array e.g. '["Deepfake","Healthcare AI"]'
//   screenshot      file     optional  image/jpeg|png|webp
//   voice_note      file     optional  audio/webm|ogg|mpeg
//   video_clip      file     optional  video/webm|mp4
//
// Response 201:
//   { success: true, ref: "AMF-x7k2p9", submitted_at: "..." }

router.post('/', reportLimiter, evidenceFields, async (req, res) => {
  const body = req.body;

  // 1. Validate
  const { valid, errors } = validateReport(body);
  if (!valid) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const uploadedKeys = [];

  try {
    // 2. Process and upload evidence files
    const evidenceResults = await processEvidenceFiles(req.files, body.pseudo_id);
    uploadedKeys.push(...evidenceResults.map((r) => r.key));

    const evidence_types  = evidenceResults.map((r) => r.type);
    const evidence_keys   = evidenceResults.map((r) => r.key);
    const evidence_hashes = evidenceResults.map((r) => r.hash);
    const evidence_sizes  = evidenceResults.map((r) => r.sizeBytes);

    // 3. Parse tags (sent as JSON string from the extension)
    let tags = [];
    if (body.tags) {
      try { tags = JSON.parse(body.tags); } catch { /* ignore bad JSON */ }
    }
    if (!Array.isArray(tags)) tags = [];
    tags = tags.slice(0, 10).map(String); // cap + sanitise

    // 4. Write to DB (within a try — if this fails, clean up R2)
    const report = await insertReport({
      pseudo_id:       body.pseudo_id,
      source:          'extension',
      harm_type:       body.harm_type,
      platform_domain: normalisePlatform(body.platform_url),
      language:        body.language || 'en',
      tags,
      feedback:        body.feedback || null,
      evidence_types,
      evidence_keys,
      evidence_hashes,
      evidence_sizes,
      privacy_level:   body.privacy_level,
    });

    return res.status(201).json({
      success:      true,
      ref:          report.pseudo_id,
      submitted_at: report.submitted_at,
    });

  } catch (err) {
    // Rollback: delete any R2 objects already uploaded
    if (uploadedKeys.length > 0) {
      await Promise.allSettled(uploadedKeys.map((k) => deleteFromR2(k)));
    }
    console.error('Report submission error:', err.message);
    return res.status(500).json({ error: 'Report could not be saved. Please try again.' });
  }
});

// ── GET /api/reports/:ref ─────────────────────────────────────
// Status check for a previously submitted report.
// Returns only non-identifying metadata (harm_type, submitted_at).

router.get('/:ref', async (req, res) => {
  const ref = (req.params.ref || '').toUpperCase();

  if (!/^AMF-[A-Z0-9]{6}$/.test(ref)) {
    return res.status(400).json({ error: 'Invalid reference format' });
  }

  try {
    const report = await findReportByPseudoId(ref);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    return res.json({
      ref:            report.pseudo_id,
      harm_type:      report.harm_type,
      language:       report.language,
      has_evidence:   report.evidence_types?.length > 0,
      privacy_level:  report.privacy_level,
      submitted_at:   report.submitted_at,
      status:         'received',
    });
  } catch (err) {
    console.error('Report lookup error:', err.message);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

export default router;
