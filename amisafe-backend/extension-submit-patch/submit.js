// ═══════════════════════════════════════════════════════════════
//  Amisafe Extension — submit.js
//  Drop this into the extension folder and add
//    <script src="submit.js"></script>
//  just before </body> in recorder.html, AFTER recorder.js.
//
//  It replaces the simulated submit flow with a real API call
//  to the Render backend.
// ═══════════════════════════════════════════════════════════════

const API_BASE = 'https://amisafe-api.onrender.com';

// Override the submit button handler defined in recorder.js
const realSubmitBtn = document.getElementById('submitBtn');
if (realSubmitBtn) {
  // Remove the old listener by cloning the node
  const fresh = realSubmitBtn.cloneNode(true);
  realSubmitBtn.parentNode.replaceChild(fresh, realSubmitBtn);

  fresh.addEventListener('click', async () => {
    const hasEvidence = state.clips.length > 0 || state.screenshot || state.videos.length > 0;
    if (!hasEvidence) {
      showToast(t('err_no_evidence'));
      return;
    }

    fresh.disabled = true;
    fresh.textContent = '…';

    try {
      const ref = await submitReport();
      // Show success UI
      const card = document.getElementById('submitCard');
      const success = document.getElementById('submitSuccess');
      const refCode = document.getElementById('refCode');
      if (card)    card.style.display = 'none';
      if (success) success.classList.add('show');
      if (refCode) refCode.textContent = 'REF: ' + ref;
      showToast(t('toast_submitted'));
    } catch (err) {
      console.error('Submit failed:', err);
      showToast('Submission failed. Check your connection and try again.');
      fresh.disabled = false;
      fresh.textContent = t('submit_btn');
    }
  });
}

async function submitReport() {
  const formData = new FormData();

  // ── Required fields ──────────────────────────────────────
  formData.append('pseudo_id',     generatePseudoId());
  formData.append('harm_type',     state.harmId     || 'other');
  formData.append('privacy_level', state.privacyLevel || 'private');
  formData.append('language',      currentLang      || 'en');

  // ── Optional fields ──────────────────────────────────────
  if (state.feedback)  formData.append('feedback', state.feedback);
  if (state.tags?.length) formData.append('tags', JSON.stringify(state.tags));

  // ── Screenshot (dataUrl → Blob) ──────────────────────────
  if (state.screenshot?.dataUrl) {
    formData.append('platform_url', state.screenshot.url || '');
    const blob = dataUrlToBlob(state.screenshot.dataUrl);
    formData.append('screenshot', blob, 'screenshot.jpg');
  }

  // ── Voice note (take first clip) ────────────────────────
  if (state.clips.length > 0) {
    formData.append('voice_note', state.clips[0].blob, 'voice.webm');
  }

  // ── Video clip (take first) ─────────────────────────────
  if (state.videos.length > 0) {
    formData.append('video_clip', state.videos[0].blob, 'video.webm');
  }

  const res = await fetch(`${API_BASE}/api/reports`, {
    method: 'POST',
    body:   formData,
    // No Content-Type header — browser sets it with the correct boundary
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  return json.ref;
}

/** Convert a base64 data-URL to a Blob */
function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const raw  = atob(b64);
  const buf  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** Simple client-side pseudo-ID generator (matches server format) */
function generatePseudoId() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes  = crypto.getRandomValues(new Uint8Array(6));
  let   suffix = '';
  for (const b of bytes) suffix += chars[b % chars.length];
  return `AMF-${suffix}`;
}
