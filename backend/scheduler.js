const cron = require('node-cron');
const pool = require('./db');
const { gainLoss } = require('./utils');
const { refreshAllPositions } = require('./prices');
const { sendDailyBriefing } = require('./email');

// Reihenfolge bewusst wie im urspruenglichen Konzept: Briefing 09:00 Uhr fasst den
// zuletzt gespeicherten Stand zusammen (i.d.R. Vortagesschluss), danach 09:15 Uhr
// frische Kursabfrage fuer den Tag.
function startScheduler() {
  cron.schedule('0 9 * * *', async () => {
    try {
      await sendDailyBriefing(pool);
      console.log('[scheduler] Tagesbriefing versendet');
    } catch (err) {
      console.error('[scheduler] Tagesbriefing fehlgeschlagen:', err.message);
    }
  }, { timezone: 'Europe/Berlin' });

  cron.schedule('15 9 * * *', async () => {
    try {
      const result = await refreshAllPositions(pool, { gainLoss });
      console.log(`[scheduler] Kursabfrage: ${result.updated} aktualisiert, ${result.failed.length} fehlgeschlagen`);
    } catch (err) {
      console.error('[scheduler] Kursabfrage fehlgeschlagen:', err.message);
    }
  }, { timezone: 'Europe/Berlin' });

  console.log('[scheduler] Jobs registriert: Briefing 09:00, Kursabfrage 09:15 (Europe/Berlin)');
}

module.exports = { startScheduler };
