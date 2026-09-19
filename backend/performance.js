// Berechnet die Wertentwicklung je Position gegenueber 1 Tag/Woche/Monat/Jahr zurueck,
// ausschliesslich aus den bereits gespeicherten daily_snapshots (keine Live-Kursabfrage).
// Wiederverwendbar sowohl vom Dashboard (jetzt) als auch von einem spaeteren taeglichen
// 09:00-Uhr-Job (Email-Briefing) - beide rufen dieselbe Funktion auf.
const LOOKBACKS = [
  { key: 'change_1d', days: 1 },
  { key: 'change_1w', days: 7 },
  { key: 'change_1m', days: 30 },
  { key: 'change_1y', days: 365 },
];

function percentChange(current, past) {
  if (current == null || past == null) return null;
  const pastNum = Number(past);
  if (pastNum === 0) return null;
  return ((Number(current) - pastNum) / pastNum) * 100;
}

async function getPositionPerformance(pool, positionIds) {
  if (positionIds.length === 0) return [];

  const lookbackSelects = LOOKBACKS.map(({ key, days }) => `
    (SELECT s.current_total_value FROM daily_snapshots s
      WHERE s.position_id = p.id AND s.snapshot_date = (
        SELECT MAX(snapshot_date) FROM daily_snapshots
        WHERE position_id = p.id AND snapshot_date <= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
      )) AS value_${key}
  `).join(',');

  const [rows] = await pool.query(
    `SELECT p.id,
       (SELECT s.current_total_value FROM daily_snapshots s
         WHERE s.position_id = p.id
         ORDER BY s.snapshot_date DESC LIMIT 1) AS current_value,
       ${lookbackSelects}
     FROM positions p
     WHERE p.id IN (?)`,
    [positionIds],
  );

  return rows.map((row) => {
    const performance = { id: row.id };
    for (const { key } of LOOKBACKS) {
      performance[key] = percentChange(row.current_value, row[`value_${key}`]);
    }
    return performance;
  });
}

module.exports = { getPositionPerformance };
