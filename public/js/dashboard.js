let activeTimeframe = 'all';

// mysql2 liefert DECIMAL-Spalten als Strings (Praezisionserhalt) - hier konsequent zu Number wandeln.
function fmtCurrency(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));
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
  const depot = document.getElementById('filter-depot').value;
  const assetklasse = document.getElementById('filter-assetklasse').value;
  const params = new URLSearchParams();
  if (depot) params.set('depot', depot);
  if (assetklasse) params.set('assetklasse', assetklasse);

  const positions = await apiFetch(`positions?${params}`);
  const tbody = document.querySelector('#positions-table tbody');
  tbody.innerHTML = '';

  for (const p of positions) {
    const tr = document.createElement('tr');
    const gainLossPercent = p.gain_loss_percent != null ? Number(p.gain_loss_percent) : null;
    const gainLossClass = gainLossPercent == null || gainLossPercent >= 0 ? 'gain' : 'loss';
    tr.innerHTML = `
      <td>${p.depot_name}</td>
      <td>${p.wertpapier_name}</td>
      <td>${p.isin}</td>
      <td>${p.assetklasse}</td>
      <td>${Number(p.menge)}</td>
      <td>${fmtCurrency(p.kaufpreis_per_einheit)}</td>
      <td>${p.current_total_value != null ? fmtCurrency(p.current_total_value) : '–'}</td>
      <td class="${gainLossClass}">${gainLossPercent != null ? gainLossPercent.toFixed(2) + ' %' : '–'}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadChart() {
  const snapshots = await apiFetch(`snapshots/${activeTimeframe}`);
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

(async function init() {
  const auth = getAuth();
  if (!auth?.token) {
    window.location.href = 'index.html';
    return;
  }
  document.getElementById('current-user').textContent = `${auth.username} (${auth.role === 'admin' ? 'Vollzugriff' : 'Nur Ansicht'})`;
  if (auth.role === 'admin') {
    document.getElementById('import-toggle-btn').hidden = false;
  }

  document.getElementById('filter-depot').addEventListener('change', loadPositions);
  document.getElementById('filter-assetklasse').addEventListener('change', loadPositions);
  initTimeframeButtons();

  await loadFilters();
  await refreshDashboard();
})();
