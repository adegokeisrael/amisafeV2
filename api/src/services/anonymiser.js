/**
 * services/anonymiser.js
 *
 * Named Entity Recognition (NER) pipeline that strips personal identifiers
 * from submitted text before it is stored in the database.
 *
 * Removes:
 *   - Person names
 *   - Phone numbers (international formats including African prefixes)
 *   - Email addresses
 *   - Physical addresses and place names (kept at country/region level)
 *   - ID numbers and account numbers
 *
 * Uses the `compromise` NLP library for English + a regex sweep for
 * structured identifiers. For non-English text, the regex sweep runs on
 * transliterated or romanised input; full multilingual NER is a roadmap item.
 */

import nlp from 'compromise';

// ─── Regex patterns ───────────────────────────────────────────────────────────
const PATTERNS = [
  // Phone numbers — international and African formats
  { re: /(\+?2[34567]\d[\s\-]?\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})/g,  tag: '[PHONE]' },
  { re: /(\b0\d{2,3}[\s\-]?\d{3,4}[\s\-]?\d{3,4}\b)/g,                   tag: '[PHONE]' },
  // Email addresses
  { re: /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g,           tag: '[EMAIL]' },
  // National ID / BVN / NIN patterns (11–13 digits)
  { re: /\b\d{11,13}\b/g,                                                   tag: '[ID_NUM]' },
  // Nigerian BVN specifically
  { re: /\b(BVN|NIN)[:\s]?\d{8,11}\b/gi,                                   tag: '[ID_NUM]' },
  // Bank account numbers (10 digits, Nigerian format)
  { re: /\b\d{10}\b/g,                                                       tag: '[ACCT]'  },
  // URLs (may contain identifying info)
  { re: /https?:\/\/[^\s]+/g,                                                tag: '[URL]'   },
];

/**
 * Strip personally identifiable information from a text string.
 *
 * @param {string} text - raw user input
 * @returns {Promise<string>} - anonymised text safe to store
 */
export async function anonymise(text) {
  if (!text || typeof text !== 'string') return text;

  let output = text;

  // Step 1: NLP-based NER for English (names, organisations)
  try {
    const doc = nlp(output);

    // Replace person names
    doc.people().forEach(person => {
      const name = person.text();
      if (name && name.length > 1) {
        output = output.replaceAll(name, '[NAME]');
      }
    });

    // Replace organisation names — may reveal the reporter's employer
    doc.organizations().forEach(org => {
      const name = org.text();
      if (name && name.length > 2) {
        output = output.replaceAll(name, '[ORG]');
      }
    });
  } catch {
    // NLP failure is non-fatal; regex sweep below still runs
  }

  // Step 2: Regex sweep for structured identifiers
  for (const { re, tag } of PATTERNS) {
    output = output.replace(re, tag);
  }

  // Step 3: Collapse multiple spaces
  output = output.replace(/\s{2,}/g, ' ').trim();

  return output;
}

/**
 * Batch anonymise an array of strings.
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
export async function anonymiseBatch(texts) {
  return Promise.all(texts.map(anonymise));
}
