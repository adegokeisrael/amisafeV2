/**
 * utils/pseudo-id.js
 *
 * Generates and rotates a pseudonymous reporter ID.
 * The ID is:
 *   - Never linked to any real identity (no email, phone, or device fingerprint)
 *   - Rotated every 30 days so cross-session linkability is limited
 *   - Stored only in chrome.storage.local (not synced across devices)
 *
 * Format: "ami_<16 random hex chars>_<epoch-day>"
 * Example: "ami_3f9a2c1b4d8e7a06_20123"
 */

const STORAGE_KEY   = 'amisafe_pseudo_id';
const ROTATION_DAYS = 30;

/**
 * Returns the current pseudonymous reporter ID, generating or rotating as needed.
 * @returns {Promise<string>}
 */
export async function generatePseudoId() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const record = stored[STORAGE_KEY];

  const todayEpochDay = Math.floor(Date.now() / 86_400_000);

  if (record) {
    const { id, createdDay } = record;
    const age = todayEpochDay - createdDay;

    // Reuse if within rotation window
    if (age < ROTATION_DAYS) return id;
  }

  // Generate new ID
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  const hex         = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const id          = `ami_${hex}_${todayEpochDay}`;

  await chrome.storage.local.set({ [STORAGE_KEY]: { id, createdDay: todayEpochDay } });
  return id;
}

/**
 * Force immediate rotation of the pseudonymous ID.
 * Callable by the user via settings if they want a fresh identity now.
 * @returns {Promise<string>} new ID
 */
export async function rotatePseudoId() {
  await chrome.storage.local.remove(STORAGE_KEY);
  return generatePseudoId();
}
