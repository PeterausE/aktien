function parseGermanNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/[€%\s]/g, '');
  if (cleaned === '') return null;

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const value = parseFloat(normalized);
  return Number.isNaN(value) ? null : value;
}

function guessAssetklasse(name) {
  if (/etf/i.test(name)) return 'etf';
  if (/anleihe|bond/i.test(name)) return 'anleihe';
  return 'aktie';
}

// Aktien schuetten Dividenden direkt an den Aktionaer aus - "thesaurierend" ist ein
// Konzept von Fondshuellen (ETF/Anleihe), daher bei Einzelaktien immer 'A'.
function guessAusschuettungsart(name, assetklasse) {
  if (assetklasse === 'aktie') return 'A';
  if (/\b(acc|accumulating|thesaurierend)\b/i.test(name)) return 'T';
  if (/\b(dis|dist|distributing|ausschüttend)\b/i.test(name)) return 'A';
  return null;
}

function parseImportRows(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      const [isin, wertpapier_name, assetklasseRaw, menge, kaufkurs, aktKurs, gesamtProzent, gesamtEuro] = parts;
      const assetklasse = ['aktie', 'etf', 'anleihe'].includes(assetklasseRaw)
        ? assetklasseRaw
        : guessAssetklasse(wertpapier_name || '');

      return {
        isin: isin || '',
        wertpapier_name: wertpapier_name || '',
        assetklasse,
        ausschuettungsart: guessAusschuettungsart(wertpapier_name || '', assetklasse),
        menge: parseGermanNumber(menge),
        kaufpreis_per_einheit: parseGermanNumber(kaufkurs),
        akt_kurs: parseGermanNumber(aktKurs),
        gain_loss_percent: parseGermanNumber(gesamtProzent),
        gain_loss_absolute: parseGermanNumber(gesamtEuro),
      };
    });
}

function renderImportPreview(rows) {
  const container = document.getElementById('import-preview');
  if (rows.length === 0) {
    container.innerHTML = '';
    return;
  }

  const table = document.createElement('table');
  table.className = 'import-preview-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>ISIN</th><th>Name</th><th>Assetklasse</th><th>Typ</th><th>Menge</th>
        <th>Kaufkurs</th><th>Akt. Kurs</th><th>Gesamt %</th><th>Gesamt €</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const incomplete = !row.isin || !row.wertpapier_name || row.menge == null || row.kaufpreis_per_einheit == null;
    if (incomplete) tr.classList.add('row-error');

    tr.innerHTML = `
      <td>${row.isin}</td>
      <td>${row.wertpapier_name}</td>
      <td>
        <select data-index="${i}" class="assetklasse-select">
          <option value="aktie" ${row.assetklasse === 'aktie' ? 'selected' : ''}>Aktie</option>
          <option value="etf" ${row.assetklasse === 'etf' ? 'selected' : ''}>ETF</option>
          <option value="anleihe" ${row.assetklasse === 'anleihe' ? 'selected' : ''}>Anleihe</option>
        </select>
      </td>
      <td>
        <select data-index="${i}" class="typ-select">
          <option value="" ${!row.ausschuettungsart ? 'selected' : ''}>?</option>
          <option value="T" ${row.ausschuettungsart === 'T' ? 'selected' : ''}>T</option>
          <option value="A" ${row.ausschuettungsart === 'A' ? 'selected' : ''}>A</option>
        </select>
      </td>
      <td>${row.menge ?? '–'}</td>
      <td>${row.kaufpreis_per_einheit ?? '–'}</td>
      <td>${row.akt_kurs ?? '–'}</td>
      <td>${row.gain_loss_percent ?? '–'}</td>
      <td>${row.gain_loss_absolute ?? '–'}</td>
    `;
    tbody.appendChild(tr);
  });

  container.innerHTML = '';
  container.appendChild(table);

  const submitBtn = document.createElement('button');
  submitBtn.id = 'import-submit-btn';
  submitBtn.textContent = `${rows.length} Positionen importieren`;
  container.appendChild(submitBtn);

  const statusEl = document.createElement('p');
  statusEl.id = 'import-status';
  container.appendChild(statusEl);

  table.querySelectorAll('.assetklasse-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      rows[Number(e.target.dataset.index)].assetklasse = e.target.value;
    });
  });

  table.querySelectorAll('.typ-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      rows[Number(e.target.dataset.index)].ausschuettungsart = e.target.value || null;
    });
  });

  submitBtn.addEventListener('click', async () => {
    const depot_name = document.getElementById('import-depot').value.trim();
    const broker = document.getElementById('import-broker').value.trim();
    if (!depot_name) {
      statusEl.textContent = 'Bitte Depotnamen angeben.';
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = 'Importiere …';
    try {
      const result = await apiFetch('import', {
        method: 'POST',
        body: JSON.stringify({ depot_name, broker, positions: rows }),
      });
      statusEl.textContent = `${result.imported} Positionen importiert.`;
      document.getElementById('import-raw').value = '';
      container.innerHTML = '';
      await refreshDashboard();
      await loadFilters();
    } catch (err) {
      statusEl.textContent = `Fehler: ${err.message}`;
      submitBtn.disabled = false;
    }
  });
}

const importToggleBtn = document.getElementById('import-toggle-btn');
if (importToggleBtn) {
  importToggleBtn.addEventListener('click', () => {
    const section = document.getElementById('import-section');
    section.hidden = !section.hidden;
  });
}

const importParseBtn = document.getElementById('import-parse-btn');
if (importParseBtn) {
  importParseBtn.addEventListener('click', () => {
    const raw = document.getElementById('import-raw').value;
    renderImportPreview(parseImportRows(raw));
  });
}

const importTabBulk = document.getElementById('import-tab-bulk');
const importTabSingle = document.getElementById('import-tab-single');
if (importTabBulk && importTabSingle) {
  importTabBulk.addEventListener('click', () => {
    importTabBulk.classList.add('active');
    importTabSingle.classList.remove('active');
    document.getElementById('import-bulk-panel').hidden = false;
    document.getElementById('import-single-panel').hidden = true;
  });
  importTabSingle.addEventListener('click', () => {
    importTabSingle.classList.add('active');
    importTabBulk.classList.remove('active');
    document.getElementById('import-single-panel').hidden = false;
    document.getElementById('import-bulk-panel').hidden = true;
  });
}

const singlePositionForm = document.getElementById('single-position-form');
if (singlePositionForm) {
  const nameInput = document.getElementById('sp-name');
  const assetklasseSelect = document.getElementById('sp-assetklasse');
  const typSelect = document.getElementById('sp-typ');
  let typManuallySet = false;
  typSelect.addEventListener('change', () => { typManuallySet = true; });

  nameInput.addEventListener('blur', () => {
    if (!nameInput.value.trim()) return;
    assetklasseSelect.value = guessAssetklasse(nameInput.value);
    if (!typManuallySet) {
      typSelect.value = guessAusschuettungsart(nameInput.value, assetklasseSelect.value) || '';
    }
  });

  singlePositionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statusEl = document.getElementById('single-position-status');
    const submitBtn = singlePositionForm.querySelector('button[type="submit"]');

    const menge = parseGermanNumber(document.getElementById('sp-menge').value);
    const kaufpreis_per_einheit = parseGermanNumber(document.getElementById('sp-kaufpreis').value);
    const akt_kurs = parseGermanNumber(document.getElementById('sp-kurs').value);

    const position = {
      isin: document.getElementById('sp-isin').value.trim(),
      wertpapier_name: nameInput.value.trim(),
      assetklasse: assetklasseSelect.value,
      ausschuettungsart: typSelect.value || null,
      menge,
      kaufpreis_per_einheit,
      kaufdatum: document.getElementById('sp-kaufdatum').value || null,
    };
    if (akt_kurs != null && menge != null) {
      position.akt_kurs = akt_kurs;
      position.akt_wert = akt_kurs * menge;
    }

    submitBtn.disabled = true;
    statusEl.textContent = 'Lege Position an …';
    try {
      await apiFetch('import', {
        method: 'POST',
        body: JSON.stringify({
          depot_name: document.getElementById('sp-depot').value.trim(),
          broker: document.getElementById('sp-broker').value.trim(),
          positions: [position],
        }),
      });
      statusEl.textContent = 'Position angelegt.';
      singlePositionForm.reset();
      typManuallySet = false;
      await refreshDashboard();
      await loadFilters();
    } catch (err) {
      statusEl.textContent = `Fehler: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
