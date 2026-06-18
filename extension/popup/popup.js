/**
 * AmiSafe Extension — Popup Controller
 * Manages the four-step report flow:
 *   Capture → Category → Privacy → Confirm
 */

import { stripExif }        from '../utils/exif-stripper.js';
import { encryptLocal }     from '../utils/crypto.js';
import { generatePseudoId } from '../utils/pseudo-id.js';
import { i18n, setLang }    from '../utils/i18n.js';
import taxonomy             from '../../shared/harm-taxonomy.json' assert { type: 'json' };

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  screenshot:      null,   // base64 png (exif-stripped)
  voiceBlob:       null,   // audio blob
  voiceTranscript: null,   // on-device transcript
  textNote:        '',
  category:        null,
  severity:        'medium',
  disclosure:      null,
  lang:            'en',
  pseudoId:        null,
  url:             '',
  platform:        '',
  timestamp:       null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const steps = {
  capture:  $('stepCapture'),
  category: $('stepCategory'),
  privacy:  $('stepPrivacy'),
  confirm:  $('stepConfirm'),
};

let mediaRecorder = null;
let audioChunks   = [];

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  state.pseudoId = await generatePseudoId();
  state.timestamp = new Date().toISOString();

  // Grab page URL and guess platform
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.url      = tab?.url || '';
  state.platform = detectPlatform(state.url);

  // Language from storage
  const stored = await chrome.storage.local.get('amisafe_lang');
  const lang = stored.amisafe_lang || navigator.language.slice(0, 2) || 'en';
  await switchLang(lang);

  buildCategoryGrid();
  bindEvents();
});

// ─── Language ────────────────────────────────────────────────────────────────
async function switchLang(lang) {
  state.lang = lang;
  await setLang(lang);
  await chrome.storage.local.set({ amisafe_lang: lang });
  applyI18n();
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = i18n(el.dataset.i18nPlaceholder);
  });
}

// ─── Category grid ───────────────────────────────────────────────────────────
const CATEGORY_ICONS = {
  deepfake:          '🎭',
  misinformation:    '📰',
  discrimination:    '⚖️',
  harassment:        '🚨',
  financial_harm:    '💸',
  health_misinfo:    '🏥',
  privacy_violation: '🔓',
  other:             '❓',
};

function buildCategoryGrid() {
  const grid = $('categoryGrid');
  grid.innerHTML = '';
  taxonomy.categories.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.dataset.id = cat.id;
    card.innerHTML = `
      <span class="cat-icon">${CATEGORY_ICONS[cat.id] || '❓'}</span>
      <span class="cat-label">${cat[state.lang] || cat.en}</span>
    `;
    card.addEventListener('click', () => selectCategory(cat.id, card));
    grid.appendChild(card);
  });
}

function selectCategory(id, cardEl) {
  document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  state.category = id;
  $('btnNextToPrivacy').disabled = false;
}

// ─── Event bindings ──────────────────────────────────────────────────────────
function bindEvents() {
  // Language selector
  $('langSelect').addEventListener('change', async e => {
    await switchLang(e.target.value);
    buildCategoryGrid(); // re-render labels in new language
  });

  // Screenshot
  $('btnScreenshot').addEventListener('click', captureScreenshot);

  // Voice
  $('btnRecord').addEventListener('click', startRecording);
  $('btnStopRecord').addEventListener('click', stopRecording);

  // Text
  $('textInput').addEventListener('input', () => {
    state.textNote = $('textInput').value.trim();
    updateCaptureNextBtn();
  });

  // Navigation
  $('btnNextToCategory').addEventListener('click', () => showStep('category'));
  $('btnNextToPrivacy').addEventListener('click', () => showStep('privacy'));
  $('btnBackToCapture').addEventListener('click', () => showStep('capture'));
  $('btnBackToCategory').addEventListener('click', () => showStep('category'));
  $('btnNewReport').addEventListener('click', resetFlow);

  // Disclosure
  document.querySelectorAll('input[name="disclosure"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.disclosure = e.target.value;
      document.querySelectorAll('.disclosure-card').forEach(c => c.classList.remove('selected'));
      e.target.closest('.disclosure-card').classList.add('selected');
      $('btnSubmit').disabled = false;
    });
  });

  // Submit
  $('btnSubmit').addEventListener('click', submitReport);
}

// ─── Screenshot capture ──────────────────────────────────────────────────────
async function captureScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 85 }, async dataUrl => {
    if (chrome.runtime.lastError) {
      console.error('Screenshot failed:', chrome.runtime.lastError);
      return;
    }
    // Strip EXIF metadata before storing
    const clean = await stripExif(dataUrl);
    state.screenshot = clean;

    $('previewImg').src = clean;
    $('screenshotPreview').classList.remove('hidden');
    updateCaptureNextBtn();
  });
}

// ─── Voice recording ─────────────────────────────────────────────────────────
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks   = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    state.voiceBlob = new Blob(audioChunks, { type: 'audio/webm' });
    $('voiceStatus').textContent = i18n('voiceRecorded');
    $('voiceStatus').classList.remove('hidden');

    // Request background worker to transcribe (Whisper via offscreen API)
    const arrayBuffer = await state.voiceBlob.arrayBuffer();
    chrome.runtime.sendMessage(
      { action: 'TRANSCRIBE_AUDIO', audio: Array.from(new Uint8Array(arrayBuffer)) },
      response => {
        if (response?.transcript) {
          state.voiceTranscript = response.transcript;
          $('voiceStatus').textContent = `📝 ${response.transcript.slice(0, 80)}…`;
        }
      }
    );
    updateCaptureNextBtn();
  };

  mediaRecorder.start();
  $('btnRecord').classList.add('hidden');
  $('btnStopRecord').classList.remove('hidden');
  $('voiceStatus').textContent = i18n('voiceRecording');
  $('voiceStatus').classList.remove('hidden');
}

function stopRecording() {
  mediaRecorder?.stop();
  mediaRecorder?.stream.getTracks().forEach(t => t.stop());
  $('btnStopRecord').classList.add('hidden');
  $('btnRecord').classList.remove('hidden');
}

// ─── Step navigation ─────────────────────────────────────────────────────────
function showStep(name) {
  Object.values(steps).forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
  steps[name].classList.remove('hidden');
  steps[name].classList.add('active');
}

function updateCaptureNextBtn() {
  const hasEvidence = state.screenshot || state.voiceBlob || state.textNote.length > 4;
  $('btnNextToCategory').disabled = !hasEvidence;
}

// ─── Report assembly & submission ────────────────────────────────────────────
async function submitReport() {
  $('btnSubmit').disabled = true;
  $('btnSubmit').textContent = i18n('btnSubmitting') || 'Submitting…';

  const report = {
    pseudoId:        state.pseudoId,
    timestamp:       state.timestamp,
    url:             state.url,
    platform:        state.platform,
    lang:            state.lang,
    category:        state.category,
    severity:        state.severity,
    disclosure:      state.disclosure,
    textNote:        state.textNote,
    voiceTranscript: state.voiceTranscript,
    screenshot:      state.disclosure === 'private' ? null : state.screenshot,
    // No name, email, device fingerprint stored or sent
  };

  if (state.disclosure === 'private') {
    // Encrypt and save locally only
    const encrypted = await encryptLocal(JSON.stringify(report));
    await chrome.storage.local.set({ [`report_${Date.now()}`]: encrypted });
    showConfirmation('local-' + state.pseudoId.slice(0, 8));
    return;
  }

  // Send to API
  try {
    const res = await fetch('https://api.amisafe.org/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    const data = await res.json();
    showConfirmation(data.reportId);
  } catch (err) {
    console.error('Submission error:', err);
    $('btnSubmit').disabled = false;
    $('btnSubmit').textContent = i18n('btnSubmitRetry') || 'Try again';
  }
}

function showConfirmation(reportId) {
  $('reportId').textContent = `Report ID: ${reportId}`;
  showStep('confirm');
}

function resetFlow() {
  Object.assign(state, {
    screenshot: null, voiceBlob: null, voiceTranscript: null,
    textNote: '', category: null, disclosure: null,
    timestamp: new Date().toISOString(),
  });
  $('screenshotPreview').classList.add('hidden');
  $('voiceStatus').classList.add('hidden');
  $('textInput').value = '';
  $('btnNextToCategory').disabled = true;
  $('btnNextToPrivacy').disabled = true;
  $('btnSubmit').disabled = true;
  document.querySelectorAll('.category-card, .disclosure-card').forEach(c => c.classList.remove('selected'));
  showStep('capture');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function detectPlatform(url) {
  const map = {
    'facebook.com': 'Facebook', 'twitter.com': 'X/Twitter', 'x.com': 'X/Twitter',
    'youtube.com': 'YouTube',   'tiktok.com': 'TikTok',     'instagram.com': 'Instagram',
    'whatsapp.com': 'WhatsApp', 'telegram.org': 'Telegram', 'linkedin.com': 'LinkedIn',
  };
  for (const [domain, name] of Object.entries(map)) {
    if (url.includes(domain)) return name;
  }
  return 'Other';
}
