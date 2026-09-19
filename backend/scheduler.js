const cron = require('node-cron');
const pool = require('./db');
const { gainLoss } = require('./utils');
const { refreshAllPositions, sleep } = require('./prices');
const { getNewsSummary } = require('./news');
const { sendDailyBriefing } = require('./email');

// Nur Schlagzeilen der letzten 36 Stunden gelten als "aktuell genug" fuers Briefing -
// News-Suchergebnisse enthalten sonst oft aeltere, fuer den Tagesreport irrelevante Treffer.
const RECENT_NEWS_HOURS = 36;

// Wird bei 09:00 Uhr befuellt und bei 09:15 Uhr vom Mail-Job gelesen - beide Jobs laufen
// im selben, durchgehenden Node-Prozess, ein einfacher In-Memory-Zwischenspeicher genuegt.
let lastNewsHighlights = [];

async function checkNewsHighlights() {
  const [positions] = await pool.query(
    'SELECT id, wertpapier_name FROM positions WHERE deleted_at IS NULL',
  );
  const highlights = [];

  for (const p of positions) {
    try {
      const { headlines, summary } = await getNewsSummary(p.wertpapier_name, 2);
      const isRecent = headlines.some((h) => h.publishedAt
        && (Date.now() - new Date(h.publishedAt).getTime()) < RECENT_NEWS_HOURS * 3600 * 1000);
      if (isRecent && summary) highlights.push({ wertpapier_name: p.wertpapier_name, summary });
    } catch {
      // News sind ein Nice-to-have fuer den Report - ein Fehler bei einer Position
      // darf den restlichen Report nicht gefaehrden.
    }
    await sleep(300);
  }

  return highlights;
}

// 09:00-Job: Kursabfrage + News-Check. Als eigene Funktion exportiert, damit sie sowohl
// vom Cron als auch von einem manuellen Test-Endpoint (/api/run-morning-routine) genutzt
// werden kann, ohne die Logik zu duplizieren.
async function runPriceRefreshJob() {
  const result = await refreshAllPositions(pool, { gainLoss });
  console.log(`[scheduler] Kursabfrage: ${result.updated} aktualisiert, ${result.failed.length} fehlgeschlagen`);

  try {
    lastNewsHighlights = await checkNewsHighlights();
    console.log(`[scheduler] News-Check: ${lastNewsHighlights.length} Position(en) mit aktuellen Meldungen`);
  } catch (err) {
    console.error('[scheduler] News-Check fehlgeschlagen:', err.message);
    lastNewsHighlights = [];
  }

  return result;
}

// 09:15-Job: Briefing mit dem Stand aus runPriceRefreshJob() (In-Memory, siehe oben).
async function runBriefingJob() {
  const summary = await sendDailyBriefing(pool, lastNewsHighlights);
  console.log('[scheduler] Tagesbriefing versendet');
  return summary;
}

// Kursabfrage zuerst (09:00 Uhr), danach das Briefing (09:15 Uhr) - so meldet die Mail
// tagesaktuelle statt gestrige Kurse.
function startScheduler() {
  cron.schedule('0 9 * * *', async () => {
    try {
      await runPriceRefreshJob();
    } catch (err) {
      console.error('[scheduler] Kursabfrage fehlgeschlagen:', err.message);
    }
  }, { timezone: 'Europe/Berlin' });

  cron.schedule('15 9 * * *', async () => {
    try {
      await runBriefingJob();
    } catch (err) {
      console.error('[scheduler] Tagesbriefing fehlgeschlagen:', err.message);
    }
  }, { timezone: 'Europe/Berlin' });

  console.log('[scheduler] Jobs registriert: Kursabfrage + News-Check 09:00, Briefing 09:15 (Europe/Berlin)');
}

module.exports = { startScheduler, runPriceRefreshJob, runBriefingJob };
