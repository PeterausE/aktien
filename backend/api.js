require('dotenv').config();
const path = require('path');
const express = require('express');
const pool = require('./db');
const { login, requireAuth, requireFullAccess } = require('./auth');
const { asyncHandler } = require('./utils');

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
  res.json(rows);
}));

app.post('/api/positions', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const {
    depot_name, isin, wertpapier_name, assetklasse,
    menge, kaufdatum, kaufpreis_per_einheit, broker,
  } = req.body || {};

  if (!depot_name || !isin || !wertpapier_name || !assetklasse || !menge || !kaufdatum || !kaufpreis_per_einheit) {
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  }
  if (!['aktie', 'etf', 'anleihe'].includes(assetklasse)) {
    return res.status(400).json({ error: 'Ungültige Assetklasse' });
  }

  const [result] = await pool.query(
    `INSERT INTO positions
      (depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum, kaufpreis_per_einheit, broker)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum, kaufpreis_per_einheit, broker || null],
  );
  res.status(201).json({ id: result.insertId });
}));

app.put('/api/positions/:id', requireAuth, requireFullAccess, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fields = ['depot_name', 'isin', 'wertpapier_name', 'assetklasse', 'menge', 'kaufdatum', 'kaufpreis_per_einheit', 'broker'];
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
  const days = TIMEFRAME_DAYS[timeframe];

  const [rows] = await pool.query(
    `SELECT snapshot_date, SUM(current_total_value) AS portfolio_value
     FROM daily_snapshots
     ${days ? 'WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)' : ''}
     GROUP BY snapshot_date
     ORDER BY snapshot_date`,
    days ? [days] : [],
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
        isin, wertpapier_name, assetklasse, menge, kaufpreis_per_einheit,
        akt_kurs, akt_wert, gain_loss_percent, gain_loss_absolute,
      } = row;

      if (!isin || !wertpapier_name || !assetklasse || menge == null || kaufpreis_per_einheit == null) {
        throw new Error(`Unvollständige Zeile: ${wertpapier_name || isin || '(unbekannt)'}`);
      }
      if (!['aktie', 'etf', 'anleihe'].includes(assetklasse)) {
        throw new Error(`Ungültige Assetklasse bei ${wertpapier_name}`);
      }

      const [existing] = await conn.query(
        'SELECT id FROM positions WHERE depot_name = ? AND isin = ? AND deleted_at IS NULL',
        [depot_name, isin],
      );

      let positionId;
      if (existing.length > 0) {
        positionId = existing[0].id;
        await conn.query(
          `UPDATE positions SET wertpapier_name = ?, assetklasse = ?, menge = ?, kaufpreis_per_einheit = ?, broker = ?
           WHERE id = ?`,
          [wertpapier_name, assetklasse, menge, kaufpreis_per_einheit, broker || null, positionId],
        );
      } else {
        const [result] = await conn.query(
          `INSERT INTO positions (depot_name, isin, wertpapier_name, assetklasse, menge, kaufdatum, kaufpreis_per_einheit, broker)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
          [depot_name, isin, wertpapier_name, assetklasse, menge, kaufpreis_per_einheit, broker || null],
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`aktien-api läuft auf Port ${PORT}`));
