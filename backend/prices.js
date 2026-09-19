// Inoffizielle Yahoo-Finance-Endpunkte (kein API-Key, aber ohne Garantien/SLA -
// bewusste Entscheidung des Betreibers, siehe README).
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function searchYahooSymbol(isin) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=5&newsCount=0`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo-Suche fehlgeschlagen (${res.status})`);
  const data = await res.json();
  const match = data.quotes?.find((q) => q.symbol);
  if (!match) throw new Error('Kein Symbol für ISIN gefunden');
  return match.symbol;
}

async function getYahooChartQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Kursabfrage fehlgeschlagen (${res.status})`);
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (meta?.regularMarketPrice == null) throw new Error('Kein Kurs in Yahoo-Antwort');
  return { price: meta.regularMarketPrice, currency: meta.currency };
}

// Waehrungskurse innerhalb eines Refresh-Laufs cachen statt pro Position neu abzufragen.
const rateCache = new Map();
async function getRateToEUR(currency) {
  if (currency === 'EUR') return 1;
  if (rateCache.has(currency)) return rateCache.get(currency);
  const { price } = await getYahooChartQuote(`${currency}EUR=X`);
  rateCache.set(currency, price);
  return price;
}

async function fetchEurPrice(isin, cachedSymbol) {
  const symbol = cachedSymbol || await searchYahooSymbol(isin);
  const { price, currency } = await getYahooChartQuote(symbol);
  const rate = await getRateToEUR(currency);
  return { symbol, priceEur: price * rate };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { fetchEurPrice, sleep };
