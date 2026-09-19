require('dotenv').config();
const path = require('path');
const express = require('express');
const pool = require('./db');
const { login, requireAuth, requireFullAccess } = require('./auth');
const { asyncHandler, gainLoss } = require('./utils');
const { refreshAllPositions, searchYahooSymbol, getKpis } = require('./prices');
const { getPositionPerformance } = require('./performance');
const { getNewsSummary } = require('./news');
const { sendDailyBriefing } = require('./email');
const { startScheduler, runPriceRefreshJob, runBriefingJob } = require('./scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const TIMEFRAME_DAYS = { '1w': 7, '1m': 30, '3m': 90, '1y': 365 };

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  }
  const result = await login(String(username).toLowerCase(), password);
  if (!result) return res.status(401).json({ error: 'Login fehlgeschlagen' });
  res.json(result);
}));

app.get('/api/filters', requireAuth, asyncHandler(async (req, res) => {
  const [depots] = await pool.query(
    'SELECT DISTINCT depot_name FROM positions WHERE deleted_at IS NULL ORDER BY depot_name',
  );
  const [assetklassen] = await pool.query(
    "SELECT DISTINCT assetklasse FROM positions WHERE deleted_at IS NULL ORDER BY assetklasse",
  );
  res.json({
    depots: depots.map((r) => r.depot_name),
    assetklassen: assetklassen.map((r) => r.assetklasse),
  });
}));

app.get('/api/positions', requireAuth, asyncHandler(async (req, res) => {
  const { depot, assetklasse } = req.query;
  const conditions = ['p.deleted_at IS NULL'];
  const params = [];

  if (depot) {
    conditions.push('p.depot_name = ?');
    params.push(depot);
  }
  if (assetklasse) {
    conditions.push('p.assetklasse = ?');
    params.push(assetklasse);
  }

  const [rows] = await pool.query(
    `SELECT p.*, s.current_price_per_unit, s.current_total_value,
            s.gain_loss_absolute, s.gain_loss_percent, s.snapshot_date
     FROM positions p
     LEFT JOIN daily_snapshots s
       ON s.position_id = p.id
      AND s.snapshot_date = (
            SELECT MAX(snapshot_date) FROM daily_snapshots WHERE position_id = p.id
          )
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.depot_name, p.wertpapier_name`,
    params,
  );

  const performance = await getPositionPerformance(pool, rows.map((r) => r.id));
  const performanceById = new Map(performance.map((p) => [p.id, p]));
  const merged = rows.map((r) => ({ ...r, ...performanceById.get(r.id) }));

  res.json(merged);
}));

app.get('/api/positions/:id', requireAuth, asyncHandler(async (req, res) => {
  const [[position]] = await pool.query(
    `SELECT p.*, s.current_price_per_unit, s.current_total_value,
            s.gain_loss_absolute, s.gain_loss_percent, s.snapshot_date
     FROM positions p
     LEFT JOIN daily_snapshots s
       ON s.position_id = p.id
      AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM daily_snapshots WHERE position_id = p.id)
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [req.params.id],
  );
  if (!position) return res.status(404).json({ error: 'Position nicht gefunden' });

  const [performance] = await getPositionPerformance(pool, [position.id]);
  res.json({ ...position, ...performance });
}));

// On-Demand-Kennzahlen + News fuer die Detailseite - wird bewusst NICHT zwischengespeichert,
// jeder Seitenaufruf fragt frisch bei Yahoo an (siehe Anforderung: "on demand ... schauen").
app.get('/api/positions/:id/insights', requireAuth, asyncHandler(async (req, res) => {
  const [[position]] = await pool.query(
    'SELECT id, isin, wertpapier_name, yahoo_symbol FROM positions WHERE id = ? AND deleted_at IS NULL',
    [req.params.id],
  );
  if (!position) return res.status(404).json({ error: 'Position nicht gefunden' });

  const result = { kpis: null, news: null, errors: [] };

  try {
    const symbol = position.yahoo_symbol || await searchYahooSymbol(position.isin);
    if (symbol !== position.yahoo_symbol) {
      await pool.query('UPDATE positions SET yahoo_symbol = ? WHERE id = ?', [symbol, position.id]);
    }
    result.kpis = await getKpis(symbol);
  } catch (err) {
    result.errors.push(`Kennzahlen: ${err.message}`);
  }

  try {
    result.news = await getNewsSummary(position.wertpapier_name);
  } catch (err) {
    result.errors.push(`News: ${err.message}`);
  }

  res.json(result);
}));

app.post('/api/positions', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const {
    depot_name, isin, wertpapier_name, assetklasse,
    menge, kaufdatum, kaufpreis_per_einheit, broker, ausschuettungsart,
  } = req.body || {};

  if (!depot_name || !isin || !wertpapier_name || !assetklasse || !menge || !kaufdatum || !kaufpreis_per_einheit) {
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  }
  if (!['aktie', 'etf', 'anleihe'].includes(assetklasse)) {
    return res.status(400).json({ error: 'Ungültige Assetklasse' });
  }
  if (ausschuettungsart && !['T', 'A'].includes(ausschuettungsart)) {
    return res.status(400).json({ error: 'Ungültige Ausschüttungsart' });
  }

  const [result] = await pool.query(
    `INSERT INTO positions
      (depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum, kaufpreis_per_einheit, broker, ausschuettungsart)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum, kaufpreis_per_einheit, broker || null, ausschuettungsart || null],
  );
  res.status(201).json({ id: result.insertId });
}));

app.put('/api/positions/:id', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fields = ['depot_name', 'isin', 'wertpapier_name', 'assetklasse', 'menge', 'kaufdatum', 'kaufpreis_per_einheit', 'broker', 'ausschuettungsart'];
  const updates = fields.filter((f) => req.body?.[f] !== undefined);

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
  }

  const setClause = updates.map((f) => `${f} = ?`).join(', ');
  const values = updates.map((f) => req.body[f]);
  values.push(id);

  const [result] = await pool.query(
    `UPDATE positions SET ${setClause} WHERE id = ? AND deleted_at IS NULL`,
    values,
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Position nicht gefunden' });
  res.json({ updated: true });
}));

app.delete('/api/positions/:id', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    'UPDATE positions SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [req.params.id],
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Position nicht gefunden' });
  res.json({ deleted: true });
}));

app.get('/api/snapshots/:timeframe', requireAuth, asyncHandler(async (req, res) => {
  const { timeframe } = req.params;
  const { depot, assetklasse } = req.query;
  const days = TIMEFRAME_DAYS[timeframe];

  const conditions = ['p.deleted_at IS NULL'];
  const params = [];
  if (days) {
    conditions.push('s.snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)');
    params.push(days);
  }
  if (depot) {
    conditions.push('p.depot_name = ?');
    params.push(depot);
  }
  if (assetklasse) {
    conditions.push('p.assetklasse = ?');
    params.push(assetklasse);
  }

  const [rows] = await pool.query(
    `SELECT s.snapshot_date, SUM(s.current_total_value) AS portfolio_value
     FROM daily_snapshots s
     JOIN positions p ON p.id = s.position_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY s.snapshot_date
     ORDER BY s.snapshot_date`,
    params,
  );
  res.json(rows);
}));

app.post('/api/import', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const { depot_name, broker, positions } = req.body || {};
  if (!depot_name || !Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'depot_name und positions erforderlich' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const row of positions) {
      const {
        isin, wertpapier_name, assetklasse, menge, kaufpreis_per_einheit, ausschuettungsart, kaufdatum,
        akt_kurs, akt_wert, gain_loss_percent, gain_loss_absolute,
      } = row;

      if (!isin || !wertpapier_name || !assetklasse || menge == null || kaufpreis_per_einheit == null) {
        throw new Error(`Unvollständige Zeile: ${wertpapier_name || isin || '(unbekannt)'}`);
      }
      if (!['aktie', 'etf', 'anleihe'].includes(assetklasse)) {
        throw new Error(`Ungültige Assetklasse bei ${wertpapier_name}`);
      }
      if (ausschuettungsart && !['T', 'A'].includes(ausschuettungsart)) {
        throw new Error(`Ungültige Ausschüttungsart bei ${wertpapier_name}`);
      }

      const [existing] = await conn.query(
        'SELECT id FROM positions WHERE depot_name = ? AND isin = ? AND deleted_at IS NULL',
        [depot_name, isin],
      );

      let positionId;
      if (existing.length > 0) {
        positionId = existing[0].id;
        await conn.query(
          `UPDATE positions SET wertpapier_name = ?, assetklasse = ?, menge = ?, kaufpreis_per_einheit = ?, broker = ?, ausschuettungsart = ?,
             kaufdatum = COALESCE(?, kaufdatum)
           WHERE id = ?`,
          [wertpapier_name, assetklasse, menge, kaufpreis_per_einheit, broker || null, ausschuettungsart || null, kaufdatum || null, positionId],
        );
      } else {
        const [result] = await conn.query(
          `INSERT INTO positions (depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum, kaufpreis_per_einheit, broker, ausschuettungsart)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum || null, kaufpreis_per_einheit, broker || null, ausschuettungsart || null],
        );
        positionId = result.insertId;
      }

      if (akt_kurs != null && akt_wert != null) {
        await conn.query(
          `INSERT INTO daily_snapshots
            (position_id, snapshot_date, current_price_per_unit, current_total_value, gain_loss_absolute, gain_loss_percent)
           VALUES (?, CURDATE(), ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             current_price_per_unit = VALUES(current_price_per_unit),
             current_total_value = VALUES(current_total_value),
             gain_loss_absolute = VALUES(gain_loss_absolute),
             gain_loss_percent = VALUES(gain_loss_percent)`,
          [positionId, akt_kurs, akt_wert, gain_loss_absolute ?? null, gain_loss_percent ?? null],
        );
      }
    }

    await conn.query(
      'INSERT INTO import_history (import_source, positions_imported_count) VALUES (?, ?)',
      [`${broker || 'manuell'}: ${depot_name}`, positions.length],
    );

    await conn.commit();
    res.status(201).json({ imported: positions.length });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
}));

app.post('/api/refresh-prices', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  // NDJSON-Stream (eine JSON-Zeile pro Ereignis) statt einer einzelnen Antwort am Ende -
  // das Frontend kann so live anzeigen, welche Position gerade abgefragt wird.
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.flushHeaders();

  const result = await refreshAllPositions(pool, {
    gainLoss,
    onProgress: (p) => res.write(`${JSON.stringify({ type: 'progress', name: p.wertpapier_name })}\n`),
  });

  res.write(`${JSON.stringify({ type: 'done', ...result })}\n`);
  res.end();
}));

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/export/csv', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.depot_name, p.wertpapier_name, p.isin, p.assetklasse, p.ausschuettungsart,
            p.menge, p.kaufdatum, p.kaufpreis_per_einheit, p.broker,
            s.current_price_per_unit, s.current_total_value, s.gain_loss_absolute, s.gain_loss_percent, s.snapshot_date
     FROM positions p
     LEFT JOIN daily_snapshots s
       ON s.position_id = p.id
      AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM daily_snapshots WHERE position_id = p.id)
     WHERE p.deleted_at IS NULL
     ORDER BY p.depot_name, p.wertpapier_name`,
  );

  const header = [
    'Depot', 'Wertpapier', 'ISIN', 'Assetklasse', 'Typ', 'Anzahl', 'Kaufdatum',
    'Kaufpreis', 'Broker', 'Aktueller Kurs', 'Wert der Position', 'Gewinn/Verlust EUR',
    'Gewinn/Verlust %', 'Kursdatum',
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.depot_name, r.wertpapier_name, r.isin, r.assetklasse, r.ausschuettungsart,
      r.menge, r.kaufdatum, r.kaufpreis_per_einheit, r.broker,
      r.current_price_per_unit, r.current_total_value, r.gain_loss_absolute, r.gain_loss_percent,
      r.snapshot_date,
    ].map(csvEscape).join(';'));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="aktienaufstellung-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${lines.join('\r\n')}`);
}));

app.post('/api/send-briefing', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const summary = await sendDailyBriefing(pool);
  res.json({ sent: true, total: summary.total, snapshotDate: summary.snapshotDate });
}));

// Simuliert den kompletten Morgen-Ablauf (09:00 Kursabfrage+News-Check, dann 09:15
// Briefing) auf Knopfdruck - zum Testen, ohne auf die Uhrzeit zu warten.
app.post('/api/run-morning-routine', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const refreshResult = await runPriceRefreshJob();
  const summary = await runBriefingJob();
  res.json({
    refreshed: refreshResult.updated,
    failed: refreshResult.failed,
    briefingSent: true,
    total: summary.total,
  });
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Interner Serverfehler' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`aktien-api läuft auf Port ${PORT}`));
startScheduler();
