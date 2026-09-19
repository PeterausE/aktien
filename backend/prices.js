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

async function getYahooChartMeta(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Kursabfrage fehlgeschlagen (${res.status})`);
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (meta?.regularMarketPrice == null) throw new Error('Kein Kurs in Yahoo-Antwort');
  return meta;
}

async function getYahooChartQuote(symbol) {
  const meta = await getYahooChartMeta(symbol);
  return { price: meta.regularMarketPrice, currency: meta.currency };
}

// Kennzahlen fuer die Positions-Detailseite. quoteSummary (KGV, Dividendenrendite etc.)
// verlangt inzwischen einen Auth-Crumb und ist ohne Login nicht nutzbar - diese Felder
// stammen daher bewusst nur aus den frei zugaenglichen chart-meta-Daten.
async function getKpis(symbol) {
  const meta = await getYahooChartMeta(symbol);
  return {
    currency: meta.currency,
    exchange: meta.fullExchangeName,
    regularMarketPrice: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    volume: meta.regularMarketVolume,
  };
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

// Kern-Refresh-Schleife, gemeinsam genutzt von der /api/refresh-prices-Route (Streaming)
// und dem 09:15-Uhr-Cron-Job (kein Streaming, nur das Endergebnis).
async function refreshAllPositions(pool, { gainLoss, onProgress } = {}) {
  const [positions] = await pool.query(
    `SELECT id, isin, wertpapier_name, menge, kaufpreis_per_einheit, yahoo_symbol
     FROM positions WHERE deleted_at IS NULL`,
  );

  const result = { updated: 0, failed: [] };

  for (const p of positions) {
    onProgress?.(p);
    try {
      const { symbol, priceEur } = await fetchEurPrice(p.isin, p.yahoo_symbol);

      if (symbol !== p.yahoo_symbol) {
        await pool.query('UPDATE positions SET yahoo_symbol = ? WHERE id = ?', [symbol, p.id]);
      }

      const totalValue = priceEur * Number(p.menge);
      const { absolute, percent } = gainLoss(totalValue, Number(p.menge), Number(p.kaufpreis_per_einheit));

      await pool.query(
        `INSERT INTO daily_snapshots
          (position_id, snapshot_date, current_price_per_unit, current_total_value, gain_loss_absolute, gain_loss_percent)
         VALUES (?, CURDATE(), ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           current_price_per_unit = VALUES(current_price_per_unit),
           current_total_value = VALUES(current_total_value),
           gain_loss_absolute = VALUES(gain_loss_absolute),
           gain_loss_percent = VALUES(gain_loss_percent)`,
        [p.id, priceEur, totalValue, absolute, percent],
      );
      await pool.query('UPDATE positions SET last_refresh_error = NULL WHERE id = ?', [p.id]);
      result.updated += 1;
    } catch (err) {
      result.failed.push({ isin: p.isin, wertpapier_name: p.wertpapier_name, error: err.message });
      await pool.query('UPDATE positions SET last_refresh_error = ? WHERE id = ?', [err.message.slice(0, 255), p.id]);
    }
    // kleine Pause zwischen Requests - Yahoo bietet keinen offiziellen API-Key/Rate-Limit-Vertrag.
    await sleep(300);
  }

  return result;
}

module.exports = { fetchEurPrice, sleep, refreshAllPositions, searchYahooSymbol, getKpis };
