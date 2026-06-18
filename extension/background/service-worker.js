/**
 * background/service-worker.js
 *
 * Manifest V3 service worker. Responsibilities:
 *   1. Queue reports for submission when offline (IndexedDB queue)
 *   2. Handle audio transcription requests via Whisper WebAssembly (offscreen)
 *   3. Retry queued reports when connectivity is restored
 *   4. Badge updates (pending report count)
 */

const API_BASE      = 'https://api.amisafe.org';
const QUEUE_DB_NAME = 'amisafe_queue';
const RETRY_ALARM   = 'amisafe_retry';

// ─── Install / startup ────────────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

// ─── Alarm for retry ─────────────────────────────────────────────────────────
chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === RETRY_ALARM) flushQueue();
});

// ─── Message handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {

    case 'SUBMIT_REPORT':
      handleSubmitReport(msg.report, sendResponse);
      return true; // keep message channel open for async

    case 'TRANSCRIBE_AUDIO':
      handleTranscribe(msg.audio, sendResponse);
      return true;

    case 'GET_QUEUE_LENGTH':
      getQueueLength().then(len => sendResponse({ length: len }));
      return true;

    default:
      break;
  }
});

// ─── Report submission with offline queue ────────────────────────────────────
async function handleSubmitReport(report, sendResponse) {
  const online = navigator.onLine;

  if (!online) {
    await enqueue(report);
    updateBadge();
    sendResponse({ status: 'queued' });
    return;
  }

  const result = await postReport(report);
  if (result.ok) {
    sendResponse({ status: 'sent', reportId: result.reportId });
  } else {
    await enqueue(report);
    updateBadge();
    sendResponse({ status: 'queued', error: result.error });
  }
}

async function postReport(report) {
  try {
    const res  = await fetch(`${API_BASE}/api/reports`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(report),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, reportId: data.reportId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function flushQueue() {
  const queue = await getQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    const result = await postReport(item.report);
    if (!result.ok) remaining.push(item);
  }
  await saveQueue(remaining);
  updateBadge();
}

// ─── IndexedDB queue helpers ─────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function enqueue(report) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    store.add({ report, queuedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function getQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('queue', 'readonly');
    const req   = tx.objectStore('queue').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveQueue(items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    store.clear();
    items.forEach(item => store.add(item));
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function getQueueLength() {
  const queue = await getQueue();
  return queue.length;
}

// ─── Badge ────────────────────────────────────────────────────────────────────
async function updateBadge() {
  const len = await getQueueLength();
  if (len > 0) {
    chrome.action.setBadgeText({ text: String(len) });
    chrome.action.setBadgeBackgroundColor({ color: '#D85A30' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Audio transcription (Whisper via offscreen document) ────────────────────
async function handleTranscribe(audioArray, sendResponse) {
  // Create an offscreen document that runs Whisper WASM
  try {
    await chrome.offscreen.createDocument({
      url:    'offscreen/whisper.html',
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'On-device audio transcription via Whisper WASM',
    });
  } catch {
    // Already exists
  }

  chrome.runtime.sendMessage(
    { action: 'WHISPER_TRANSCRIBE', audio: audioArray },
    response => sendResponse(response)
  );
}
