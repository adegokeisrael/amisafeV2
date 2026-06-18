// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — server.js
//  Entry point. Mounts all routes and starts listening.
// ═══════════════════════════════════════════════════════════════
import 'dotenv/config';
import express  from 'express';
import cors     from 'cors';

import reportsRouter   from './routes/reports.js';
import dashboardRouter from './routes/dashboard.js';
import partnerRouter   from './routes/partner.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ─────────────────────────────────────────────────────
// Allow the Chrome extension and the public dashboard page.
// Chrome extensions send requests from chrome-extension:// origins.
const allowedOrigins = [
  /^chrome-extension:\/\//,
  'https://amisafe-api.onrender.com',
  process.env.PUBLIC_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (server-to-server, curl)
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some((o) =>
      o instanceof RegExp ? o.test(origin) : o === origin
    );
    cb(ok ? null : new Error('CORS: origin not allowed'), ok);
  },
  methods:          ['GET', 'POST', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization'],
  exposedHeaders:   ['X-Request-Id'],
  credentials:      true,
  maxAge:           86400,
}));

// ── Body parsers ─────────────────────────────────────────────
// JSON bodies for simple requests; multipart handled inside routes via multer
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Request logging (lightweight) ────────────────────────────
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    service: 'amisafe-api',
    version: '1.0.0',
    ts:      new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    name:    'Amisafe API',
    version: '1.0.0',
    docs:    `${process.env.PUBLIC_URL || ''}/health`,
    endpoints: {
      'POST /api/reports':          'Submit a harm report from the extension',
      'GET  /api/reports/:ref':     'Check status of a submitted report',
      'GET  /api/dashboard':        'Public aggregate statistics',
      'GET  /api/partner/reports':  'Authenticated: filtered aggregate data',
      'GET  /api/partner/signals':  'Authenticated: confirmed safety signals',
      'GET  /api/partner/export':   'Authenticated (export:bulk scope): CSV export',
    },
  });
});

app.use('/api/reports',   reportsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/partner',   partnerRouter);

// ── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Amisafe API listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Public URL:  ${process.env.PUBLIC_URL || `http://localhost:${PORT}`}`);
});

export default app;
