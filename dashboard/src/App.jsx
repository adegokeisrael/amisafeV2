/**
 * dashboard/src/App.jsx
 *
 * AmiSafe Public Intelligence Dashboard
 * Shows only anonymised aggregate statistics — no individual reports.
 */

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const COLOURS = ['#1A7A6E','#D85A30','#1F4E9A','#E8A020','#5D3FD3','#2E8B57','#C0392B','#16A085'];

const CATEGORY_LABELS = {
  deepfake:          'Fake image/video',
  misinformation:    'False information',
  discrimination:    'Unfair AI treatment',
  harassment:        'Harassment',
  financial_harm:    'Financial harm',
  health_misinfo:    'Health misinformation',
  privacy_violation: 'Privacy violation',
  other:             'Other',
};

export default function App() {
  const [stats,    setStats]    = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/stats`).then(r => r.json()),
      fetch(`${API}/api/patterns?status=confirmed&limit=10`).then(r => r.json()),
    ])
      .then(([s, p]) => { setStats(s); setPatterns(p.patterns || []); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;
  if (error)   return <Error msg={error} />;

  const categoryData = (stats.byCategory || []).map(r => ({
    name:  CATEGORY_LABELS[r.category] || r.category,
    count: parseInt(r.count),
  }));

  const trendData = (stats.trend || []).map(r => ({
    date:    r.date.slice(5),  // MM-DD
    reports: parseInt(r.count),
  }));

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>🛡️ AmiSafe</div>
        <p style={styles.subtitle}>Community AI Harm Intelligence · Africa</p>
        <p style={styles.notice}>
          All data shown is anonymised and aggregated. No individual reports or identities are displayed.
        </p>
      </header>

      {/* KPI row */}
      <div style={styles.kpiRow}>
        <KPI label="Total reports"       value={stats.totals?.total_reports}       />
        <KPI label="Last 30 days"        value={stats.totals?.reports_last_30d}    />
        <KPI label="Countries affected"  value={stats.totals?.countries_affected}  />
        <KPI label="Platforms affected"  value={stats.totals?.platforms_affected}  />
        <KPI label="Confirmed patterns"  value={stats.clusters?.confirmed}         accent />
        <KPI label="Safety signals sent" value={stats.clusters?.signals_sent}      />
      </div>

      {/* Charts row */}
      <div style={styles.chartsRow}>
        {/* 30-day trend */}
        <ChartCard title="Reports — last 30 days">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="reports" stroke="#1A7A6E" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* By category */}
        <ChartCard title="Reports by harm type">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[0,4,4,0]}>
                {categoryData.map((_, i) => (
                  <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* By platform */}
        <ChartCard title="Top platforms">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={(stats.byPlatform || []).slice(0, 8)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1F4E9A" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Confirmed patterns table */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Confirmed harm patterns</h2>
        <p style={styles.sectionDesc}>
          Patterns are confirmed when ≥5 independent community reports cluster around the same harm type,
          platform, and region within a 14-day window.
        </p>
        {patterns.length === 0
          ? <p style={styles.empty}>No confirmed patterns yet.</p>
          : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Category','Platform','Countries','Languages','Reports','Status','Signal'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patterns.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>{CATEGORY_LABELS[p.category] || p.category}</td>
                      <td style={styles.td}>{p.platform || '—'}</td>
                      <td style={styles.td}>{(p.country_codes || []).join(', ') || '—'}</td>
                      <td style={styles.td}>{(p.languages    || []).join(', ') || '—'}</td>
                      <td style={styles.td}><strong>{p.report_count}</strong></td>
                      <td style={styles.td}>
                        <Badge status={p.status} />
                      </td>
                      <td style={styles.td}>{p.signal_sent ? '✅ Sent' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </section>

      <footer style={styles.footer}>
        AmiSafe · Africa AI Safety Prize 2026 · Apache 2.0 ·{' '}
        <a href="https://github.com/your-org/amisafe" style={{ color: '#1A7A6E' }}>GitHub</a>
        {' · '}Generated at {stats.generatedAt ? new Date(stats.generatedAt).toUTCString() : '—'}
      </footer>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KPI({ label, value, accent }) {
  return (
    <div style={{ ...styles.kpi, ...(accent ? styles.kpiAccent : {}) }}>
      <div style={styles.kpiValue}>{value ?? '—'}</div>
      <div style={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div style={styles.chartCard}>
      <h3 style={styles.chartTitle}>{title}</h3>
      {children}
    </div>
  );
}

function Badge({ status }) {
  const colours = {
    confirmed: '#1A7A6E', emerging: '#E8A020',
    resolved: '#888', false_positive: '#C0392B',
  };
  return (
    <span style={{
      background: colours[status] || '#888',
      color: 'white', borderRadius: 12,
      padding: '2px 10px', fontSize: 11, fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

function Loader() {
  return <div style={styles.center}>Loading AmiSafe intelligence…</div>;
}

function Error({ msg }) {
  return <div style={styles.center}>⚠️ Could not load data: {msg}</div>;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = {
  app:         { fontFamily: "'Segoe UI', system-ui, sans-serif", maxWidth: 1200, margin: '0 auto', padding: 24, color: '#1E1E1E' },
  header:      { background: '#1A7A6E', color: 'white', borderRadius: 12, padding: '24px 32px', marginBottom: 24 },
  logo:        { fontSize: 28, fontWeight: 800, marginBottom: 4 },
  subtitle:    { margin: 0, opacity: 0.85, fontSize: 16 },
  notice:      { margin: '8px 0 0', fontSize: 12, opacity: 0.7 },
  kpiRow:      { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 },
  kpi:         { flex: '1 1 140px', background: '#F7F7F7', borderRadius: 10, padding: '16px 20px', border: '1px solid #E0E0E0' },
  kpiAccent:   { background: '#E8F5F3', borderColor: '#1A7A6E' },
  kpiValue:    { fontSize: 32, fontWeight: 800, color: '#1A7A6E' },
  kpiLabel:    { fontSize: 12, color: '#666', marginTop: 4 },
  chartsRow:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 32 },
  chartCard:   { background: '#FFF', border: '1px solid #E0E0E0', borderRadius: 10, padding: 20 },
  chartTitle:  { fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 12 },
  section:     { background: '#FFF', border: '1px solid #E0E0E0', borderRadius: 10, padding: 24, marginBottom: 24 },
  sectionTitle:{ fontSize: 18, fontWeight: 700, color: '#1A7A6E', marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 1.6 },
  tableWrap:   { overflowX: 'auto' },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:          { textAlign: 'left', padding: '8px 12px', background: '#F7F7F7', borderBottom: '2px solid #E0E0E0', fontWeight: 700 },
  td:          { padding: '10px 12px', borderBottom: '1px solid #F0F0F0' },
  tr:          { transition: 'background 0.1s' },
  empty:       { color: '#999', fontStyle: 'italic' },
  footer:      { textAlign: 'center', color: '#999', fontSize: 12, marginTop: 32 },
  center:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontSize: 16 },
};
