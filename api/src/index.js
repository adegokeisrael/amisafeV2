/**
 * api/src/index.js
 * AmiSafe API — Express server entry point
 */

import 'dotenv/config';
import express       from 'express';
import helmet        from 'helmet';
import cors          from 'cors';
import rateLimit     from 'express-rate-limit';
import pino          from 'pino';

import reportsRouter  from './routes/reports.js';
import patternsRouter from './routes/patterns.js';
import statsRouter    from './routes/stats.js';
import adminRouter    from './routes/admin.js';
import { pool }       from './db/pool.js';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Partner-Key'],
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX       || '30'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please try again shortly.' },
});
app.use('/api/', limiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Limit payload size to prevent abuse (screenshots are compressed)
app.use(express.json({ limit: '2mb' }));

// ─── Request logging ─────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  // Never log request bodies (they may contain harm descriptions)
  log.info({ method: req.method, path: req.path }, 'request');
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/reports',  reportsRouter);
app.use('/api/patterns', patternsRouter);
app.use('/api/stats',    statsRouter);
app.use('/api/admin',    adminRouter);

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── 404 & error handler ──────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  log.error(err, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => log.info(`AmiSafe API running on port ${PORT}`));

export default app;
