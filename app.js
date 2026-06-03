/* =========================================================
   Annuitätendarlehen-Rechner – Logik
   Reines Vanilla-JavaScript, läuft komplett im Browser.
   ========================================================= */
'use strict';

/* ----------------------------------------------------------
   1. Formatierung (deutsch)
---------------------------------------------------------- */
const fmtEUR = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtNum = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtPct = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Robuste deutsche Zahlenerkennung.
 * "1.200" -> 1200, "1.200,50" -> 1200.5, "3,5" -> 3.5, "3.5" -> 3.5,
 * "1.200.000" -> 1200000, "1,200.50" -> 1200.5
 */
function parseNum(input) {
  if (typeof input === 'number') return input;
  if (input === null || input === undefined) return 0;
  let s = String(input).trim().replace(/\s/g, '').replace(/[€%]/g, '');
  s = s.replace(/[^0-9.,-]/g, '');
  if (s === '' || s === '-') return 0;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep = null;

  if (lastComma > -1 && lastDot > -1) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma > -1) {
    decimalSep = s.indexOf(',') === lastComma ? ',' : null;
  } else if (lastDot > -1) {
    if (s.indexOf('.') !== lastDot) {
      decimalSep = null;
    } else {
      const after = s.length - lastDot - 1;
      decimalSep = after === 3 ? null : '.';
    }
  }

  if (decimalSep === ',') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (decimalSep === '.') {
    s = s.replace(/,/g, '');
  } else {
    s = s.replace(/[.,]/g, '');
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Label "MM/JJJJ" für einen Monat. */
function monthLabel(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

/* ----------------------------------------------------------
   2. Zustand (State)
---------------------------------------------------------- */
const state = {
  ratePhases: [],          // [{ from:'YYYY-MM', value:'3,5' }] – Zinsänderungen
  paymentPhases: [],       // [{ from:'YYYY-MM', value:'1.500' }] – Ratenänderungen
  sonderMap: new Map(),    // monatsindex (0-basiert) -> Sondertilgung (€)
  view: 'month',           // 'month' | 'year' (Tabelle)
  chartOpts: { granularity: 'auto', size: 'm', layout: 'grid' },
  result: null,
  charts: {},
};

const MAX_MONTHS = 1200;
const EPS = 0.005;

/* ----------------------------------------------------------
   3. Eingaben lesen + Phasen in Monats-Maps umwandeln
---------------------------------------------------------- */
/** Wandelt eine Phasenliste in eine Map Monatsindex -> Wert um. */
function buildPhaseMap(phases, startYear, startMonth) {
  const map = new Map();
  for (const p of phases) {
    if (!p.from || p.value === '' || p.value === null || p.value === undefined) continue;
    const [y, mo] = p.from.split('-').map(Number);
    if (!y || !mo) continue;
    let idx = (y - startYear) * 12 + ((mo - 1) - startMonth);
    if (idx < 0) idx = 0;
    map.set(idx, parseNum(p.value));
  }
  return map;
}

function readInputs() {
  const principal = parseNum(document.getElementById('principal').value);
  const baseRatePct = parseNum(document.getElementById('ratePct').value);
  const monthlyPayment = parseNum(document.getElementById('monthlyPayment').value);
  let interestOnlyMonths = Math.max(0, Math.round(parseNum(document.getElementById('interestOnlyMonths').value)));
  const startStr = document.getElementById('startMonth').value || '2026-06';
  const [y, mo] = startStr.split('-').map(Number);
  const startYear = y;
  const startMonth = (mo || 1) - 1;
  return {
    principal, baseRatePct, monthlyPayment, interestOnlyMonths, startYear, startMonth,
    rateChanges: buildPhaseMap(state.ratePhases, startYear, startMonth),
    paymentChanges: buildPhaseMap(state.paymentPhases, startYear, startMonth),
    sonderMap: state.sonderMap,
  };
}

/* ----------------------------------------------------------
   4. Rechenkern
---------------------------------------------------------- */
function computeSchedule(cfg) {
  const { principal, baseRatePct, monthlyPayment, interestOnlyMonths,
          startYear, startMonth, rateChanges, paymentChanges, sonderMap } = cfg;
  const warnings = [];

  if (principal <= 0)       warnings.push('Bitte eine Kreditsumme größer 0 eingeben.');
  if (monthlyPayment <= 0)  warnings.push('Bitte eine monatliche Rate größer 0 eingeben.');
  if (warnings.length > 0) return { rows: [], summary: null, warnings };

  const rows = [];
  let balance = principal;
  let currentRatePct = baseRatePct;
  let currentPayment = monthlyPayment;
  let cumInterest = 0, cumPrincipal = 0;
  let sumPayment = 0, sumSonder = 0, sumInterest = 0;

  for (let m = 0; m < MAX_MONTHS; m++) {
    if (rateChanges.has(m)) currentRatePct = rateChanges.get(m);
    if (paymentChanges.has(m)) currentPayment = paymentChanges.get(m);

    const monthlyRate = currentRatePct / 100 / 12;
    const interest = round2(balance * monthlyRate);

    let principalPortion;
    let payment;
    const isInterestOnly = m < interestOnlyMonths;

    if (isInterestOnly) {
      // Tilgungsfreie Anlaufphase: nur Zinsen, keine planmäßige Tilgung
      principalPortion = 0;
      payment = interest;
    } else {
      principalPortion = round2(currentPayment - interest);
      payment = currentPayment;
      if (principalPortion <= 0) {
        const where = m === 0 ? '' : `ab ${monthLabel(new Date(startYear, startMonth + m, 1))} `;
        warnings.push(
          `Die Rate (${fmtEUR.format(currentPayment)}) deckt ${where}die Zinsen ` +
          `(${fmtEUR.format(interest)}) nicht – ab hier kann nicht getilgt werden. ` +
          `Berechnung an dieser Stelle gestoppt. Bitte die Rate erhöhen.`);
        break;
      }
      if (principalPortion > balance) {
        principalPortion = round2(balance);
        payment = round2(interest + principalPortion);
      }
    }

    let newBalance = round2(balance - principalPortion);

    let sonder = sonderMap.get(m) || 0;
    if (sonder < 0) sonder = 0;
    if (sonder > newBalance) sonder = newBalance;
    sonder = round2(sonder);
    newBalance = round2(newBalance - sonder);

    cumInterest = round2(cumInterest + interest);
    cumPrincipal = round2(cumPrincipal + principalPortion + sonder);
    sumPayment = round2(sumPayment + payment);
    sumSonder = round2(sumSonder + sonder);
    sumInterest = round2(sumInterest + interest);

    rows.push({
      idx: m,
      date: new Date(startYear, startMonth + m, 1),
      ratePct: currentRatePct,
      payment, interest,
      principal: principalPortion,
      sonder,
      balance: newBalance,
      interestOnly: isInterestOnly,
      cumInterest, cumPrincipal,
    });

    balance = newBalance;
    if (balance <= EPS) break;
  }

  if (rows.length && balance > EPS) {
    warnings.push('Der Kredit ist innerhalb des berechneten Zeitraums noch nicht vollständig getilgt.');
  }

  const months = rows.length;
  const summary = {
    months,
    years: Math.floor(months / 12),
    remMonths: months % 12,
    interestOnlyMonths: Math.min(interestOnlyMonths, months),
    lastDate: months ? rows[months - 1].date : null,
    totalInterest: sumInterest,
    totalSonder: sumSonder,
    totalPaid: round2(sumPayment + sumSonder),
    endBalance: months ? rows[months - 1].balance : principal,
    principal,
    fullyRepaid: balance <= EPS,
  };

  return { rows, summary, warnings };
}

/* ----------------------------------------------------------
   5. Jährliche Aggregation
---------------------------------------------------------- */
function aggregateYearly(rows) {
  const map = new Map();
  for (const r of rows) {
    const y = r.date.getFullYear();
    if (!map.has(y)) {
      map.set(y, {
        year: y, payment: 0, interest: 0, principal: 0, sonder: 0,
        balance: r.balance, ratePct: r.ratePct,
        cumInterest: r.cumInterest, cumPrincipal: r.cumPrincipal,
      });
    }
    const o = map.get(y);
    o.payment = round2(o.payment + r.payment);
    o.interest = round2(o.interest + r.interest);
    o.principal = round2(o.principal + r.principal);
    o.sonder = round2(o.sonder + r.sonder);
    o.balance = r.balance;
    o.ratePct = r.ratePct;
    o.cumInterest = r.cumInterest;
    o.cumPrincipal = r.cumPrincipal;
  }
  return [...map.values()];
}

/* ----------------------------------------------------------
   6. Phasen-Editor (Zins & Rate, generisch)
---------------------------------------------------------- */
const PHASE_CONF = {
  rate:    { arr: 'ratePhases',    listId: 'ratePhaseList',    unit: '%', placeholder: 'z. B. 3,5',
             empty: 'Noch keine Zinsänderung – es gilt durchgehend der Sollzinssatz oben.' },
  payment: { arr: 'paymentPhases', listId: 'paymentPhaseList', unit: '€', placeholder: 'z. B. 1.500',
             empty: 'Noch keine Ratenänderung – es gilt durchgehend die monatliche Rate oben.' },
};

function renderPhaseList(kind) {
  const c = PHASE_CONF[kind];
  const arr = state[c.arr];
  const list = document.getElementById(c.listId);
  if (!arr.length) {
    list.innerHTML = `<p class="hint empty-phase">${c.empty}</p>`;
    return;
  }
  list.innerHTML = arr.map((p, i) => `
    <div class="phase-row" data-kind="${kind}" data-idx="${i}">
      <span class="phase-label">ab</span>
      <input type="month" class="phase-from" data-kind="${kind}" data-idx="${i}" value="${p.from || ''}" />
      <span class="phase-eq">→</span>
      <div class="input-affix phase-rate-wrap">
        <input type="text" class="phase-val" inputmode="decimal" data-kind="${kind}" data-idx="${i}"
               value="${p.value || ''}" placeholder="${c.placeholder}" />
        <span class="affix">${c.unit}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-small phase-remove" data-kind="${kind}" data-idx="${i}" title="Entfernen">✕</button>
    </div>`).join('');
}

function addPhase(kind) {
  const startStr = document.getElementById('startMonth').value || '2026-06';
  const [y, mo] = startStr.split('-').map(Number);
  const d = new Date(y, (mo - 1) + 60, 1); // Vorschlag: 5 Jahre nach Beginn
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  state[PHASE_CONF[kind].arr].push({ from, value: '' });
  renderPhaseList(kind);
}

/* ----------------------------------------------------------
   7. Rendering – Warnungen, Zusammenfassung, Tabelle
---------------------------------------------------------- */
function renderWarnings(warnings) {
  const el = document.getElementById('warning');
  if (warnings && warnings.length) {
    el.innerHTML = warnings.map((w) => `<div>⚠️ ${w}</div>`).join('');
    el.hidden = false;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function renderSummary(summary) {
  const el = document.getElementById('summary');
  if (!summary || summary.months === 0) {
    el.innerHTML = '<p class="hint">Noch keine Berechnung möglich – bitte Eingaben prüfen.</p>';
    return;
  }
  const laufzeit = summary.years > 0
    ? `${summary.years} J. ${summary.remMonths} Mon.`
    : `${summary.remMonths} Mon.`;
  const items = [
    { label: 'Laufzeit', value: laufzeit, cls: 'accent' },
    { label: 'Anzahl Raten', value: String(summary.months) },
    { label: 'Letzte Rate', value: summary.lastDate ? monthLabel(summary.lastDate) : '–' },
    { label: 'Summe Zinsen', value: fmtEUR.format(summary.totalInterest), cls: 'zins' },
    { label: 'Summe Sondertilgungen', value: fmtEUR.format(summary.totalSonder) },
    { label: 'Gesamtzahlungen', value: fmtEUR.format(summary.totalPaid), cls: 'accent' },
    { label: 'Restschuld am Ende', value: fmtEUR.format(summary.endBalance) },
  ];
  if (summary.interestOnlyMonths > 0) {
    items.splice(1, 0, { label: 'Tilgungsfrei', value: `${summary.interestOnlyMonths} Mon.` });
  }
  el.innerHTML = items.map((i) =>
    `<div class="summary-item ${i.cls || ''}">
       <div class="label">${i.label}</div>
       <div class="value">${i.value}</div>
     </div>`).join('');
}

function renderTable(rows) {
  const head = document.getElementById('planHead');
  const body = document.getElementById('planBody');

  if (!rows.length) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td>Keine Daten – bitte Eingaben prüfen.</td></tr>';
    return;
  }

  if (state.view === 'year') {
    head.innerHTML = `<tr>
      <th>Jahr</th><th>Zinssatz</th><th>Summe Rate</th><th>Zinsen</th>
      <th>Tilgung</th><th>Sondertilgung</th><th>Restschuld (Jahresende)</th>
    </tr>`;
    const years = aggregateYearly(rows);
    body.innerHTML = years.map((y) => `<tr class="year-row">
      <td>${y.year}</td>
      <td>${fmtPct.format(y.ratePct)} %</td>
      <td>${fmtEUR.format(y.payment)}</td>
      <td>${fmtEUR.format(y.interest)}</td>
      <td>${fmtEUR.format(y.principal)}</td>
      <td>${fmtEUR.format(y.sonder)}</td>
      <td>${fmtEUR.format(y.balance)}</td>
    </tr>`).join('');
    return;
  }

  head.innerHTML = `<tr>
    <th>Nr.</th><th>Monat</th><th>Zinssatz</th><th>Rate</th>
    <th>Zinsen</th><th>Tilgung</th><th>Sondertilgung</th><th>Restschuld</th>
  </tr>`;

  const html = rows.map((r) => {
    const sonderOverride = state.sonderMap.has(r.idx) && state.sonderMap.get(r.idx) > 0;
    const isYearEnd = (r.idx % 12) === 11;
    const sonderVal = sonderOverride ? fmtNum.format(state.sonderMap.get(r.idx)) : '';
    const tilgungCell = r.interestOnly
      ? '<span class="badge-io">tilgungsfrei</span>'
      : fmtEUR.format(r.principal);
    return `<tr class="${isYearEnd ? 'year-end' : ''} ${r.interestOnly ? 'io-row' : ''}">
      <td>${r.idx + 1}</td>
      <td>${monthLabel(r.date)}</td>
      <td>${fmtPct.format(r.ratePct)} %</td>
      <td>${fmtEUR.format(r.payment)}</td>
      <td>${fmtEUR.format(r.interest)}</td>
      <td>${tilgungCell}</td>
      <td><input class="cell-input sonder-input ${sonderOverride ? 'has-override' : ''}"
            type="text" inputmode="decimal" data-idx="${r.idx}"
            value="${sonderVal}" placeholder="0,00" /></td>
      <td>${fmtEUR.format(r.balance)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = html;
}

/* ----------------------------------------------------------
   8. Diagramme (Chart.js)
---------------------------------------------------------- */
function chartSeries(rows) {
  const g = state.chartOpts.granularity;
  const yearly = g === 'year' || (g === 'auto' && rows.length >= 24);
  if (yearly) {
    return aggregateYearly(rows).map((y) => ({
      label: String(y.year),
      interest: y.interest, principal: y.principal, sonder: y.sonder,
      balance: y.balance, cumInterest: y.cumInterest, cumPrincipal: y.cumPrincipal,
    }));
  }
  return rows.map((r) => ({
    label: monthLabel(r.date),
    interest: r.interest, principal: r.principal, sonder: r.sonder,
    balance: r.balance, cumInterest: r.cumInterest, cumPrincipal: r.cumPrincipal,
  }));
}

/** Wendet Größe/Layout an (CSS-Klassen) und zeichnet die Diagramme neu. */
function applyChartControls() {
  const card = document.getElementById('charts-card');
  card.classList.remove('size-s', 'size-m', 'size-l');
  card.classList.add('size-' + state.chartOpts.size);
  document.getElementById('chartsGrid').classList.toggle('single', state.chartOpts.layout === 'single');
  if (state.result) renderCharts(state.result.rows);
}

function renderCharts(rows) {
  if (typeof Chart === 'undefined') return;
  const css = getComputedStyle(document.documentElement);
  const colZins = css.getPropertyValue('--zins').trim() || '#e07a5f';
  const colTilgung = css.getPropertyValue('--tilgung').trim() || '#0d7e8c';
  const colSonder = css.getPropertyValue('--sonder').trim() || '#6c5ce7';
  const colText = css.getPropertyValue('--text-muted').trim() || '#666';
  const colGrid = css.getPropertyValue('--border').trim() || '#ddd';

  Object.values(state.charts).forEach((c) => c && c.destroy());
  state.charts = {};

  if (!rows.length) return;
  const s = chartSeries(rows);
  const labels = s.map((d) => d.label);

  const euroTick = (v) => fmtEUR.format(v);
  const baseScales = {
    x: { ticks: { color: colText, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: colGrid } },
    y: { ticks: { color: colText, callback: euroTick }, grid: { color: colGrid }, beginAtZero: true },
  };
  const legend = { labels: { color: colText, usePointStyle: true } };
  // Tooltip im "index"-Modus: zeigt beim Hovern alle Werte des Zeitpunkts
  const tooltip = {
    enabled: true,
    callbacks: {
      title: (items) => (items.length ? items[0].label : ''),
      label: (ctx) => `${ctx.dataset.label}: ${fmtEUR.format(ctx.parsed.y)}`,
      footer: (items) => {
        if (items.length < 2) return '';
        const sum = items.reduce((a, it) => a + (it.parsed.y || 0), 0);
        return 'Summe: ' + fmtEUR.format(sum);
      },
    },
  };
  const interaction = { mode: 'index', intersect: false };
  const hover = { mode: 'index', intersect: false };
  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction, hover,
    plugins: { legend, tooltip },
  };

  state.charts.balance = new Chart(document.getElementById('chartBalance'), {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Restschuld', data: s.map((d) => d.balance),
      borderColor: colTilgung, backgroundColor: colTilgung + '33',
      fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
    }] },
    options: { ...baseOpts, scales: baseScales },
  });

  state.charts.composition = new Chart(document.getElementById('chartComposition'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Zinsen', data: s.map((d) => d.interest), backgroundColor: colZins },
      { label: 'Tilgung', data: s.map((d) => d.principal), backgroundColor: colTilgung },
      { label: 'Sondertilgung', data: s.map((d) => d.sonder), backgroundColor: colSonder },
    ] },
    options: { ...baseOpts,
      scales: { x: { ...baseScales.x, stacked: true }, y: { ...baseScales.y, stacked: true } } },
  });

  state.charts.cumulative = new Chart(document.getElementById('chartCumulative'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Kumulierte Zinsen', data: s.map((d) => d.cumInterest),
        borderColor: colZins, backgroundColor: colZins + '22', fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
      { label: 'Kumulierte Tilgung', data: s.map((d) => d.cumPrincipal),
        borderColor: colTilgung, backgroundColor: colTilgung + '22', fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
    ] },
    options: { ...baseOpts, scales: baseScales },
  });
}

/* ----------------------------------------------------------
   9. Haupt-Recalc
---------------------------------------------------------- */
function recalc() {
  const cfg = readInputs();
  const result = computeSchedule(cfg);
  state.result = result;
  renderWarnings(result.warnings);
  renderSummary(result.summary);
  renderTable(result.rows);
  renderCharts(result.rows);
}

/* ----------------------------------------------------------
   10. Export (Excel / PDF / CSV)
---------------------------------------------------------- */
// Excel-Zahlenformate
const XLS_EUR = '#,##0.00\\ €';
const XLS_PCT = '0.00" %"';
const XLS_INT = '0';

/** Setzt für eine Spalte (0-basiert) ab Datenzeile 1 ein Zahlenformat. */
function setColFormat(ws, range, col, fmt) {
  for (let R = 1; R <= range.e.r; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: col })];
    if (cell && typeof cell.v === 'number') { cell.t = 'n'; cell.z = fmt; }
  }
}

function exportXLS() {
  if (typeof XLSX === 'undefined') { alert('Excel-Bibliothek konnte nicht geladen werden (Internetverbindung?).'); return; }
  const { rows, summary } = state.result || {};
  if (!rows || !rows.length) { alert('Bitte zuerst eine Berechnung durchführen.'); return; }

  /* --- Tilgungsplan (mit Phase-Spalte, jede Zelle formatiert) --- */
  const planHeader = ['Nr.', 'Monat', 'Phase', 'Zinssatz (% p.a.)', 'Rate (€)',
                      'Zinsen (€)', 'Tilgung (€)', 'Sondertilgung (€)', 'Restschuld (€)'];
  const planAoa = [planHeader];
  for (const r of rows) {
    planAoa.push([
      r.idx + 1, monthLabel(r.date), r.interestOnly ? 'Tilgungsfrei' : 'Tilgung',
      r.ratePct, r.payment, r.interest, r.principal, r.sonder, r.balance,
    ]);
  }
  const wsPlan = XLSX.utils.aoa_to_sheet(planAoa);
  const planRange = XLSX.utils.decode_range(wsPlan['!ref']);
  setColFormat(wsPlan, planRange, 0, XLS_INT);
  setColFormat(wsPlan, planRange, 3, XLS_PCT);
  [4, 5, 6, 7, 8].forEach((c) => setColFormat(wsPlan, planRange, c, XLS_EUR));
  wsPlan['!cols'] = [{ wch: 5 }, { wch: 9 }, { wch: 12 }, { wch: 15 }, { wch: 13 },
                     { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 14 }];
  wsPlan['!freeze'] = { xSplit: 0, ySplit: 1 };

  /* --- Zusammenfassung (Werte formatiert) --- */
  const sumAoa = [
    ['Kennzahl', 'Wert'],
    ['Kreditsumme', summary.principal, XLS_EUR],
    ['Anzahl Raten', summary.months, XLS_INT],
    ['Tilgungsfreie Monate', summary.interestOnlyMonths, XLS_INT],
    ['Laufzeit (Jahre)', round2(summary.years + summary.remMonths / 12), '0.00'],
    ['Summe Zinsen', summary.totalInterest, XLS_EUR],
    ['Summe Sondertilgungen', summary.totalSonder, XLS_EUR],
    ['Gesamtzahlungen', summary.totalPaid, XLS_EUR],
    ['Restschuld am Ende', summary.endBalance, XLS_EUR],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(sumAoa.map((r) => [r[0], r[1]]));
  for (let i = 1; i < sumAoa.length; i++) {
    const cell = wsSum[XLSX.utils.encode_cell({ r: i, c: 1 })];
    if (cell) { cell.t = 'n'; cell.z = sumAoa[i][2]; }
  }
  wsSum['!cols'] = [{ wch: 24 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSum, 'Zusammenfassung');
  XLSX.utils.book_append_sheet(wb, wsPlan, 'Tilgungsplan');
  XLSX.writeFile(wb, 'Tilgungsplan_Annuitaetendarlehen.xlsx');
}

function exportPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung?).'); return; }
  const { rows, summary } = state.result || {};
  if (!rows || !rows.length) { alert('Bitte zuerst eine Berechnung durchführen.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - 2 * margin;

  doc.setFontSize(16);
  doc.text('Tilgungsplan – Annuitätendarlehen', margin, 18);
  doc.setFontSize(10);
  const lines = [
    `Kreditsumme: ${fmtEUR.format(summary.principal)}`,
    `Laufzeit: ${summary.years} Jahre ${summary.remMonths} Monate (${summary.months} Raten)` +
      (summary.interestOnlyMonths > 0 ? `, davon ${summary.interestOnlyMonths} Mon. tilgungsfrei` : ''),
    `Summe Zinsen: ${fmtEUR.format(summary.totalInterest)}`,
    `Summe Sondertilgungen: ${fmtEUR.format(summary.totalSonder)}`,
    `Gesamtzahlungen: ${fmtEUR.format(summary.totalPaid)}`,
  ];
  lines.forEach((t, i) => doc.text(t, margin, 28 + i * 6));

  /* --- Grafiken einbetten --- */
  let y = 28 + lines.length * 6 + 8;
  const captions = {
    balance: 'Restschuldverlauf',
    composition: 'Zusammensetzung der Zahlungen (Zins / Tilgung / Sondertilgung)',
    cumulative: 'Kumulierte Zinsen & Tilgung',
  };
  for (const key of ['balance', 'composition', 'cumulative']) {
    const chart = state.charts[key];
    if (!chart) continue;
    let img;
    try { img = chart.toBase64Image('image/png', 1); } catch (e) { continue; }
    const ratio = (chart.height && chart.width) ? chart.height / chart.width : 0.42;
    let h = contentW * ratio;
    if (h > 70) h = 70;
    if (y + h + 8 > pageH - margin) { doc.addPage(); y = margin; }
    doc.setFontSize(9);
    doc.text(captions[key], margin, y);
    y += 3;
    doc.addImage(img, 'PNG', margin, y, contentW, h);
    y += h + 8;
  }

  /* --- Tilgungsplan-Tabelle auf neuer Seite --- */
  doc.addPage();
  doc.setFontSize(13);
  doc.text('Tilgungsplan', margin, 16);
  const body = rows.map((r) => [
    r.idx + 1, monthLabel(r.date), fmtPct.format(r.ratePct) + ' %',
    fmtEUR.format(r.payment), fmtEUR.format(r.interest),
    r.interestOnly ? 'tilgungsfrei' : fmtEUR.format(r.principal),
    fmtEUR.format(r.sonder), fmtEUR.format(r.balance),
  ]);
  doc.autoTable({
    head: [['Nr.', 'Monat', 'Zins %', 'Rate', 'Zinsen', 'Tilgung', 'Sonder', 'Restschuld']],
    body,
    startY: 22,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [13, 126, 140] },
    columnStyles: { 0: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
                    5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
  });
  doc.save('Tilgungsplan_Annuitaetendarlehen.pdf');
}

function exportCSV() {
  const { rows } = state.result || {};
  if (!rows || !rows.length) { alert('Bitte zuerst eine Berechnung durchführen.'); return; }
  const header = ['Nr.', 'Monat', 'Zinssatz (% p.a.)', 'Rate', 'Zinsen', 'Tilgung', 'Sondertilgung', 'Restschuld'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.idx + 1, monthLabel(r.date), fmtPct.format(r.ratePct),
      fmtNum.format(r.payment), fmtNum.format(r.interest),
      fmtNum.format(r.principal), fmtNum.format(r.sonder), fmtNum.format(r.balance),
    ].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'Tilgungsplan_Annuitaetendarlehen.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------------
   11. Events
---------------------------------------------------------- */
function bindEvents() {
  ['principal', 'ratePct', 'monthlyPayment', 'startMonth', 'interestOnlyMonths'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalc);
  });

  document.getElementById('btnRecalc').addEventListener('click', recalc);

  document.getElementById('btnReset').addEventListener('click', () => {
    state.ratePhases = [];
    state.paymentPhases = [];
    state.sonderMap.clear();
    document.getElementById('principal').value = '250.000';
    document.getElementById('ratePct').value = '3,0';
    document.getElementById('monthlyPayment').value = '1.200';
    document.getElementById('startMonth').value = '2026-06';
    document.getElementById('interestOnlyMonths').value = '0';
    document.getElementById('yearlySonderAmount').value = '';
    renderPhaseList('rate');
    renderPhaseList('payment');
    recalc();
  });

  // Rate aus anfänglicher Tilgung berechnen
  document.getElementById('btnCalcRate').addEventListener('click', () => {
    const principal = parseNum(document.getElementById('principal').value);
    const rate = parseNum(document.getElementById('ratePct').value);
    const tilgung = parseNum(document.getElementById('initialTilgungPct').value);
    if (principal > 0 && (rate + tilgung) > 0) {
      const monthly = principal * ((rate + tilgung) / 100) / 12;
      document.getElementById('monthlyPayment').value = fmtNum.format(round2(monthly));
      recalc();
    }
  });

  /* --- Phasen (Zins & Rate) --- */
  document.getElementById('btnAddRatePhase').addEventListener('click', () => addPhase('rate'));
  document.getElementById('btnAddPaymentPhase').addEventListener('click', () => addPhase('payment'));

  ['ratePhaseList', 'paymentPhaseList'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('input', (e) => {
      const t = e.target;
      const kind = t.dataset.kind;
      const i = parseInt(t.dataset.idx, 10);
      if (!kind || isNaN(i) || !state[PHASE_CONF[kind].arr][i]) return;
      if (t.classList.contains('phase-from')) state[PHASE_CONF[kind].arr][i].from = t.value;
      else if (t.classList.contains('phase-val')) state[PHASE_CONF[kind].arr][i].value = t.value;
      recalc();
    });
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.phase-remove');
      if (!btn) return;
      const kind = btn.dataset.kind;
      const i = parseInt(btn.dataset.idx, 10);
      state[PHASE_CONF[kind].arr].splice(i, 1);
      renderPhaseList(kind);
      recalc();
    });
  });

  /* --- Ansicht umschalten (Tabelle) --- */
  document.querySelectorAll('.btn-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      document.querySelectorAll('.btn-toggle').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.getElementById('editHint').style.display = state.view === 'month' ? '' : 'none';
      renderTable(state.result ? state.result.rows : []);
    });
  });

  /* --- Diagramm-Regler (Raster / Größe / Layout) --- */
  document.querySelectorAll('.chart-controls .btn-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.parentElement;
      group.querySelectorAll('.btn-chip').forEach((b) => b.classList.toggle('is-active', b === btn));
      if (btn.dataset.gran) state.chartOpts.granularity = btn.dataset.gran;
      if (btn.dataset.size) state.chartOpts.size = btn.dataset.size;
      if (btn.dataset.layout) state.chartOpts.layout = btn.dataset.layout;
      applyChartControls();
    });
  });

  /* --- Sondertilgung in Tabelle editieren --- */
  document.getElementById('planBody').addEventListener('change', (e) => {
    const t = e.target;
    if (!t.classList || !t.classList.contains('sonder-input')) return;
    const idx = parseInt(t.dataset.idx, 10);
    const val = parseNum(t.value);
    if (t.value.trim() === '' || val <= 0) state.sonderMap.delete(idx);
    else state.sonderMap.set(idx, val);
    recalc();
  });

  /* --- Jährliche Sondertilgung --- */
  document.getElementById('btnApplyYearly').addEventListener('click', () => {
    const amount = parseNum(document.getElementById('yearlySonderAmount').value);
    if (!state.result || !state.result.rows.length) recalc();
    const total = state.result && state.result.rows.length ? state.result.rows.length : 360;
    const years = Math.ceil(total / 12);
    for (let y = 1; y <= years; y++) {
      const idx = y * 12 - 1;
      if (idx < total) {
        if (amount > 0) state.sonderMap.set(idx, amount);
        else state.sonderMap.delete(idx);
      }
    }
    recalc();
  });

  document.getElementById('btnClearSonder').addEventListener('click', () => {
    state.sonderMap.clear();
    recalc();
  });

  /* --- Tabelle ein-/ausklappen + Scrollen --- */
  document.getElementById('btnCollapsePlan').addEventListener('click', (e) => {
    const card = document.getElementById('plan-card');
    const collapsed = card.classList.toggle('collapsed');
    e.target.textContent = collapsed ? 'Tabelle ausklappen' : 'Tabelle einklappen';
    e.target.setAttribute('aria-expanded', String(!collapsed));
  });
  document.getElementById('btnScrollTop').addEventListener('click', () => {
    document.getElementById('planScroll').scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('btnScrollBottom').addEventListener('click', () => {
    const el = document.getElementById('planScroll');
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  });

  /* --- Export --- */
  document.getElementById('btnXls').addEventListener('click', exportXLS);
  document.getElementById('btnPdf').addEventListener('click', exportPDF);
  document.getElementById('btnCsv').addEventListener('click', exportCSV);
}

/* ----------------------------------------------------------
   12. Init
---------------------------------------------------------- */
bindEvents();
renderPhaseList('rate');
renderPhaseList('payment');
applyChartControls();
recalc();
