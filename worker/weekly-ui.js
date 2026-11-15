export const weeklyPage = String.raw`<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Weekly report | Black Market Coffee</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #202624;
      --muted: #525d58;
      --paper: #fff;
      --background: #f4f5f2;
      --line: #dce1da;
      --accent: #a5282c;
      --green: #263e35;
      font: 1rem/1.5 "Trebuchet MS", system-ui, sans-serif;
      background: var(--background);
      color: var(--ink);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body, h1, h2, h3, p, dl, dd { margin: 0; }
    button, input { font: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    a { color: inherit; text-underline-offset: .2em; }
    :focus-visible { outline: 3px solid #a5282c; outline-offset: 3px; }
    .wrap { width: min(100% - 3rem, 66rem); margin-inline: auto; }
    header { background: var(--paper); border-bottom: 1px solid var(--line); }
    .bar, .brand, .actions, .week-nav { display: flex; align-items: center; gap: .65rem; }
    .bar { justify-content: space-between; min-height: 4.25rem; }
    .brand { font-size: .9rem; font-weight: 700; text-decoration: none; }
    .mark { background: var(--accent); color: white; padding: .48rem .55rem; border-radius: .22rem; }
    .button { border: 1px solid var(--line); border-radius: .35rem; background: var(--paper); color: var(--ink); padding: .45rem .8rem; min-height: 2.5rem; }
    .actions .button { white-space: nowrap; }
    .primary { background: var(--accent); border-color: var(--accent); color: white; }
    .quiet { border-color: transparent; }
    .button:hover:not(:disabled) { border-color: var(--muted); }
    main.report { padding-block: 2rem 3rem; }
    .intro { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1rem; }
    h1 { font-size: clamp(1.8rem, 5vw, 2.7rem); letter-spacing: -.04em; line-height: 1.13; }
    h2 { font-size: 1.03rem; line-height: 1.3; }
    .dates, .status, .note, dt, .source-list { color: var(--muted); }
    .dates { margin-top: .3rem; }
    .status { font-size: .82rem; margin-bottom: 1rem; min-height: 1.2em; }
    .error { color: #912125; }
    .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
    .panel { min-width: 0; background: var(--paper); border: 1px solid var(--line); border-radius: .55rem; padding: clamp(1rem, 2.6vw, 1.55rem); }
    .production, .stock { grid-column: 1 / -1; }
    .production { background: var(--green); color: #fff; border-color: var(--green); }
    .production .note, .production dt { color: #d7e4dc; }
    .primary-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: .25rem 1.15rem; margin-block: .45rem .7rem; }
    .figure { font-size: clamp(1.8rem, 5vw, 2.7rem); line-height: 1.15; font-weight: 700; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
    .production .figure { font-size: clamp(2.5rem, 8vw, 4rem); }
    .change { font-size: .9rem; font-weight: 700; }
    .split { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem 1rem; }
    .split.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    dt { font-size: .79rem; line-height: 1.35; }
    dd { font-size: 1.05rem; font-weight: 700; margin-top: .18rem; font-variant-numeric: tabular-nums; }
    .note { font-size: .81rem; line-height: 1.45; margin-top: .65rem; }
    .stock-history { margin-top: .75rem; padding-top: .75rem; border-top: 1px solid var(--line); }
    .subhead { font-size: .82rem; margin-bottom: .55rem; }
    .months dd { overflow-wrap: anywhere; }
    .month-context { color: var(--muted); font-size: .76rem; margin-top: .12rem; }
    .links { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.25rem; color: var(--muted); font-size: .82rem; margin-top: 1rem; }
    .source-details { margin-top: 1rem; font-size: .82rem; color: var(--muted); }
    summary { cursor: pointer; width: fit-content; }
    .source-list { padding-left: 1.2rem; margin: .55rem 0 0; }
    .source-list li + li { margin-top: .33rem; }
    .login { display: grid; place-items: center; min-height: 60vh; padding: 1rem; }
    .sign-in { width: min(100%, 25rem); }
    .sign-in h1 { font-size: 1.85rem; }
    .sign-in label, .sign-in input, .sign-in button { display: block; width: 100%; }
    .sign-in label { font-size: .9rem; font-weight: 700; margin-top: 1rem; }
    .sign-in input { border: 1px solid var(--line); border-radius: .35rem; padding: .55rem; margin-block: .35rem .75rem; }
    .loading { padding: 2rem; text-align: center; }
    @media (max-width: 38rem) {
      .wrap { width: calc(100% - 1.5rem); }
      .intro { align-items: start; flex-direction: column; gap: .65rem; }
      .report-grid { grid-template-columns: 1fr; }
      .split { column-gap: .65rem; }
      .production .split { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .brand { font-size: .8rem; }
      .actions { gap: .2rem; }
      .actions .button { font-size: .8rem; padding-inline: .55rem; }
      main.report { padding-top: 1.3rem; }
    }
    @media print {
      :root, .production { background: white; color: black; }
      .production .note, .production dt { color: #444; }
      .actions, .links, .week-nav, .source-details { display: none !important; }
      .panel { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header><div class="wrap bar">
    <a class="brand" href="/"><span class="mark">BMC</span> Black Market Coffee</a>
    <div id="actions" class="actions" hidden>
      <button id="refresh" class="button quiet" type="button">Refresh</button>
      <button id="logout" class="button" type="button">Sign out</button>
    </div>
  </div></header>
  <p id="loading" class="loading" role="status">Opening weekly report…</p>
  <main id="login" class="login" hidden>
    <section class="panel sign-in">
      <h1>Weekly report</h1>
      <form id="signInForm">
        <label for="password">Stock Take App password</label>
        <input id="password" type="password" autocomplete="current-password" required maxlength="256">
        <button id="signIn" class="button primary" type="submit">Sign in</button>
        <p id="loginMessage" class="note error" role="alert" hidden></p>
      </form>
    </section>
  </main>
  <main id="report" class="wrap report" hidden>
    <div class="intro">
      <div><h1>Weekly report</h1><p id="dates" class="dates"></p></div>
      <nav class="week-nav" aria-label="Reporting week">
        <button id="previous" class="button" type="button">Previous week</button>
        <button id="next" class="button" type="button" disabled>Next week</button>
      </nav>
    </div>
    <p id="status" class="status" role="status"></p>
    <div id="figures" class="report-grid" hidden>
      <section class="panel production" aria-labelledby="productionTitle">
        <h2 id="productionTitle">Production</h2>
        <div class="primary-row"><p id="production" class="figure">—</p><p id="productionChange" class="change"></p></div>
        <dl id="productionBreakdown" class="split">
          <div id="roastedBreakdown"><dt>Roasted</dt><dd id="roasted">—</dd></div>
          <div><dt>Scheduled</dt><dd id="scheduled">—</dd></div>
          <div><dt id="previousProductionLabel">Previous week</dt><dd id="previousProduction">—</dd></div>
        </dl>
        <p id="productionNote" class="note" hidden></p>
      </section>
      <section class="panel" aria-labelledby="greenBuyTitle">
        <h2 id="greenBuyTitle">Green buy this week</h2>
        <div class="primary-row"><p id="greenBuy" class="figure">—</p></div>
        <p id="greenBuyBreakdown" class="note" hidden></p>
        <p id="greenBuyNote" class="note" hidden></p>
      </section>
      <section class="panel" aria-labelledby="forecastTitle">
        <h2 id="forecastTitle">Monthly forecast green buy spend</h2>
        <div class="primary-row"><p id="forecast" class="figure">—</p></div>
        <p id="forecastMonth" class="note" hidden></p>
        <p id="forecastNote" class="note" hidden></p>
      </section>
      <section class="panel stock" aria-labelledby="stockTitle">
        <h2 id="stockTitle">Current holding stock (non-coffee)</h2>
        <div class="primary-row"><p id="stock" class="figure">—</p><p id="stockItems" class="change"></p></div>
        <p id="stockNote" class="note" hidden></p>
        <div class="stock-history">
          <h3 class="subhead">Last three month ends</h3>
          <dl id="monthEnds" class="split months"></dl>
          <p id="stockHistoryNote" class="note" hidden></p>
        </div>
      </section>
      <section class="panel stock" aria-labelledby="wholesaleTitle">
        <h2 id="wholesaleTitle">Wholesale delivery orders</h2>
        <div class="primary-row"><p id="wholesale" class="figure">—</p><p id="previousWholesale" class="change"></p></div>
        <p id="wholesaleNote" class="note" hidden></p>
      </section>
    </div>
    <details id="sources" class="source-details" hidden><summary>Data sources</summary><ul id="sourceList" class="source-list"></ul></details>
    <footer class="links"><p>Australia/Sydney · AUD</p><a href="/details">Operations details and issue notes</a></footer>
  </main>
  <script>
    const el = id => document.getElementById(id);
    const number = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
    const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
    const dayFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' });
    const monthFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const timeFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' });
    let loadedWeek = '';
    let requestedWeek = new URL(location.href).searchParams.get('week') || '';
    let currentRequest;
    let isCurrentWeek = true;
    let signedIn = false;

    function format(value, formatNumber, unit = '') {
      return Number.isFinite(value) ? formatNumber.format(value) + unit : '—';
    }
    function set(id, value) { el(id).textContent = value; }
    function note(id, value) {
      set(id, value || '');
      el(id).hidden = !value;
    }
    function dateFormat(value, formatter) {
      const date = new Date(value + 'T12:00:00Z');
      return Number.isFinite(date.getTime()) ? formatter.format(date) : '';
    }
    function changeWeek(date, offset) {
      const result = new Date(date + 'T12:00:00Z');
      result.setUTCDate(result.getUTCDate() + offset);
      return result.toISOString().slice(0, 10);
    }
    function plural(value, one) { return number.format(value) + ' ' + one + (value === 1 ? '' : 's'); }
    function renderMonthEnds(history) {
      el('monthEnds').replaceChildren(...history.map(item => {
        const column = document.createElement('div');
        const label = document.createElement('dt');
        const value = document.createElement('dd');
        label.textContent = dateFormat(item.date, dayFormat);
        value.textContent = format(item.value, currency);
        if (item.status === 'estimated' || item.status === 'partial') {
          const context = document.createElement('p');
          context.className = 'month-context';
          context.textContent = item.status === 'estimated' ? 'Estimate' : 'Partial';
          value.append(context);
        }
        column.append(label, value);
        return column;
      }));
    }
    function render(data) {
      const { production, greenBuy, greenForecast, stock, wholesale } = data.metrics;
      set('dates', data.week.label);
      const hasTotal = Number.isFinite(production.totalKg);
      const hasRoasted = Number.isFinite(production.roastedKg);
      set('production', hasTotal ? format(production.totalKg, number, ' kg') : hasRoasted ? format(production.roastedKg, number, ' kg roasted') : '—');
      el('roastedBreakdown').hidden = !hasTotal && hasRoasted;
      el('productionBreakdown').classList.toggle('two', !hasTotal && hasRoasted);
      const change = hasTotal ? production.changePercent : production.roastedChangePercent;
      const subject = hasTotal ? 'Production' : 'Roasted kg';
      const changeText = !Number.isFinite(change) ? '' : change === 0 ? subject + ' unchanged from previous week' :
        subject + ' ' + (change > 0 ? 'up ' : 'down ') + number.format(Math.abs(change)) + '% from previous week';
      set('productionChange', changeText);
      set('roasted', format(production.roastedKg, number, ' kg'));
      set('scheduled', format(production.scheduledKg, number, ' kg'));
      set('previousProductionLabel', hasTotal ? 'Previous week' : 'Previous week roasted');
      set('previousProduction', format(hasTotal ? production.previousKg : production.previousRoastedKg, number, ' kg'));
      note('productionNote', production.note);

      set('greenBuy', format(greenBuy.value, currency));
      const buyParts = [];
      if (Number.isFinite(greenBuy.kg)) buyParts.push(format(greenBuy.kg, number, ' kg'));
      if (Number.isFinite(greenBuy.orders)) buyParts.push(plural(greenBuy.orders, 'purchase order'));
      note('greenBuyBreakdown', buyParts.join(' · '));
      note('greenBuyNote', greenBuy.status === 'live' ? '' : greenBuy.note);
      set('forecast', format(greenForecast.value, currency));
      note('forecastMonth', greenForecast.month && dateFormat(greenForecast.month.slice(0, 7) + '-01', monthFormat));
      note('forecastNote', greenForecast.note);

      set('stock', format(stock.value, currency));
      set('stockItems', Number.isFinite(stock.itemCount) ? plural(stock.itemCount, 'stock item') : '');
      note('stockNote', stock.note);
      renderMonthEnds(stock.history);
      note('stockHistoryNote', stock.historyNote);
      const orderLabel = (orders, completed) => Number.isFinite(orders) ? plural(orders, 'order') :
        Number.isFinite(completed) ? plural(completed, 'completed handover') : '—';
      set('wholesale', orderLabel(wholesale.orders, wholesale.completed));
      set('previousWholesale', 'Previous week · ' + orderLabel(wholesale.previousOrders, wholesale.previousCompleted));
      note('wholesaleNote', wholesale.note);

      const sourceEntries = data.sources.filter(source => source.note).map(source => {
        const entry = document.createElement('li');
        const label = document.createElement('strong');
        label.textContent = source.label;
        entry.append(label, ' · ' + source.note);
        return entry;
      });
      el('sourceList').replaceChildren(...sourceEntries);
      el('sources').hidden = !sourceEntries.length;
      el('figures').hidden = false;
      isCurrentWeek = data.week.isCurrent;
      loadedWeek = data.week.start;
      requestedWeek = data.week.start;
      set('status', 'Updated ' + timeFormat.format(new Date(data.generatedAt)) + ' Sydney time');
      el('status').classList.remove('error');
    }
    function showSession(active) {
      signedIn = active;
      el('loading').hidden = true;
      el('report').hidden = !active;
      el('actions').hidden = !active;
      el('login').hidden = active;
      if (!active) {
        currentRequest?.abort();
        el('figures').hidden = true;
        el('sourceList').replaceChildren();
        loadedWeek = '';
      }
    }
    async function readJson(response) {
      return response.json().catch(() => ({}));
    }
    async function load() {
      if (!signedIn) return;
      currentRequest?.abort();
      const controller = new AbortController();
      currentRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 30000);
      el('report').setAttribute('aria-busy', 'true');
      el('previous').disabled = true;
      el('next').disabled = true;
      el('refresh').disabled = true;
      if (loadedWeek !== requestedWeek) {
        el('figures').hidden = true;
        el('sources').hidden = true;
      }
      set('status', 'Loading weekly figures…');
      try {
        const query = requestedWeek ? '?week=' + encodeURIComponent(requestedWeek) : '';
        const response = await fetch('/api/weekly-report' + query, { cache: 'no-store', signal: controller.signal });
        if (currentRequest !== controller) return;
        if (response.status === 401) {
          showSession(false);
          note('loginMessage', 'Your session has ended. Sign in again.');
          return;
        }
        const data = await readJson(response);
        if (currentRequest !== controller || !signedIn) return;
        if (!response.ok) throw new Error(data.error || 'The report could not be loaded.');
        render(data);
      } catch (error) {
        if (currentRequest !== controller || !signedIn) return;
        set('status', error.name === 'AbortError' ? 'The report took too long to load. Try Refresh.' : error.message);
        el('status').classList.add('error');
        requestedWeek = loadedWeek;
        if (loadedWeek) el('figures').hidden = false;
      } finally {
        clearTimeout(timeout);
        if (currentRequest === controller) {
          el('report').setAttribute('aria-busy', 'false');
          el('previous').disabled = !loadedWeek;
          el('next').disabled = !loadedWeek || isCurrentWeek;
          el('refresh').disabled = false;
          currentRequest = null;
        }
      }
    }
    el('previous').addEventListener('click', () => {
      if (!loadedWeek) return;
      requestedWeek = changeWeek(loadedWeek, -7);
      load();
    });
    el('next').addEventListener('click', () => {
      if (!loadedWeek) return;
      requestedWeek = changeWeek(loadedWeek, 7);
      load();
    });
    el('refresh').addEventListener('click', load);
    el('signInForm').addEventListener('submit', async event => {
      event.preventDefault();
      el('signIn').disabled = true;
      note('loginMessage', '');
      try {
        const response = await fetch('/api/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: el('password').value }),
        });
        const data = await readJson(response);
        if (!response.ok || !data.authenticated) throw new Error(data.error || 'Sign-in could not be completed.');
        showSession(true);
        load();
      } catch (error) { note('loginMessage', error.message); }
      finally { el('password').value = ''; el('signIn').disabled = false; }
    });
    el('logout').addEventListener('click', async () => {
      el('logout').disabled = true;
      try {
        const response = await fetch('/api/auth', { method: 'DELETE' });
        if (!response.ok) throw new Error('Sign-out could not be completed. Try again.');
        showSession(false);
        el('password').focus();
      } catch (error) { set('status', error.message); }
      finally { el('logout').disabled = false; }
    });
    fetch('/api/auth', { cache: 'no-store' }).then(readJson).then(data => {
      showSession(data.authenticated === true);
      if (signedIn) load();
    }).catch(() => showSession(false));
    setInterval(() => { if (signedIn && !document.hidden && !currentRequest) load(); }, 60000);
  </script>
</body>
</html>`;
