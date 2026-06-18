# Amisafe Backend API

Community-led AI harm reporting for Africa — backend API.
Built with Node.js + Express, deployed on Render, storage on Cloudflare R2.

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/api/reports` | None | Submit a harm report |
| GET | `/api/reports/:ref` | None | Check report status |
| GET | `/api/dashboard` | None | Public aggregate stats |
| GET | `/api/partner/reports` | API key | Filtered aggregate data |
| GET | `/api/partner/signals` | API key | Confirmed safety signals |
| GET | `/api/partner/export` | API key + scope | CSV export |

---

## Deploy to Render (5 steps)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial Amisafe backend"
git remote add origin https://github.com/YOUR_USERNAME/amisafe-backend.git
git push -u origin main
```

### 2. Create services on Render

Go to [render.com](https://render.com) → New → Blueprint → connect your repo.
Render reads `render.yaml` and creates:
- **amisafe-api** — Node.js web service (free tier)
- **amisafe-db** — PostgreSQL database (free tier, 1 GB)

### 3. Set environment variables

In Render dashboard → amisafe-api → Environment, add:

| Key | Where to find it |
|-----|-----------------|
| `R2_ACCOUNT_ID` | Cloudflare dashboard → right sidebar |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 → Manage R2 API Tokens → Create token |
| `R2_SECRET_ACCESS_KEY` | Same token creation page |
| `R2_BUCKET_NAME` | Name of your R2 bucket (e.g. `amisafe-evidence`) |
| `R2_PUBLIC_URL` | R2 bucket → Settings → Public URL (enable public access first) |
| `API_KEY_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

`DATABASE_URL` is injected automatically by Render — do not set it manually.

### 4. Run the database migration

In Render dashboard → amisafe-db → Connect → copy the External Connection String.

Then locally:

```bash
DATABASE_URL="<paste connection string>" node src/migrate.js
```

Or paste `sql/001_schema.sql` directly into the Render psql console.

### 5. Verify

```bash
curl https://amisafe-api.onrender.com/health
# → {"status":"ok","service":"amisafe-api",...}

curl https://amisafe-api.onrender.com/api/dashboard
# → {"generated_at":"...","totals":{...},...}
```

---

## Cloudflare R2 setup

1. Cloudflare dashboard → R2 → Create bucket → name it `amisafe-evidence`
2. R2 → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - Scope: specific bucket → `amisafe-evidence`
3. Copy Account ID, Access Key ID, Secret Access Key into Render env vars
4. R2 bucket → Settings → enable **Public Access** → copy the public URL

---

## Creating a partner API key

```bash
# 1. Generate a raw key (show this to the partner ONCE, never store it)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Hash it for storage
node -e "
  const crypto = require('crypto');
  const raw = '<paste raw key here>';
  console.log(crypto.createHash('sha256').update(raw).digest('hex'));
"

# 3. Insert into DB via psql
INSERT INTO api_keys (key_hash, label, scopes)
VALUES (
  '<paste hash>',
  'Paradigm Initiative',
  ARRAY['reports:aggregate','signals:read']
);

# For research partners who need CSV export, add 'export:bulk' to scopes.
```

---

## Connecting the Chrome extension

1. Copy `extension-submit-patch/submit.js` into your extension folder
2. Add this line at the bottom of `recorder.html`, just before `</body>`:
   ```html
   <script src="submit.js"></script>
   ```
3. Reload the extension in `chrome://extensions/`

The patch intercepts the Submit button click, builds a `FormData` payload
from `state` (harm type, privacy level, screenshot, voice note, video),
and POSTs to `https://amisafe-api.onrender.com/api/reports`.

---

## Local development

```bash
cp .env.example .env
# Fill in .env with your local Postgres URL and R2 credentials

npm install
npm run migrate   # creates tables
npm run dev       # starts with --watch (hot reload)
```

Test a report submission:

```bash
curl -X POST http://localhost:3000/api/reports \
  -F "pseudo_id=AMF-test01" \
  -F "harm_type=deepfake" \
  -F "privacy_level=anon" \
  -F "language=en" \
  -F "platform_url=whatsapp.com" \
  -F "feedback=Test report from curl"
```

---

## Project structure

```
amisafe-backend/
├── src/
│   ├── server.js               Express app + route mounting
│   ├── migrate.js              DB migration runner
│   ├── routes/
│   │   ├── reports.js          POST /api/reports
│   │   ├── dashboard.js        GET  /api/dashboard
│   │   └── partner.js          GET  /api/partner/*
│   ├── middleware/
│   │   ├── auth.js             Partner API key verification
│   │   └── rateLimit.js        Per-IP rate limiting
│   ├── services/
│   │   ├── db.js               PostgreSQL pool + queries
│   │   ├── r2.js               Cloudflare R2 upload/delete
│   │   └── media.js            EXIF strip + hash + upload pipeline
│   └── utils/
│       └── helpers.js          ID generation, validation, normalisation
├── sql/
│   └── 001_schema.sql          Full DB schema
├── extension-submit-patch/
│   └── submit.js               Wires extension Submit → real API
├── .env.example
├── .gitignore
├── package.json
└── render.yaml                 One-click Render deployment config
```

---

## Privacy architecture

- No IP addresses are logged or stored
- No account, email, or phone required
- `private` tier: evidence uploaded to R2, report stored in DB — never included in dashboard or partner exports
- `anon` tier: same as above + included in aggregate dashboard (counts only, rounded to nearest 5)
- `partner` tier: same as above + accessible to vetted partner organisations via API key
- Evidence files (screenshots, voice, video) go to R2 — binary never enters PostgreSQL
- SHA-256 hashes fingerprint every file for tamper-evidence

---

## Licence

Apache 2.0 — Africa AI Safety Prize 2026 submission.
