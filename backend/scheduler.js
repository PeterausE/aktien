const cron = require('node-cron');
const pool = require('./db');
const { gainLoss } = require('./utils');
const { refreshAllPositions } = require('./prices');
const { sendDailyBriefing } = require('./email');

// Kursabfrage zuerst (09:00 Uhr), danach das Briefing (09:15 Uhr) - so meldet die Mail
// tagesaktuelle statt gestrige Kurse.
function startScheduler() {
  cron.schedule('0 9 * * *', async () => {
    try {
      const result = await refreshAllPositions(pool, { gainLoss });
      console.log(`[scheduler] Kursabfrage: ${result.updated} aktualisiert, ${result.failed.length} fehlgeschlagen`);
    } catch (err) {
      console.error('[scheduler] Kursabfrage fehlgeschlagen:', err.message);
    }
  }, { timezone: 'Europe/Berlin' });

  cron.schedule('15 9 * * *', async () => {
    try {
      await sendDailyBriefing(pool);
      console.log('[scheduler] Tagesbriefing versendet');
    } catch (err) {
      console.error('[scheduler] Tagesbriefing fehlgeschlagen:', err.message);
    }
  }, { timezone: 'Europe/Berlin' });

  console.log('[scheduler] Jobs registriert: Kursabfrage 09:00, Briefing 09:15 (Europe/Berlin)');
}

module.exports = { startScheduler };
