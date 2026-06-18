/**
 * utils/i18n.js
 *
 * Lightweight internationalisation helper.
 * Loads locale JSON files from _locales/ and provides a simple t() function.
 * Falls back to English for any missing keys.
 */

let strings = {};
let fallback = {};

/**
 * Load a locale. Call once on startup.
 * @param {string} lang - BCP-47 language code e.g. "ha", "yo", "en"
 */
export async function setLang(lang) {
  try {
    const [localeRes, fallbackRes] = await Promise.all([
      fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`)),
      fetch(chrome.runtime.getURL('_locales/en/messages.json')),
    ]);
    strings  = localeRes.ok  ? await localeRes.json()  : {};
    fallback = fallbackRes.ok ? await fallbackRes.json() : {};
  } catch {
    strings  = {};
    fallback = {};
  }
}

/**
 * Translate a key, with optional variable substitution.
 * @param {string} key
 * @param {Record<string,string>} [vars]
 * @returns {string}
 */
export function i18n(key, vars = {}) {
  const raw = strings[key]?.message || fallback[key]?.message || key;
  return Object.entries(vars).reduce(
    (str, [k, v]) => str.replace(new RegExp(`\\$${k}\\$`, 'g'), v),
    raw
  );
}
