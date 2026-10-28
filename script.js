'use strict';

(() => {

  const STORAGE_KEY = 'personal-expense-tracker:v1';

  const CATEGORIES = {
    income:  ['Allowance', 'Salary', 'Scholarship', 'Gift', 'Other'],
    expense: ['Food', 'Transport', 'Education', 'Entertainment', 'Shopping', 'Bills', 'Other'],
  };

  const money   = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'LKR' });
  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const $ = (id) => document.getElementById(id);

  const form        = $('txForm');
  const fields      = {
    description: $('description'),
    amount:      $('amount'),
    category:    $('category'),
    date:        $('date'),
  };
  const filterSel   = $('filter');
  const searchInput = $('search');
  const txBody      = $('txBody');
  const tableWrap   = $('tableWrap');
  const emptyState  = $('emptyState');
  const resultCount = $('resultCount');
  const toastEl     = $('toast');

  let transactions = load();
  let toastTimer;
  let activeCategory = null;
  let pieType = 'expense';

  function el(tag, { className, text, attrs } = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const formatDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return dateFmt.format(new Date(y, m - 1, d));
  };

  const makeId = () =>
    (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const getType = () => form.elements.type.value;

  function isValidRecord(t) {
    return t && typeof t.id === 'string'
      && (t.type === 'income' || t.type === 'expense')
      && typeof t.description === 'string'
      && typeof t.category === 'string'
      && Number.isFinite(t.amount) && t.amount > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.filter(isValidRecord) : [];
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch {
      showToast('Could not save in this browser. Your changes will be lost on refresh.');
    }
  }

  function renderSummary() {

    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      const cents = Math.round(t.amount * 100);
      if (t.type === 'income') income += cents; else expense += cents;
    }
    const balance = income - expense;

    countUp('totalIncome', income / 100);
    countUp('totalExpense', expense / 100);
    countUp('balance', balance / 100);
    renderOverview(income, expense);
    $('balanceCard').classList.toggle('is-negative', balance < 0);
  }

  function getVisible() {
    const type = filterSel.value;
    const query = searchInput.value.trim().toLowerCase();

    return transactions
      .filter((t) => (type === 'all' || t.type === type)
        && (!query || t.description.toLowerCase().includes(query) || t.category.toLowerCase().includes(query))
        && (!activeCategory || (t.type === activeCategory.type && t.category === activeCategory.name)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  function buildRow(t) {
    const tr = el('tr');
    const cell = (label, className, child) => {
      const td = el('td', { className, attrs: { 'data-label': label } });
      td.append(child);
      return td;
    };
    const sign = t.type === 'income' ? '+' : '\u2212';

    tr.append(
      cell('Date',        'cell-date', document.createTextNode(formatDate(t.date))),
      cell('Description', 'cell-desc', document.createTextNode(t.description)),
      cell('Type',        '',          el('span', { className: `badge ${t.type}`, text: t.type === 'income' ? 'Income' : 'Expense' })),
      cell('Category',    '',          document.createTextNode(t.category)),
      cell('Amount',      `amount ${t.type}`, document.createTextNode(`${sign} ${money.format(t.amount)}`)),
      cell('Action',      '',          el('button', {
        className: 'btn-delete',
        text: 'Delete',
        attrs: { type: 'button', 'data-id': t.id, 'aria-label': `Delete ${t.description}` },
      }))
    );
    return tr;
  }

  function renderTable() {
    const visible = getVisible();
    txBody.replaceChildren(...visible.map(buildRow));

    const hasAny = transactions.length > 0;
    tableWrap.hidden = visible.length === 0;
    emptyState.hidden = visible.length > 0;
    emptyState.textContent = hasAny
      ? 'No transactions match your filter or search.'
      : 'No transactions found. Add your first one above.';
    resultCount.textContent = hasAny ? `Showing ${visible.length} of ${transactions.length}` : '';

    $('activeFilter').hidden = !activeCategory;
    if (activeCategory) {
      const kind = activeCategory.type === 'income' ? 'income' : 'expense';
      $('activeFilterText').textContent = `Showing all ${kind} transactions in ${activeCategory.name}`;
    }
  }

  function renderCategories() {
    const totals = new Map();
    for (const t of transactions) {
      const key = `${t.type}|${t.category}`;
      const entry = totals.get(key) || { count: 0, cents: 0 };
      entry.count += 1;
      entry.cents += Math.round(t.amount * 100);
      totals.set(key, entry);
    }

    ['income', 'expense'].forEach((type) => {
      const used = [...totals.keys()]
        .filter((key) => key.startsWith(`${type}|`))
        .map((key) => key.slice(type.length + 1));
      const names = [...new Set([...CATEGORIES[type], ...used])];

      $(`${type}Categories`).replaceChildren(...names.map((name) => {
        const { count, cents } = totals.get(`${type}|${name}`) || { count: 0, cents: 0 };
        const pressed = Boolean(activeCategory) && activeCategory.type === type && activeCategory.name === name;

        const chip = el('button', {
          className: `chip chip-${type}`,
          attrs: { type: 'button', 'data-type': type, 'data-category': name, 'aria-pressed': String(pressed) },
        });
        chip.disabled = count === 0;
        chip.append(
          el('span', { className: 'chip-name', text: name }),
          el('span', { className: 'chip-count', text: `${count} ${count === 1 ? 'item' : 'items'}` }),
          el('span', { className: 'chip-total', text: money.format(cents / 100) })
        );
        return chip;
      }));
    });
  }

  const PALETTE = {
    expense: ['#bf3b2d', '#e07a3f', '#d4a017', '#7a5ea8', '#3b7ea1', '#c2517f', '#6b8e3d', '#8a8f8c'],
    income: ['#0e7a55', '#2a9d8f', '#76b947', '#3b7ea1', '#d4a017', '#8a8f8c'],
  };
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function niceCeil(value) {
    const mag = 10 ** Math.floor(Math.log10(value));
    const n = value / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function renderPie() {
    const type = pieType;
    const groups = new Map();
    let total = 0;
    for (const t of transactions) {
      if (t.type !== type) continue;
      const cents = Math.round(t.amount * 100);
      groups.set(t.category, (groups.get(t.category) || 0) + cents);
      total += cents;
    }
    const rows = [...groups].sort((a, b) => b[1] - a[1]);
    const colors = PALETTE[type];

    $('pieLayout').hidden = rows.length === 0;
    $('pieEmpty').hidden = rows.length > 0;
    $('pieEmpty').textContent = `No ${type === 'income' ? 'income' : 'expenses'} recorded yet.`;
    if (!rows.length) return;

    const svg = svgEl('svg', { viewBox: '0 0 42 42', 'aria-hidden': 'true' });
    svg.append(svgEl('circle', { cx: 21, cy: 21, r: 15.9155, fill: 'none', stroke: 'var(--track)', 'stroke-width': 6 }));
    let offset = 25;
    rows.forEach(([, cents], i) => {
      const pct = (cents / total) * 100;
      svg.append(svgEl('circle', {
        cx: 21, cy: 21, r: 15.9155, fill: 'none',
        stroke: colors[i % colors.length], 'stroke-width': 6,
        'stroke-dasharray': `${pct} ${Math.max(0, 100 - pct)}`,
        'stroke-dashoffset': offset,
      }));
      offset -= pct;
    });

    const center = el('div', { className: 'donut-center' });
    center.append(
      el('span', { text: type === 'income' ? 'Total income' : 'Total spent' }),
      el('strong', { text: money.format(total / 100) })
    );
    $('pieChart').replaceChildren(svg, center);

    $('pieLegend').replaceChildren(...rows.map(([name, cents], i) => {
      const pressed = Boolean(activeCategory) && activeCategory.type === type && activeCategory.name === name;
      const dot = el('i', { className: 'dot' });
      dot.style.background = colors[i % colors.length];

      const btn = el('button', {
        className: 'legend-item',
        attrs: { type: 'button', 'data-type': type, 'data-category': name, 'aria-pressed': String(pressed) },
      });
      btn.append(
        dot,
        el('span', { className: 'legend-name', text: name }),
        el('span', { className: 'legend-pct', text: `${((cents / total) * 100).toFixed(1)}%` }),
        el('span', { className: 'legend-amt', text: money.format(cents / 100) })
      );
      const li = el('li');
      li.append(btn);
      return li;
    }));
  }

  function renderBars() {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: monthFmt.format(d),
        year: d.getFullYear(),
        income: 0,
        expense: 0,
      });
    }
    const byKey = new Map(months.map((m) => [m.key, m]));
    for (const t of transactions) {
      const month = byKey.get(t.date.slice(0, 7));
      if (month) month[t.type] += t.amount;
    }

    const max = Math.max(...months.map((m) => Math.max(m.income, m.expense)));
    $('barEmpty').hidden = max > 0;
    $('barChart').hidden = max <= 0;
    if (max <= 0) return;

    const top = niceCeil(max);
    const W = 400, H = 210, L = 40, R = 8, T = 12, B = 28;
    const plotH = H - T - B;
    const group = (W - L - R) / months.length;
    const barW = Math.min(18, group / 3);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });

    [0, 0.5, 1].forEach((f) => {
      const y = T + plotH - f * plotH;
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      const label = svgEl('text', { x: L - 6, y: y + 3, class: 'axis', 'text-anchor': 'end' });
      label.textContent = compact.format(top * f);
      svg.append(label);
    });

    months.forEach((m, i) => {
      const cx = L + group * i + group / 2;
      [['income', -barW - 1], ['expense', 1]].forEach(([type, dx]) => {
        const h = m[type] > 0 ? Math.max((m[type] / top) * plotH, 1.5) : 0;
        const rect = svgEl('rect', { x: cx + dx, y: T + plotH - h, width: barW, height: h, rx: 2, class: `bar bar-${type}` });
        const tip = svgEl('title');
        tip.textContent = `${m.label} ${m.year} ${type}: ${money.format(m[type])}`;
        rect.append(tip);
        svg.append(rect);
      });
      const name = svgEl('text', { x: cx, y: H - 10, class: 'axis', 'text-anchor': 'middle' });
      name.textContent = m.label;
      svg.append(name);
    });
    $('barChart').replaceChildren(svg);
  }

  function renderCharts() {
    renderPie();
    renderBars();
    renderTrend();
  }

  function toggleCategory(type, category) {
    const same = activeCategory && activeCategory.type === type && activeCategory.name === category;
    activeCategory = same ? null : { type, name: category };
    filterSel.value = activeCategory ? type : 'all';
    render();

    if (activeCategory) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('history').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    }
  }

  const shown = { totalIncome: 0, totalExpense: 0, balance: 0 };
  const frames = {};
  let resizeFrame;

  function countUp(id, target) {
    const node = $(id);
    const from = shown[id];
    shown[id] = target;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm || from === target) {
      node.textContent = money.format(target);
      return;
    }
    cancelAnimationFrame(frames[id]);
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 700);
      node.textContent = money.format(from + (target - from) * (1 - (1 - p) ** 3));
      if (p < 1) frames[id] = requestAnimationFrame(step);
    };
    frames[id] = requestAnimationFrame(step);
  }

  function fact(label, value, note) {
    const box = el('div', { className: 'fact' });
    box.append(
      el('span', { className: 'fact-label', text: label }),
      el('strong', { className: 'fact-value', text: value }),
      el('small', { text: note })
    );
    return box;
  }

  function renderOverview(income, expense) {
    const peak = Math.max(income, expense);
    $('meterIncome').style.width = peak ? `${(income / peak) * 100}%` : '0%';
    $('meterExpense').style.width = peak ? `${(expense / peak) * 100}%` : '0%';
    $('meterIncomeText').textContent = money.format(income / 100);
    $('meterExpenseText').textContent = money.format(expense / 100);

    const saved = income - expense;
    const rate = income > 0 ? Math.max(0, Math.min(100, (saved / income) * 100)) : 0;
    $('gaugeFill').setAttribute('stroke-dasharray', `${rate} ${100 - rate}`);
    $('gaugeFill').classList.toggle('is-negative', saved < 0);
    $('gaugeValue').textContent = income > 0 ? `${((saved / income) * 100).toFixed(1)}%` : '\u2014';
    $('gaugeLabel').textContent = saved < 0 ? 'Overspent' : 'Savings rate';

    const expenses = transactions.filter((t) => t.type === 'expense');
    const biggest = expenses.reduce((max, t) => (!max || t.amount > max.amount ? t : max), null);
    const count = expenses.length;
    $('facts').replaceChildren(
      fact('Biggest expense', biggest ? money.format(biggest.amount) : '\u2014',
        biggest ? `${biggest.description}, ${biggest.category}` : 'No expenses yet'),
      fact('Average expense', count ? money.format(expense / 100 / count) : '\u2014',
        `${count} ${count === 1 ? 'expense' : 'expenses'}`),
      fact('Transactions', String(transactions.length),
        `${transactions.length - count} income, ${count} expense`)
    );
  }

  function renderTrend() {
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    $('trendEmpty').hidden = sorted.length > 0;
    $('trendChart').hidden = sorted.length === 0;
    if (!sorted.length) return;

    const toTime = (iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d).getTime();
    };
    const daily = new Map();
    let running = 0;
    for (const t of sorted) {
      running += Math.round(t.amount * 100) * (t.type === 'income' ? 1 : -1);
      daily.set(t.date, running / 100);
    }
    const points = [
      { time: toTime(sorted[0].date) - 86400000, value: 0, date: null },
      ...[...daily].map(([date, value]) => ({ time: toTime(date), value, date })),
    ];

    const W = $('trendChart').clientWidth || 640;
    const H = 230, L = 46, R = 16, T = 14, B = 30;
    const values = points.map((p) => p.value);
    const top = niceCeil(Math.max(...values, 1));
    const bottom = Math.min(...values) < 0 ? -niceCeil(-Math.min(...values)) : 0;
    const t0 = points[0].time;
    const t1 = points[points.length - 1].time;
    const x = (p) => L + ((p.time - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => T + ((top - v) / (top - bottom)) * (H - T - B);

    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    const defs = svgEl('defs');
    const gradient = svgEl('linearGradient', { id: 'trendFill', x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(
      svgEl('stop', { offset: '0%', style: 'stop-color: var(--income); stop-opacity: 0.3' }),
      svgEl('stop', { offset: '100%', style: 'stop-color: var(--income); stop-opacity: 0' })
    );
    defs.append(gradient);
    svg.append(defs);

    [bottom, (bottom + top) / 2, top].forEach((v) => {
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
      const label = svgEl('text', { x: L - 8, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' });
      label.textContent = compact.format(v);
      svg.append(label);
    });

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    svg.append(
      svgEl('path', { d: `${line} L${x(last).toFixed(1)},${y(bottom)} L${x(points[0]).toFixed(1)},${y(bottom)} Z`, fill: 'url(#trendFill)' }),
      svgEl('path', { d: line, class: 'trend-line' })
    );

    points.forEach((p) => {
      if (!p.date) return;
      const dot = svgEl('circle', { cx: x(p), cy: y(p.value), r: 4, class: 'trend-dot' });
      const tip = svgEl('title');
      tip.textContent = `${formatDate(p.date)}: ${money.format(p.value)}`;
      dot.append(tip);
      svg.append(dot);
    });

    const startLabel = svgEl('text', { x: L, y: H - 8, class: 'axis', 'text-anchor': 'start' });
    startLabel.textContent = 'Start';
    const endLabel = svgEl('text', { x: W - R, y: H - 8, class: 'axis', 'text-anchor': 'end' });
    endLabel.textContent = formatDate(last.date);
    svg.append(startLabel, endLabel);

    $('trendChart').replaceChildren(svg);
  }

  function csvCell(value) {
    let text = String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!transactions.length) {
      showToast('Nothing to export yet.');
      return;
    }
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const rows = [
      ['Date', 'Description', 'Type', 'Category', 'Amount (LKR)'],
      ...sorted.map((t) => [t.date, t.description, t.type, t.category, t.amount.toFixed(2)]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = el('a', { attrs: { href: url, download: `expense-tracker-${todayISO()}.csv` } });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('CSV file downloaded.');
  }

  function render() {
    if (activeCategory && !transactions.some((t) => t.type === activeCategory.type && t.category === activeCategory.name)) {
      activeCategory = null;
      filterSel.value = 'all';
    }
    renderSummary();
    renderCategories();
    renderCharts();
    renderTable();
    $('exportBtn').disabled = transactions.length === 0;
  }

  function hideToast() { toastEl.classList.remove('show'); }

  function showToast(message, actionLabel, onAction) {
    clearTimeout(toastTimer);
    toastEl.replaceChildren(el('span', { text: message }));

    if (actionLabel) {
      const btn = el('button', { className: 'toast-action', text: actionLabel, attrs: { type: 'button' } });
      btn.addEventListener('click', () => { onAction(); hideToast(); });
      toastEl.append(btn);
    }
    toastEl.classList.add('show');
    toastTimer = setTimeout(hideToast, 5000);
  }

  function fillCategories() {
    const previous = fields.category.value;
    const options = [new Option('Select a category', ''), ...CATEGORIES[getType()].map((c) => new Option(c, c))];
    fields.category.replaceChildren(...options);
    if (CATEGORIES[getType()].includes(previous)) fields.category.value = previous;
  }

  function setError(name, message = '') {
    $(`error-${name}`).textContent = message;
    if (message) fields[name].setAttribute('aria-invalid', 'true');
    else fields[name].removeAttribute('aria-invalid');
  }

  function validate() {
    const description = fields.description.value.trim();
    const rawAmount   = fields.amount.value.trim();
    const amount      = Number(rawAmount);
    const errors      = {};

    if (!description) errors.description = 'Enter a description.';
    if (!rawAmount) errors.amount = 'Enter an amount.';
    else if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0.';
    if (!fields.category.value) errors.category = 'Choose a category.';
    if (!fields.date.value) errors.date = 'Pick a date.';

    Object.keys(fields).forEach((name) => setError(name, errors[name]));

    const firstBad = Object.keys(fields).find((name) => errors[name]);
    if (firstBad) { fields[firstBad].focus(); return null; }

    return {
      id: makeId(),
      type: getType(),
      description,
      amount: Math.round(amount * 100) / 100,
      category: fields.category.value,
      date: fields.date.value,
      createdAt: Date.now(),
    };
  }

  function resetForm() {
    form.reset();
    fields.date.value = todayISO();
    fillCategories();
    Object.keys(fields).forEach((name) => setError(name));
  }

  function addTransaction(event) {
    event.preventDefault();
    const record = validate();
    if (!record) return;

    transactions.push(record);
    save();
    render();
    resetForm();
    showToast('Transaction added successfully.');
    alert("Added successfully.");
  }

  function deleteTransaction(id) {
    const index = transactions.findIndex((t) => t.id === id);
    if (index === -1) return;

    const [removed] = transactions.splice(index, 1);
    save();
    render();
    showToast('Transaction deleted.', 'Undo', () => {
      transactions.push(removed);
      save();
      render();
    });
  }

  form.addEventListener('submit', addTransaction);
  $('clearBtn').addEventListener('click', () => { resetForm(); fields.description.focus(); });

  form.addEventListener('change', (e) => { if (e.target.name === 'type') fillCategories(); });
  form.addEventListener('input', (e) => { if (fields[e.target.id]) setError(e.target.id); });

  filterSel.addEventListener('change', () => {
    if (activeCategory && filterSel.value !== activeCategory.type) activeCategory = null;
    renderCategories();
    renderTable();
  });
  searchInput.addEventListener('input', renderTable);

  $('categories').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip && !chip.disabled) toggleCategory(chip.dataset.type, chip.dataset.category);
  });

  $('pieLegend').addEventListener('click', (e) => {
    const item = e.target.closest('.legend-item');
    if (item) toggleCategory(item.dataset.type, item.dataset.category);
  });

  $('pieToggle').addEventListener('change', (e) => {
    pieType = e.target.value;
    renderPie();
  });

  $('exportBtn').addEventListener('click', exportCsv);

  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(renderTrend);
  });

  $('showAllBtn').addEventListener('click', () => {
    activeCategory = null;
    filterSel.value = 'all';
    searchInput.value = '';
    render();
  });

  txBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]');
    if (btn) deleteTransaction(btn.dataset.id);
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { transactions = load(); render(); }
  });

  fields.date.value = todayISO();
  fillCategories();
  render();
})();
