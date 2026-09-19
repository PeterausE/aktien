let activeTimeframe = 'all';

// mysql2 liefert DECIMAL-Spalten als Strings (Praezisionserhalt) - hier konsequent zu Number wandeln.
function fmtCurrency(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));
}

function fmtPercent(value) {
  return value == null ? '–' : `${Number(value).toFixed(2)} %`;
}

function gainClass(value) {
  return value == null || Number(value) >= 0 ? 'gain' : 'loss';
}

async function loadFilters() {
  const { depots, assetklassen } = await apiFetch('filters');
  const depotSelect = document.getElementById('filter-depot');
  const assetSelect = document.getElementById('filter-assetklasse');
  const previousDepot = depotSelect.value;
  const previousAsset = assetSelect.value;

  depotSelect.length = 1;
  assetSelect.length = 1;
  depots.forEach((d) => depotSelect.add(new Option(d, d)));
  assetklassen.forEach((a) => assetSelect.add(new Option(a, a)));

  if (depots.includes(previousDepot)) depotSelect.value = previousDepot;
  if (assetklassen.includes(previousAsset)) assetSelect.value = previousAsset;
}

async function loadPositions() {
  const positions = await apiFetch(`positions?${currentFilterParams()}`);
  const tbody = document.querySelector('#positions-table tbody');
  tbody.innerHTML = '';

  for (const p of positions) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.classList.add('clickable-row');
    const gainLossPercent = p.gain_loss_percent != null ? Number(p.gain_loss_percent) : null;
    const menge = Number(p.menge);
    const kauf = fmtCurrency(p.kaufpreis_per_einheit);
    const kurs = p.current_price_per_unit != null ? fmtCurrency(p.current_price_per_unit) : '–';
    const wert = p.current_total_value != null ? fmtCurrency(p.current_total_value) : '–';
    const delta = fmtPercent(gainLossPercent);
    const c1d = fmtPercent(p.change_1d);
    const c1w = fmtPercent(p.change_1w);
    const c1m = fmtPercent(p.change_1m);
    const c1y = fmtPercent(p.change_1y);
    // title-Attribut auf jeder Zelle als Fallback, falls die feste Spaltenbreite
    // (table-layout: fixed + ellipsis) den Inhalt abschneidet - per Mouseover einsehbar.
    tr.innerHTML = `
      <td class="col-depot" title="${p.depot_name}">${p.depot_name}</td>
      <td class="col-name" title="${p.wertpapier_name}">${p.wertpapier_name}</td>
      <td class="col-isin" title="${p.isin}">${p.isin}</td>
      <td class="col-klasse" title="${p.assetklasse}">${p.assetklasse}</td>
      <td class="col-typ" title="${p.ausschuettungsart === 'T' ? 'Thesaurierend' : p.ausschuettungsart === 'A' ? 'Ausschüttend' : 'unbekannt'}">${p.ausschuettungsart ?? '?'}</td>
      <td class="col-anzahl" title="${menge}">${menge}</td>
      <td class="col-preis" title="${kauf}">${kauf}</td>
      <td class="col-preis" title="${kurs}">${kurs}</td>
      <td class="col-wert" title="${wert}">${wert}</td>
      <td class="col-delta ${gainClass(gainLossPercent)}" title="${delta}">${delta}</td>
      <td class="col-period ${gainClass(p.change_1d)}" title="${c1d}">${c1d}</td>
      <td class="col-period ${gainClass(p.change_1w)}" title="${c1w}">${c1w}</td>
      <td class="col-period ${gainClass(p.change_1m)}" title="${c1m}">${c1m}</td>
      <td class="col-period ${gainClass(p.change_1y)}" title="${c1y}">${c1y}</td>
    `;
    tbody.appendChild(tr);
  }
}

function currentFilterParams() {
  const depot = document.getElementById('filter-depot').value;
  const assetklasse = document.getElementById('filter-assetklasse').value;
  const params = new URLSearchParams();
  if (depot) params.set('depot', depot);
  if (assetklasse) params.set('assetklasse', assetklasse);
  return params;
}

async function loadChart() {
  const snapshots = await apiFetch(`snapshots/${activeTimeframe}?${currentFilterParams()}`);
  renderPortfolioChart(snapshots);
}

async function refreshDashboard() {
  await Promise.all([loadPositions(), loadChart()]);
}

function initTimeframeButtons() {
  const container = document.getElementById('timeframe-buttons');
  container.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-timeframe]');
    if (!btn) return;
    container.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTimeframe = btn.dataset.timeframe;
    loadChart();
  });
}

async function refreshPrices() {
  const btn = document.getElementById('refresh-prices-btn');
  const statusEl = document.getElementById('refresh-status');
  const auth = getAuth();

  btn.disabled = true;
  statusEl.textContent = 'Aktualisiere Kurse … (kann bis zu 1 Minute dauern)';

  try {
    const res = await fetch('api/refresh-prices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (res.status === 401) {
      clearAuth();
      window.location.href = 'index.html';
      return;
    }
    if (!res.ok) throw new Error(`Fehler ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          statusEl.textContent = `Aktualisiere: ${event.name} …`;
        } else if (event.type === 'done') {
          final = event;
        }
      }
    }

    statusEl.textContent = !final || final.failed.length === 0
      ? `${final?.updated ?? 0} Kurse aktualisiert.`
      : `${final.updated} aktualisiert, ${final.failed.length} fehlgeschlagen: ${final.failed.map((f) => f.wertpapier_name).join(', ')}`;
    await refreshDashboard();
  } catch (err) {
    statusEl.textContent = `Fehler: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function exportCsv() {
  const auth = getAuth();
  const res = await fetch('api/export/csv', { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aktienaufstellung-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

(async function init() {
  const auth = getAuth();
  if (!auth?.token) {
    window.location.href = 'index.html';
    return;
  }
  document.getElementById('current-user').textContent = `${auth.username} (${auth.role === 'admin' ? 'Vollzugriff' : 'Nur Ansicht'})`;
  if (auth.role === 'admin') {
    document.getElementById('import-toggle-btn').hidden = false;
    document.getElementById('refresh-prices-btn').hidden = false;
  }

  document.getElementById('refresh-prices-btn').addEventListener('click', refreshPrices);
  document.getElementById('filter-depot').addEventListener('change', refreshDashboard);
  document.getElementById('filter-assetklasse').addEventListener('change', refreshDashboard);
  document.getElementById('export-csv-btn').addEventListener('click', exportCsv);
  document.querySelector('#positions-table tbody').addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (row) window.location.href = `position.html?id=${row.dataset.id}`;
  });
  initTimeframeButtons();

  await loadFilters();
  await refreshDashboard();
})();
