/**
 * services/classifier.js
 *
 * Predicts harm severity from anonymised report text.
 *
 * This is a rule-based v1 classifier using keyword scoring.
 * A fine-tuned multilingual model (mBERT or AfroXLMR) is the roadmap v2.
 *
 * Severity levels: low | medium | high | critical
 */

// Keywords that escalate severity — all lowercase, regex-safe
const SEVERITY_SIGNALS = {
  critical: [
    'child', 'minor', 'suicide', 'death', 'murder', 'rape', 'sexual assault',
    'nonconsensual', 'blackmail', 'extortion', 'bomb', 'weapon',
  ],
  high: [
    'deepfake', 'nude', 'naked', 'intimate', 'hospital', 'medical',
    'election', 'vote', 'police', 'arrest', 'fired', 'lost job',
    'bank', 'stolen', 'fraud', 'scam', 'lost money',
  ],
  medium: [
    'harassment', 'threat', 'hate', 'discriminat', 'bias', 'unfair',
    'misinformation', 'fake news', 'false', 'wrong',
  ],
  low: [
    'spam', 'annoying', 'weird', 'strange', 'confusing',
  ],
};

// Category-level baseline severity
const CATEGORY_BASELINE = {
  deepfake:          'high',
  misinformation:    'medium',
  discrimination:    'medium',
  harassment:        'high',
  financial_harm:    'high',
  health_misinfo:    'high',
  privacy_violation: 'high',
  other:             'low',
};

const LEVELS = ['low', 'medium', 'high', 'critical'];

/**
 * Predict severity for a piece of anonymised report text.
 *
 * @param {string|null} text - anonymised text or transcript
 * @param {string} category  - harm category ID
 * @returns {Promise<string>} - 'low' | 'medium' | 'high' | 'critical'
 */
export async function classify(text, category) {
  const baseline = CATEGORY_BASELINE[category] || 'medium';
  if (!text) return baseline;

  const lower = text.toLowerCase();
  let maxLevel = LEVELS.indexOf(baseline);

  for (const [level, keywords] of Object.entries(SEVERITY_SIGNALS)) {
    const levelIdx = LEVELS.indexOf(level);
    if (levelIdx <= maxLevel) continue;
    const matched = keywords.some(kw => lower.includes(kw));
    if (matched) maxLevel = levelIdx;
  }

  return LEVELS[maxLevel];
}
