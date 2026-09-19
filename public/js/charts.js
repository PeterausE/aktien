let portfolioChart = null;

// Fuer Benni (readonly) liefert das Backend bereits normalisierte "index_value"-Punkte
// statt echter Euro-Betraege (siehe /api/snapshots) - hier zusaetzlich Achsenbeschriftung
// und Tooltip abschalten, damit selbst die normalisierten Zahlen nicht ablesbar sind,
// nur der Kurvenverlauf sichtbar bleibt.
function renderPortfolioChart(snapshots, { showValues = true } = {}) {
  const ctx = document.getElementById('portfolio-chart');
  const labels = snapshots.map((s) => s.snapshot_date);
  const values = snapshots.map((s) => Number(s.portfolio_value ?? s.index_value));

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: showValues ? 'Portfolio-Wert (EUR)' : 'Entwicklung',
        data: values,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: showValues },
      },
      scales: {
        y: { beginAtZero: false, ticks: { display: showValues } },
      },
    },
  };

  if (portfolioChart) {
    portfolioChart.data.labels = labels;
    portfolioChart.data.datasets[0].data = values;
    portfolioChart.options.plugins.tooltip.enabled = showValues;
    portfolioChart.options.scales.y.ticks.display = showValues;
    portfolioChart.update();
    return;
  }

  portfolioChart = new Chart(ctx, config);
}
