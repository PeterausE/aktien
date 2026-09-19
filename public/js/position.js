const positionId = new URLSearchParams(location.search).get('id');

function fmtCurrency(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));
}
function fmtPercent(value) {
  return value == null ? '–' : `${Number(value).toFixed(2)} %`;
}
function fmtNumber(value, decimals = 2) {
  return value == null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: decimals }).format(Number(value));
}

function fieldsHtml(rows) {
  return rows.map(([label, value]) => `
    <div class="position-field">
      <span class="position-field-label">${label}</span>
      <span class="position-field-value">${value}</span>
    </div>
  `).join('');
}

function renderGrid(p) {
  document.getElementById('position-title').textContent = `${p.wertpapier_name} (${p.isin})`;
  const gainLossPercent = p.gain_loss_percent != null ? Number(p.gain_loss_percent) : null;
  document.getElementById('position-grid').innerHTML = fieldsHtml([
    ['Depot', p.depot_name],
    ['Assetklasse', p.assetklasse],
    ['Typ', p.ausschuettungsart === 'T' ? 'Thesaurierend' : p.ausschuettungsart === 'A' ? 'Ausschüttend' : 'unbekannt'],
    ['Anzahl', fmtNumber(p.menge, 4)],
    ['Kaufdatum', p.kaufdatum ?? 'unbekannt'],
    ['Kaufpreis', fmtCurrency(p.kaufpreis_per_einheit)],
    ['Akt. Kurs', p.current_price_per_unit != null ? fmtCurrency(p.current_price_per_unit) : '–'],
    ['Wert der Position', p.current_total_value != null ? fmtCurrency(p.current_total_value) : '–'],
    ['Verän. % (Kauf)', fmtPercent(gainLossPercent)],
    ['1 Tag', fmtPercent(p.change_1d)],
    ['1 Woche', fmtPercent(p.change_1w)],
    ['1 Monat', fmtPercent(p.change_1m)],
    ['1 Jahr', fmtPercent(p.change_1y)],
  ]);
}

async function loadPosition() {
  const p = await apiFetch(`positions/${positionId}`);
  renderGrid(p);
  document.getElementById('edit-menge').value = p.menge;
  document.getElementById('edit-kaufpreis').value = p.kaufpreis_per_einheit;
  return p;
}

function renderKpis(kpis) {
  const statusEl = document.getElementById('kpi-status');
  if (!kpis) {
    statusEl.textContent = 'Keine Kennzahlen verfügbar.';
    return;
  }
  statusEl.textContent = '';
  document.getElementById('kpi-grid').innerHTML = fieldsHtml([
    ['Börse', kpis.exchange ?? '–'],
    ['Vortagesschluss', kpis.previousClose != null ? fmtCurrency(kpis.previousClose) : '–'],
    ['Tagesspanne', (kpis.dayLow != null && kpis.dayHigh != null) ? `${fmtCurrency(kpis.dayLow)} – ${fmtCurrency(kpis.dayHigh)}` : '–'],
    ['52-Wochen-Hoch', kpis.fiftyTwoWeekHigh != null ? fmtCurrency(kpis.fiftyTwoWeekHigh) : '–'],
    ['52-Wochen-Tief', kpis.fiftyTwoWeekLow != null ? fmtCurrency(kpis.fiftyTwoWeekLow) : '–'],
    ['Volumen', kpis.volume != null ? fmtNumber(kpis.volume, 0) : '–'],
  ]);
}

function renderNews(news) {
  const list = document.getElementById('news-list');
  const statusEl = document.getElementById('news-status');
  if (!news || news.headlines.length === 0) {
    statusEl.textContent = 'Keine aktuellen Meldungen gefunden.';
    list.innerHTML = '';
    return;
  }
  statusEl.textContent = '';
  list.innerHTML = news.headlines.map((h) => `
    <li>
      <a href="${h.link}" target="_blank" rel="noopener">${h.title}</a>
      <span class="news-meta">${h.publisher ?? ''}${h.publishedAt ? ' · ' + new Date(h.publishedAt).toLocaleDateString('de-DE') : ''}</span>
    </li>
  `).join('');
}

async function loadInsights() {
  try {
    const data = await apiFetch(`positions/${positionId}/insights`);
    renderKpis(data.kpis);
    renderNews(data.news);
    if (data.errors?.length) {
      const extra = data.errors.join(' | ');
      document.getElementById('kpi-status').textContent = document.getElementById('kpi-status').textContent
        ? `${document.getElementById('kpi-status').textContent} (${extra})`
        : extra;
    }
  } catch (err) {
    document.getElementById('kpi-status').textContent = `Fehler: ${err.message}`;
  }
}

(async function init() {
  const auth = getAuth();
  if (!auth?.token) {
    window.location.href = 'index.html';
    return;
  }
  if (!positionId) {
    window.location.href = 'dashboard.html';
    return;
  }
  document.getElementById('current-user').textContent = `${auth.username} (${auth.role === 'admin' ? 'Vollzugriff' : 'Nur Ansicht'})`;

  await loadPosition();
  loadInsights();

  if (auth.role === 'admin') {
    document.getElementById('position-edit').hidden = false;
    document.getElementById('save-position-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('save-status');
      const menge = document.getElementById('edit-menge').value;
      const kaufpreis_per_einheit = document.getElementById('edit-kaufpreis').value;
      statusEl.textContent = 'Speichere …';
      try {
        await apiFetch(`positions/${positionId}`, {
          method: 'PUT',
          body: JSON.stringify({ menge, kaufpreis_per_einheit }),
        });
        statusEl.textContent = 'Gespeichert.';
        await loadPosition();
      } catch (err) {
        statusEl.textContent = `Fehler: ${err.message}`;
      }
    });
  }
})();
