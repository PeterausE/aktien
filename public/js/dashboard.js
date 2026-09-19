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

let currentPositions = [];
let sortField = null;
let sortDirection = 'asc';

async function loadPositions() {
  currentPositions = await apiFetch(`positions?${currentFilterParams()}`);
  renderPositionsRows(sortField ? sortPositions(currentPositions) : currentPositions);
}

function sortPositions(positions) {
  const th = document.querySelector(`#positions-table th[data-sort="${sortField}"]`);
  const type = th?.dataset.type ?? 'string';
  const dir = sortDirection === 'asc' ? 1 : -1;

  return [...positions].sort((a, b) => {
    let va = a[sortField];
    let vb = b[sortField];
    const aEmpty = va == null || va === '';
    const bEmpty = vb == null || vb === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1; // leere Werte immer ans Ende, unabhaengig von der Richtung
    if (bEmpty) return -1;

    if (type === 'number') {
      va = Number(va);
      vb = Number(vb);
      return (va - vb) * dir;
    }
    return String(va).localeCompare(String(vb), 'de') * dir;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('#positions-table th[data-sort]').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortField) th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function initSortableHeaders() {
  document.querySelectorAll('#positions-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      sortDirection = field === sortField && sortDirection === 'asc' ? 'desc' : 'asc';
      sortField = field;
      updateSortIndicators();
      renderPositionsRows(sortPositions(currentPositions));
    });
  });
}

function renderPositionsRows(positions) {
  const tbody = document.querySelector('#positions-table tbody');
  tbody.innerHTML = '';

  for (const p of positions) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.classList.add('clickable-row');
    if (p.last_refresh_error) {
      tr.classList.add('row-warning');
      tr.title = `Kursabruf fehlgeschlagen: ${p.last_refresh_error}`;
    }
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
  const isAdmin = getAuth()?.role === 'admin';
  const snapshots = await apiFetch(`snapshots/${activeTimeframe}?${currentFilterParams()}`);
  renderPortfolioChart(snapshots, { showValues: isAdmin });
}

async function refreshDashboard() {
  const isAdmin = getAuth()?.role === 'admin';
  await Promise.all(isAdmin ? [loadPositions(), loadChart()] : [loadChart()]);
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

function initDetailsLogin() {
  const overlay = document.getElementById('details-login-overlay');
  const form = document.getElementById('details-login-form');
  const errorEl = document.getElementById('details-login-error');

  document.getElementById('details-btn').addEventListener('click', () => {
    errorEl.hidden = true;
    form.reset();
    overlay.hidden = false;
    document.getElementById('details-password').focus();
  });

  document.getElementById('details-login-cancel').addEventListener('click', () => {
    overlay.hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    try {
      await performLogin('peter', document.getElementById('details-password').value);
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
}

(async function init() {
  const auth = getAuth();
  if (!auth?.token) {
    window.location.href = 'index.html';
    return;
  }
  const isAdmin = auth.role === 'admin';
  document.getElementById('current-user').textContent = `${auth.username} (${isAdmin ? 'Vollzugriff' : 'Nur Ansicht'})`;
  initDetailsLogin();

  if (isAdmin) {
    // Tabelle/Filter/Export sind im HTML standardmaessig versteckt (sicherer Default fuer
    // Benni) - fuer Peter hier aktiv sichtbar machen.
    document.getElementById('import-toggle-btn').hidden = false;
    document.getElementById('refresh-prices-btn').hidden = false;
    document.getElementById('depot-assetklasse-filters').hidden = false;
    document.querySelector('.positions-section').hidden = false;
    document.getElementById('export-csv-btn').hidden = false;
    document.getElementById('refresh-prices-btn').addEventListener('click', refreshPrices);
    document.getElementById('filter-depot').addEventListener('change', refreshDashboard);
    document.getElementById('filter-assetklasse').addEventListener('change', refreshDashboard);
    document.getElementById('export-csv-btn').addEventListener('click', exportCsv);
    document.querySelector('#positions-table tbody').addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-id]');
      if (row) window.location.href = `position.html?id=${row.dataset.id}`;
    });
    initSortableHeaders();
    await loadFilters();
  } else {
    // Datenschutz: Benni bekommt weder Filter noch Tabelle noch Export - nicht nur
    // versteckt, die zugehoerigen API-Endpunkte lehnen ihre Rolle serverseitig ab.
    document.getElementById('details-btn').hidden = false;
  }

  initTimeframeButtons();
  await refreshDashboard();
})();
