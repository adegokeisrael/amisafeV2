/**
 * utils/crypto.js
 *
 * AES-256-GCM encryption for local-only report storage.
 * The key is derived from a device-scoped secret stored in chrome.storage.local.
 * Nothing encrypted here is ever transmitted without the user's explicit consent.
 */

const ALGO      = 'AES-GCM';
const KEY_LEN   = 256;
const STORAGE_K = 'amisafe_device_key';

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Retrieve or generate the device encryption key.
 * The raw key bytes are persisted in chrome.storage.local (never synced).
 */
async function getDeviceKey() {
  const stored = await chrome.storage.local.get(STORAGE_K);

  if (stored[STORAGE_K]) {
    const rawKey = Uint8Array.from(stored[STORAGE_K]);
    return crypto.subtle.importKey('raw', rawKey, { name: ALGO }, false, ['encrypt', 'decrypt']);
  }

  // First run — generate and persist a new key
  const key    = await crypto.subtle.generateKey({ name: ALGO, length: KEY_LEN }, true, ['encrypt', 'decrypt']);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  await chrome.storage.local.set({ [STORAGE_K]: Array.from(rawKey) });
  return key;
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string for local storage.
 * Returns a base64 string of the form: iv_b64:ciphertext_b64
 *
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
export async function encryptLocal(plaintext) {
  const key = await getDeviceKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const enc = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    enc.encode(plaintext)
  );

  const ivB64         = btoa(String.fromCharCode(...iv));
  const ciphertextB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  return `${ivB64}:${ciphertextB64}`;
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypt a value produced by encryptLocal.
 *
 * @param {string} payload - "iv_b64:ciphertext_b64"
 * @returns {Promise<string>} - original plaintext
 */
export async function decryptLocal(payload) {
  const key = await getDeviceKey();
  const [ivB64, ciphertextB64] = payload.split(':');

  const iv         = Uint8Array.from(atob(ivB64),         c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));

  const plainBuffer = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuffer);
}

// ─── Utility: SHA-256 hash ────────────────────────────────────────────────────

/**
 * Produce a hex SHA-256 hash of a string.
 * Used for tamper-evident report fingerprinting.
 *
 * @param {string} input
 * @returns {Promise<string>}
 */
export async function sha256(input) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
