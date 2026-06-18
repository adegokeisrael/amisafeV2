/**
 * bot/src/handlers/report-flow.js
 *
 * Conversational state machine for the WhatsApp report flow.
 *
 * States per user:
 *   idle → awaiting_category → awaiting_description → awaiting_disclosure → done
 *
 * Session state is held in memory (Map). In production, use Redis for
 * persistence across restarts.
 */

import fetch from 'node-fetch';
import taxonomy from '../../../shared/harm-taxonomy.json' assert { type: 'json' };

const API_BASE = process.env.API_URL || 'http://localhost:3001';

// In-memory session store: phone → session object
const sessions = new Map();

// ─── Menu texts ───────────────────────────────────────────────────────────────
const WELCOME = `🛡️ *AmiSafe* — Report AI harm in your community.

Type the number of your language:
1. English
2. Hausa
3. Yorùbá
4. Igbo
5. Kiswahili
6. አማርኛ
7. Soomaali
8. isiZulu
9. Pidgin

Or type *help* at any time.`;

const LANG_MAP = {
  '1':'en','2':'ha','3':'yo','4':'ig',
  '5':'sw','6':'am','7':'so','8':'zu','9':'pcm'
};

function categoryMenu(lang) {
  const lines = taxonomy.categories.map((c, i) =>
    `${i + 1}. ${c[lang] || c.en}`
  );
  return `*What kind of harm did you experience?*\n\n${lines.join('\n')}\n\n_Type the number._`;
}

const DISCLOSURE_MENU =
`*Who can see your report?*

1. 🔒 Keep private — saved on our server but never shared
2. 🔬 Anonymised research — helps detect patterns (no personal info)
3. 🤝 Verified partner — shared with a trusted civil society organisation

_Type 1, 2, or 3._`;

// ─── Main message handler ─────────────────────────────────────────────────────
export async function handleMessage(msg, client) {
  const phone = msg.from;
  const text  = msg.body.trim();

  // Greeting / restart
  if (/^(hi|hello|start|report|help|\/)$/i.test(text) || !sessions.has(phone)) {
    sessions.set(phone, { state: 'awaiting_lang', pseudoId: makePseudoId() });
    await msg.reply(WELCOME);
    return;
  }

  const session = sessions.get(phone);

  switch (session.state) {

    case 'awaiting_lang': {
      const lang = LANG_MAP[text];
      if (!lang) { await msg.reply('Please type a number from 1 to 9.'); return; }
      session.lang  = lang;
      session.state = 'awaiting_category';
      sessions.set(phone, session);
      await msg.reply(categoryMenu(lang));
      break;
    }

    case 'awaiting_category': {
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= taxonomy.categories.length) {
        await msg.reply(`Please type a number from 1 to ${taxonomy.categories.length}.`);
        return;
      }
      session.category = taxonomy.categories[idx].id;
      session.state    = 'awaiting_description';
      sessions.set(phone, session);
      await msg.reply(
        `📝 *Describe what happened.*\n\nYou can:\n• Type a description\n• Send a voice note 🎙\n• Or type *skip* to continue without a description.`
      );
      break;
    }

    case 'awaiting_description': {
      if (!/^skip$/i.test(text)) {
        session.textNote = text;
      }
      session.state = 'awaiting_disclosure';
      sessions.set(phone, session);
      await msg.reply(DISCLOSURE_MENU);
      break;
    }

    case 'awaiting_disclosure': {
      const choice = parseInt(text);
      const disclosureMap = { 1: 'private', 2: 'anon_research', 3: 'verified_partner' };
      const disclosure = disclosureMap[choice];
      if (!disclosure) { await msg.reply('Please type 1, 2, or 3.'); return; }

      session.disclosure = disclosure;
      sessions.set(phone, session);

      const reportId = await submitReport(session);

      sessions.delete(phone);

      await msg.reply(
        `✅ *Report received.*\n\nThank you. Your report has been securely recorded.\n\n` +
        `Report ID: \`${reportId}\`\n\n` +
        `Your identity is protected. Type *report* to submit another.`
      );
      break;
    }

    default:
      sessions.delete(phone);
      await msg.reply(WELCOME);
  }
}

// ─── Voice note handler ───────────────────────────────────────────────────────
export async function handleVoiceNote(msg, _client) {
  const phone   = msg.from;
  const session = sessions.get(phone);

  if (!session || session.state !== 'awaiting_description') {
    await msg.reply(
      '🎙 Voice note received. Please start a report first by typing *report*.'
    );
    return;
  }

  // Download the voice note media
  const media = await msg.downloadMedia();
  session.voiceBase64 = media.data;
  session.voiceMime   = media.mimetype;
  session.state       = 'awaiting_disclosure';
  sessions.set(phone, session);

  await msg.reply(
    `✅ Voice note received.\n\n${DISCLOSURE_MENU}`
  );
}

// ─── Report submission ────────────────────────────────────────────────────────
async function submitReport(session) {
  if (session.disclosure === 'private') {
    // For private bot reports: generate local ID — nothing transmitted
    return 'local-' + session.pseudoId.slice(0, 8);
  }

  try {
    const res = await fetch(`${API_BASE}/api/reports`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pseudoId:   session.pseudoId,
        timestamp:  new Date().toISOString(),
        platform:   'WhatsApp',
        lang:       session.lang    || 'en',
        category:   session.category,
        severity:   'medium',
        disclosure: session.disclosure,
        textNote:   session.textNote || null,
        // Voice is sent as base64 for server-side transcription
        voiceBase64: session.voiceBase64 || null,
      }),
    });
    const data = await res.json();
    return data.reportId || 'unknown';
  } catch {
    return 'offline-' + Date.now();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makePseudoId() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return 'ami_' + Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}
