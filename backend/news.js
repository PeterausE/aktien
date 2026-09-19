// Inoffizielle Yahoo-Finance-Suche liefert Schlagzeilen ohne Anmeldung (anders als
// quoteSummary, das inzwischen einen Auth-Crumb verlangt - siehe prices.js).
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function fetchNewsHeadlines(query, limit = 3) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=${limit}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`News-Suche fehlgeschlagen (${res.status})`);
  const data = await res.json();
  return (data.news || []).slice(0, limit).map((n) => ({
    title: n.title,
    publisher: n.publisher,
    link: n.link,
    publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
  }));
}

// Fasst Schlagzeilen zu einer Position zusammen. Aktuell bewusst ein reiner Passthrough
// (gibt nur die Roh-Schlagzeilen als Text zurueck) - isoliert in dieser einen Funktion,
// damit sie spaeter durch einen echten KI-Call ersetzt werden kann (z. B. OpenAI Chat
// Completions API, OPENAI_API_KEY in .env), ohne dass Detailseite oder Morgenreport
// (beide rufen ausschliesslich getNewsSummary() weiter unten auf) angepasst werden muessen.
async function summarizeNews(headlines) {
  if (headlines.length === 0) return null;
  return headlines.map((h) => `${h.title} (${h.publisher})`).join(' | ');
}

async function getNewsSummary(query, limit = 3) {
  const headlines = await fetchNewsHeadlines(query, limit);
  const summary = await summarizeNews(headlines);
  return { headlines, summary };
}

module.exports = { fetchNewsHeadlines, summarizeNews, getNewsSummary };
