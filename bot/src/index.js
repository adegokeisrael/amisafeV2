/**
 * bot/src/index.js
 *
 * AmiSafe WhatsApp Companion Bot
 *
 * Provides the same structured report flow as the browser extension —
 * harm category selection, voice note submission, disclosure choice —
 * through plain WhatsApp messages and voice notes.
 *
 * Supports all 9 AmiSafe languages by detecting the user's interface
 * language or allowing them to choose with "lang:ha" etc.
 */

import 'dotenv/config';
import pkg          from 'whatsapp-web.js';
import qrcode       from 'qrcode-terminal';
import pino         from 'pino';
import { handleMessage, handleVoiceNote } from './handlers/report-flow.js';

const { Client, LocalAuth, MessageMedia } = pkg;
const log = pino({ level: 'info' });

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// ─── QR code for initial session auth ────────────────────────────────────────
client.on('qr', qr => {
  log.info('Scan this QR code with WhatsApp on your phone:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  log.info('AmiSafe WhatsApp bot is ready');
});

client.on('auth_failure', msg => {
  log.error({ msg }, 'WhatsApp authentication failed');
  process.exit(1);
});

// ─── Message handler ─────────────────────────────────────────────────────────
client.on('message', async msg => {
  try {
    // Only handle private (1:1) messages
    if (msg.isGroupMsg) return;
    if (msg.from === 'status@broadcast') return;

    // Voice note / audio
    if (msg.type === 'ptt' || msg.type === 'audio') {
      await handleVoiceNote(msg, client);
      return;
    }

    // Text message
    if (msg.type === 'chat') {
      await handleMessage(msg, client);
      return;
    }
  } catch (err) {
    log.error({ err, from: msg.from }, 'Bot handler error');
    await msg.reply(
      '⚠️ Something went wrong. Please try again or type *help* for instructions.'
    );
  }
});

client.initialize();
