const nodemailer = require('nodemailer');

// WICHTIG: SMTP_* sind ausschliesslich die Versand-Zugangsdaten (Hostinger-Postfach
// info@gawborbeck.cloud). Der Empfaenger ist davon komplett getrennt und bewusst fest
// verdrahtet - siehe sendDailyBriefing() unten. Niemals eine Empfaengerliste aus einem
// anderen Projekt (z. B. ausstellung-app/ANFRAGEN_EMPFAENGER) hier einbinden.
const RECIPIENT = 'peter.dewendt@gmx.de';

function getTransport() {
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

const LOOKBACKS = [
  { key: 'change_1d', label: '1 Tag', days: 1 },
  { key: 'change_1w', label: '1 Woche', days: 7 },
  { key: 'change_1m', label: '1 Monat', days: 30 },
  { key: 'change_1y', label: '1 Jahr', days: 365 },
];

function percentChange(current, past) {
  if (current == null || past == null || Number(past) === 0) return null;
  return ((Number(current) - Number(past)) / Number(past)) * 100;
}

// Portfolio-Gesamtwert + Wertentwicklung ausschliesslich aus den gespeicherten
// daily_snapshots - keine Live-Kursabfrage (siehe backend/performance.js fuer das
// gleiche Prinzip auf Positionsebene).
async function getPortfolioSummary(pool) {
  const [[latest]] = await pool.query(
    `SELECT snapshot_date, SUM(current_total_value) AS total
     FROM daily_snapshots GROUP BY snapshot_date ORDER BY snapshot_date DESC LIMIT 1`,
  );

  const changes = {};
  for (const { key, days } of LOOKBACKS) {
    const [[past]] = await pool.query(
      `SELECT SUM(current_total_value) AS total FROM daily_snapshots
       WHERE snapshot_date = (
         SELECT MAX(snapshot_date) FROM daily_snapshots
         WHERE snapshot_date <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       )`,
      [days],
    );
    changes[key] = percentChange(latest?.total, past?.total);
  }

  const [byDepot] = await pool.query(
    `SELECT p.depot_name, SUM(s.current_total_value) AS total
     FROM positions p
     JOIN daily_snapshots s ON s.position_id = p.id
      AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM daily_snapshots WHERE position_id = p.id)
     WHERE p.deleted_at IS NULL
     GROUP BY p.depot_name
     ORDER BY total DESC`,
  );

  // Depot-Werte von "gestern" (letzter Snapshot vor heute) fuer die Vortag-Delta-Spalte je Depot.
  const [byDepotYesterday] = await pool.query(
    `SELECT p.depot_name, SUM(s.current_total_value) AS total
     FROM positions p
     JOIN daily_snapshots s ON s.position_id = p.id
      AND s.snapshot_date = (
            SELECT MAX(snapshot_date) FROM daily_snapshots
            WHERE position_id = p.id AND snapshot_date <= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
          )
     WHERE p.deleted_at IS NULL
     GROUP BY p.depot_name`,
  );
  const yesterdayByDepot = new Map(byDepotYesterday.map((d) => [d.depot_name, d.total]));
  const byDepotWithDelta = byDepot.map((d) => ({
    ...d,
    change_1d: percentChange(d.total, yesterdayByDepot.get(d.depot_name)),
  }));

  // Letzte 7 Tage Gesamtwert fuer die Wochengrafik im Report.
  const [weeklySeries] = await pool.query(
    `SELECT snapshot_date, SUM(current_total_value) AS total
     FROM daily_snapshots
     WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY snapshot_date
     ORDER BY snapshot_date`,
  );

  return {
    snapshotDate: latest?.snapshot_date ?? null,
    total: latest?.total ?? 0,
    changes,
    byDepot: byDepotWithDelta,
    weeklySeries,
  };
}

function fmtEur(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));
}

function fmtPercent(value) {
  return value == null ? '–' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} %`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Einfache, abhaengigkeitsfreie Inline-SVG-Liniengrafik fuer den Wochenverlauf. Bewusst
// ohne Achsenbeschriftung in der SVG selbst (Text-Rendering in SVG ist in manchen
// Email-Clients unzuverlaessig) - Start-/Enddatum stehen stattdessen als normaler HTML-Text
// darunter.
function buildWeeklyChartSvg(series) {
  if (series.length < 2) return null;

  const width = 480;
  const height = 120;
  const padding = 12;
  const values = series.map((s) => Number(s.total));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = series.map((s, i) => {
    const x = padding + (i / (series.length - 1)) * (width - padding * 2);
    const y = height - padding - ((Number(s.total) - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePoints = points.join(' ');
  const areaPoints = `${padding},${height - padding} ${linePoints} ${width - padding},${height - padding}`;

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%;">
      <polygon points="${areaPoints}" fill="rgba(37,99,235,0.12)" />
      <polyline points="${linePoints}" fill="none" stroke="#2563eb" stroke-width="2" />
    </svg>
  `;
}

function buildWeeklyChartSection(series) {
  const svg = buildWeeklyChartSvg(series);
  if (!svg) return '';

  const first = series[0];
  const last = series[series.length - 1];
  return `
    <h3 style="margin:24px 0 8px;">Wochenverlauf</h3>
    ${svg}
    <div style="display:flex;justify-content:space-between;color:#52606d;font-size:0.78rem;margin-top:2px;">
      <span>${first.snapshot_date}</span>
      <span>${last.snapshot_date}</span>
    </div>
  `;
}

function buildBriefingHtml(summary, newsHighlights = []) {
  const changeRows = LOOKBACKS.map(({ key, label }) => `
    <tr><td style="padding:4px 12px 4px 0;color:#52606d;">${label}</td>
        <td style="padding:4px 0;font-weight:600;">${fmtPercent(summary.changes[key])}</td></tr>
  `).join('');

  const depotRows = summary.byDepot.map((d) => `
    <tr>
      <td style="padding:4px 12px 4px 0;color:#52606d;">${escapeHtml(d.depot_name)}</td>
      <td style="padding:4px 12px 4px 0;text-align:right;">${fmtEur(d.total)}</td>
      <td style="padding:4px 0;text-align:right;color:${d.change_1d == null ? '#52606d' : d.change_1d >= 0 ? '#16a34a' : '#dc2626'};">${fmtPercent(d.change_1d)}</td>
    </tr>
  `).join('');

  const newsSection = newsHighlights.length === 0 ? '' : `
    <h3 style="margin:24px 0 8px;">Aktuelle Meldungen</h3>
    <ul style="padding-left:18px;margin:0;">
      ${newsHighlights.map((n) => `
        <li style="margin-bottom:8px;color:#1f2933;">
          <strong>${escapeHtml(n.wertpapier_name)}</strong><br>
          <span style="color:#52606d;font-size:0.9rem;">${escapeHtml(n.summary)}</span>
        </li>
      `).join('')}
    </ul>
  `;

  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;">
      <h2 style="margin-bottom:0;">Aktienaufstellung – Tagesbriefing</h2>
      <p style="color:#52606d;margin-top:4px;">Stand: ${summary.snapshotDate ?? '–'}</p>
      <p style="font-size:1.8rem;font-weight:700;margin:16px 0 4px;">${fmtEur(summary.total)}</p>
      <p style="margin:0 0 12px;color:${summary.changes.change_1d == null ? '#52606d' : summary.changes.change_1d >= 0 ? '#16a34a' : '#dc2626'};font-weight:600;">
        ${fmtPercent(summary.changes.change_1d)} zum Vortag
      </p>
      <table style="border-collapse:collapse;margin-bottom:20px;">${changeRows}</table>
      <h3 style="margin-bottom:8px;">Nach Depot</h3>
      <table style="border-collapse:collapse;width:100%;">
        <thead>
          <tr>
            <th style="text-align:left;color:#52606d;font-size:0.78rem;font-weight:600;padding-bottom:4px;">Depot</th>
            <th style="text-align:right;color:#52606d;font-size:0.78rem;font-weight:600;padding-bottom:4px;">Wert</th>
            <th style="text-align:right;color:#52606d;font-size:0.78rem;font-weight:600;padding-bottom:4px;">Δ Vortag</th>
          </tr>
        </thead>
        <tbody>${depotRows}</tbody>
      </table>
      ${buildWeeklyChartSection(summary.weeklySeries)}
      ${newsSection}
    </div>
  `;
}

async function sendDailyBriefing(pool, newsHighlights = []) {
  const summary = await getPortfolioSummary(pool);
  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: RECIPIENT,
    subject: `Aktienaufstellung – ${fmtEur(summary.total)} (${summary.snapshotDate ?? 'heute'})`,
    html: buildBriefingHtml(summary, newsHighlights),
  });
  return summary;
}

module.exports = { getPortfolioSummary, sendDailyBriefing };
