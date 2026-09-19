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

  return {
    snapshotDate: latest?.snapshot_date ?? null,
    total: latest?.total ?? 0,
    changes,
    byDepot,
  };
}

function fmtEur(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));
}

function fmtPercent(value) {
  return value == null ? '–' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} %`;
}

function buildBriefingHtml(summary) {
  const changeRows = LOOKBACKS.map(({ key, label }) => `
    <tr><td style="padding:4px 12px 4px 0;color:#52606d;">${label}</td>
        <td style="padding:4px 0;font-weight:600;">${fmtPercent(summary.changes[key])}</td></tr>
  `).join('');

  const depotRows = summary.byDepot.map((d) => `
    <tr><td style="padding:4px 12px 4px 0;color:#52606d;">${d.depot_name}</td>
        <td style="padding:4px 0;text-align:right;">${fmtEur(d.total)}</td></tr>
  `).join('');

  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;">
      <h2 style="margin-bottom:0;">Aktienaufstellung – Tagesbriefing</h2>
      <p style="color:#52606d;margin-top:4px;">Stand: ${summary.snapshotDate ?? '–'}</p>
      <p style="font-size:1.8rem;font-weight:700;margin:16px 0 4px;">${fmtEur(summary.total)}</p>
      <table style="border-collapse:collapse;margin-bottom:20px;">${changeRows}</table>
      <h3 style="margin-bottom:8px;">Nach Depot</h3>
      <table style="border-collapse:collapse;width:100%;">${depotRows}</table>
    </div>
  `;
}

async function sendDailyBriefing(pool) {
  const summary = await getPortfolioSummary(pool);
  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: RECIPIENT,
    subject: `Aktienaufstellung – ${fmtEur(summary.total)} (${summary.snapshotDate ?? 'heute'})`,
    html: buildBriefingHtml(summary),
  });
  return summary;
}

module.exports = { getPortfolioSummary, sendDailyBriefing };
