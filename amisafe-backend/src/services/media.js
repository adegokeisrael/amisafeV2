// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Media processing service
//  Strips EXIF from images, hashes all files, uploads to R2.
//  Binary data NEVER goes into PostgreSQL — only keys + hashes.
// ═══════════════════════════════════════════════════════════════
import crypto  from 'crypto';
import sharp   from 'sharp';
import { uploadToR2 } from './r2.js';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildKey(pseudoId, type, hash, ext) {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `extension/${date}/${pseudoId}/${type}-${hash.slice(0, 8)}.${ext}`;
}

/**
 * Process a screenshot from the Chrome extension.
 * Input is a base64 data-URL (from chrome.tabs.captureVisibleTab)
 * or a raw PNG/JPEG Buffer from multer.
 *
 * Steps:
 *  1. Decode base64 if needed
 *  2. Re-encode via sharp (strips all EXIF/metadata)
 *  3. Resize to max 1600px wide (keeps file size reasonable)
 *  4. Compute SHA-256 fingerprint
 *  5. Upload to R2
 *
 * @param {Buffer|string} input   Buffer or base64 data-URL
 * @param {string} pseudoId
 * @returns {{ key, hash, sizeBytes, url }}
 */
export async function processScreenshot(input, pseudoId) {
  let raw;
  if (typeof input === 'string') {
    // Strip the data:image/...;base64, prefix
    const b64 = input.replace(/^data:[^;]+;base64,/, '');
    raw = Buffer.from(b64, 'base64');
  } else {
    raw = input;
  }

  // Re-encode — sharp strips EXIF by default
  const clean = await sharp(raw)
    .rotate()   // honour EXIF orientation before stripping it
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const hash = sha256(clean);
  const key  = buildKey(pseudoId, 'screenshot', hash, 'jpg');
  const url  = await uploadToR2(key, clean, 'image/jpeg');

  return { key, hash, sizeBytes: clean.length, url };
}

/**
 * Process a voice note (WebM audio from the extension recorder).
 * Audio is stored as-is — hashed for tamper-evidence but not re-encoded.
 *
 * @param {Buffer} buffer
 * @param {string} pseudoId
 * @param {string} mimeType   e.g. 'audio/webm'
 * @returns {{ key, hash, sizeBytes, url }}
 */
export async function processVoiceNote(buffer, pseudoId, mimeType = 'audio/webm') {
  const hash = sha256(buffer);
  const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const key  = buildKey(pseudoId, 'voice', hash, ext);
  const url  = await uploadToR2(key, buffer, mimeType);

  return { key, hash, sizeBytes: buffer.length, url };
}

/**
 * Process a 10-second video clip (WebM from tabCapture).
 *
 * @param {Buffer} buffer
 * @param {string} pseudoId
 * @param {string} mimeType
 * @returns {{ key, hash, sizeBytes, url }}
 */
export async function processVideoClip(buffer, pseudoId, mimeType = 'video/webm') {
  const hash = sha256(buffer);
  const key  = buildKey(pseudoId, 'video', hash, 'webm');
  const url  = await uploadToR2(key, buffer, mimeType);

  return { key, hash, sizeBytes: buffer.length, url };
}

/**
 * Route incoming multer files to the correct processor.
 * Returns an array of processed evidence objects.
 *
 * @param {object} files   req.files from multer
 * @param {string} pseudoId
 * @returns {Promise<Array<{ type, key, hash, sizeBytes }>>}
 */
export async function processEvidenceFiles(files, pseudoId) {
  const results = [];

  if (files?.screenshot?.[0]) {
    const f = files.screenshot[0];
    const r = await processScreenshot(f.buffer, pseudoId);
    results.push({ type: 'screenshot', ...r });
  }

  if (files?.voice_note?.[0]) {
    const f = files.voice_note[0];
    const r = await processVoiceNote(f.buffer, pseudoId, f.mimetype);
    results.push({ type: 'voice', ...r });
  }

  if (files?.video_clip?.[0]) {
    const f = files.video_clip[0];
    const r = await processVideoClip(f.buffer, pseudoId, f.mimetype);
    results.push({ type: 'video', ...r });
  }

  return results;
}
