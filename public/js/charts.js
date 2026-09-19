let portfolioChart = null;

function renderPortfolioChart(snapshots) {
  const ctx = document.getElementById('portfolio-chart');
  const labels = snapshots.map((s) => s.snapshot_date);
  const values = snapshots.map((s) => s.portfolio_value);

  if (portfolioChart) {
    portfolioChart.data.labels = labels;
    portfolioChart.data.datasets[0].data = values;
    portfolioChart.update();
    return;
  }

  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Portfolio-Wert (EUR)',
        data: values,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false } },
    },
  });
}
