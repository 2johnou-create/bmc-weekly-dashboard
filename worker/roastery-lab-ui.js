export const roasteryLabPage = String.raw`<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Roastery Lab | Black Market Coffee</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #202624;
      --muted: #526059;
      --paper: #fff;
      --background: #f3f5f1;
      --line: #d6ddd6;
      --accent: #a5282c;
      --green: #263e35;
      --green-light: #dceae1;
      --caution: #794b15;
      font: 1rem/1.45 Inter, system-ui, sans-serif;
      background: var(--background);
      color: var(--ink);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body, h1, h2, h3, p { margin: 0; }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .56; cursor: default; }
    a { color: inherit; text-underline-offset: .2em; }
    :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
    .wrap { width: min(100% - 3rem, 76rem); margin-inline: auto; }
    header { background: var(--paper); border-bottom: 1px solid var(--line); }
    .bar, .dashboard-nav, .actions { display: flex; align-items: center; gap: .6rem; }
    .bar { min-height: 4.25rem; justify-content: space-between; }
    .brand img { display: block; height: 2.9rem; width: auto; max-width: 9rem; object-fit: contain; }
    .dashboard-nav { margin-inline: .6rem auto; gap: .35rem; font-size: .87rem; }
    .dashboard-nav a { padding: .45rem .65rem; border-radius: .3rem; text-decoration: none; white-space: nowrap; }
    .dashboard-nav a:hover { background: var(--background); }
    .dashboard-nav a[aria-current] { background: var(--green-light); color: var(--green); font-weight: 700; }
    .button { border: 1px solid var(--line); border-radius: .35rem; background: var(--paper); color: var(--ink); padding: .4rem .75rem; min-height: 2.7rem; }
    .button:hover:not(:disabled) { border-color: var(--muted); }
    .button.primary { background: var(--accent); border-color: var(--accent); color: white; }
    .button.quiet { border-color: transparent; }
    .report { padding-block: clamp(1.25rem, 3vw, 2.4rem) 2rem; }
    h1 { font-size: clamp(1.9rem, 4vw, 2.85rem); letter-spacing: -.045em; line-height: 1.1; }
    .report-status { min-height: 1.25rem; margin-block: .45rem .95rem; color: var(--muted); font-size: .85rem; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: clamp(.7rem, 1.3vw, 1.15rem); }
    .settings { margin-top: clamp(.7rem, 1.3vw, 1.15rem); }
    .card { min-width: 0; background: var(--paper); border: 1px solid var(--line); border-radius: .55rem; }
    .prices { border-top: 4px solid var(--accent); }
    .consumption { border: 1px solid var(--green); border-top-width: 4px; background: var(--green); color: white; }
    .card summary { cursor: pointer; }
    .card > summary { display: block; padding: clamp(.9rem, 1.75vw, 1.5rem); border-radius: inherit; }
    .card > summary::marker { content: ""; }
    .card > summary::-webkit-details-marker { display: none; }
    .card > summary:hover { background: rgb(0 0 0 / .027); }
    .consumption > summary:hover { background: rgb(255 255 255 / .06); }
    .consumption > summary:focus-visible { outline-color: white; outline-offset: -4px; }
    .card-head { display: flex; align-items: start; justify-content: space-between; gap: .6rem; }
    .card-title { font-size: clamp(1.06rem, 2vw, 1.32rem); font-weight: 740; letter-spacing: -.023em; }
    .disclosure { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; flex: none; border: 1px solid currentColor; border-radius: 50%; color: var(--muted); line-height: 1; font-size: 1.1rem; }
    .disclosure::before { content: "+"; }
    .card[open] > summary .disclosure::before { content: "−"; }
    .leaders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: .9rem; gap: .5rem 1rem; }
    .leader { display: block; min-width: 0; }
    .leader + .leader { border-inline-start: 1px solid var(--line); padding-inline-start: clamp(.5rem, 1.5vw, 1rem); }
    .leader-name { display: block; font-weight: 740; font-size: .92rem; }
    .leader-price, .large { display: block; font-size: clamp(1.48rem, 3vw, 2.5rem); line-height: 1.12; letter-spacing: -.05em; font-weight: 750; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .leader-price { margin-top: .2rem; }
    .leader-price .unit { display: block; }
    .unit { font-size: .77rem; letter-spacing: 0; color: var(--muted); font-weight: 650; white-space: nowrap; }
    .leader-loss { display: block; margin-top: .38rem; }
    .key-stats { display: flex; flex-wrap: wrap; gap: .55rem 1.25rem; margin-top: .85rem; }
    .key-stats > span + span { border-inline-start: 1px solid #779083; padding-inline-start: clamp(.7rem, 1.7vw, 1.25rem); }
    .large { font-size: clamp(1.85rem, 4.25vw, 3.25rem); }
    .large .unit { font-size: .47em; }
    .caption { display: block; font-size: .81rem; line-height: 1.4; margin-top: .48rem; color: var(--muted); }
    .caption.emphasis { margin-top: .75rem; font-weight: 700; }
    .consumption .unit, .consumption .disclosure, .consumption .caption { color: var(--green-light); }
    .preview { display: block; margin-top: .65rem; font-size: 1rem; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .preview.muted { font-weight: 400; color: var(--muted); }
    .card-body { border-top: 1px solid var(--line); padding: .95rem clamp(.9rem, 1.75vw, 1.5rem) 1.15rem; font-size: .89rem; }
    .consumption .card-body { border-color: #779083; border-radius: 0 0 .5rem .5rem; background: var(--paper); color: var(--ink); }
    .card-body h2 { font-size: 1rem; line-height: 1.3; margin-bottom: .55rem; letter-spacing: -.013em; }
    .card-body > section + section { margin-top: 1.2rem; }
    .note { margin-top: .55rem; color: var(--muted); font-size: .82rem; line-height: 1.5; overflow-wrap: anywhere; }
    .table { border-collapse: collapse; width: 100%; margin-top: .6rem; text-align: left; }
    .table th, .table td { padding: .44rem .45rem .44rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    .table thead th { font-size: .76rem; line-height: 1.25; color: var(--muted); }
    .table tbody th { font-weight: 650; overflow-wrap: anywhere; }
    .table th:not(:first-child), .table td { text-align: right; font-variant-numeric: tabular-nums; }
    .table td { white-space: nowrap; }
    .table th:last-child, .table td:last-child { padding-inline-end: 0; }
    .blend-list { display: grid; gap: .45rem; }
    .blend-list details { border-bottom: 1px solid var(--line); padding-block: .38rem; }
    .blend-list summary, .row-locations summary { font-weight: 700; }
    .by-coffee { margin-top: .65rem; }
    .by-coffee summary { width: fit-content; font-weight: 700; }
    .location-list { font-size: .76rem; font-weight: 400; list-style: none; padding: 0; margin: .35rem 0 0; }
    .location-list li + li { margin-top: .25rem; }
    .release-fields { display: grid; gap: .7rem; }
    .release-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(7.8rem, .6fr) auto; align-items: end; gap: .35rem .5rem; }
    .release-row label, .form-label { display: grid; gap: .25rem; font-size: .83rem; font-weight: 700; }
    input, textarea { border: 1px solid #aebbb3; border-radius: .3rem; padding: .45rem .55rem; color: var(--ink); background: var(--paper); width: 100%; min-width: 0; }
    input { min-height: 2.7rem; }
    textarea { resize: vertical; min-height: 6.5rem; }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .form-tools { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .6rem; margin-top: .7rem; }
    .form-message { margin-top: .5rem; color: var(--muted); font-size: .8rem; }
    .error { color: #912125; }
    .warning { color: var(--caution); }
    .conflict { grid-column: 1 / -1; background: var(--paper); padding: .9rem 1rem; border: 1px solid #b68754; border-radius: .45rem; font-size: .88rem; }
    .conflict h2 { font-size: 1rem; }
    .conflict ul { margin-block: .35rem; padding-inline-start: 1.35rem; }
    .conflict p { margin: .3rem 0 .5rem; white-space: pre-wrap; overflow-wrap: anywhere; }
    .source { margin-top: 1rem; font-size: .84rem; color: var(--muted); }
    .source summary { cursor: pointer; width: fit-content; }
    .source form { max-width: 48rem; margin-top: .65rem; }
    .source textarea { min-height: 8rem; }
    .source-links { display: flex; flex-wrap: wrap; gap: .4rem .85rem; margin: .55rem 0 .65rem; }
    .source-links a { font-weight: 700; }
    .coffee-c .large { margin-top: .65rem; }
    .quote-change { display: block; font-size: .9rem; margin-top: .35rem; font-weight: 650; font-variant-numeric: tabular-nums; }
    .market-grid { margin-top: clamp(.7rem, 1.3vw, 1.15rem); }
    .calendar-nav { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-bottom: .65rem; }
    .calendar-nav h2 { flex: 1; margin: 0; min-width: 8rem; }
    .calendar-nav .button { padding-inline: .6rem; font-size: .82rem; }
    .calendar { width: 100%; table-layout: fixed; border-collapse: collapse; text-align: center; }
    .calendar th { padding-bottom: .25rem; color: var(--muted); font-size: .75rem; font-weight: 600; }
    .calendar abbr { text-decoration: none; }
    .calendar td { padding: .12rem; }
    .calendar-day { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .15rem; min-height: 2.65rem; width: 100%; padding: .2rem 0; border: 1px solid transparent; border-radius: .3rem; background: transparent; color: var(--ink); font-size: .87rem; font-variant-numeric: tabular-nums; }
    .calendar-day:hover { border-color: var(--muted); }
    .calendar-day[aria-current=date] { text-decoration: underline; text-underline-offset: .2em; font-weight: 750; }
    .calendar-day[aria-pressed=true] { color: white; background: var(--green); }
    .calendar-markers { display: flex; align-items: center; gap: .2rem; min-height: .35rem; }
    .calendar-marker { display: inline-block; width: .4rem; height: .4rem; flex: none; }
    .calendar-marker.ordered { background: var(--green); border-radius: 50%; }
    .calendar-marker.upcoming { border: 1.5px solid var(--accent); }
    .calendar-day[aria-pressed=true] .calendar-marker.ordered { background: white; }
    .calendar-day[aria-pressed=true] .calendar-marker.upcoming { border-color: white; }
    .calendar-legend { display: flex; flex-wrap: wrap; gap: .35rem 1rem; color: var(--muted); font-size: .75rem; margin: .5rem 0 .8rem; }
    .calendar-legend span { display: inline-flex; align-items: center; gap: .4rem; }
    .purchase-list { list-style: none; padding: 0; margin: 0; }
    .purchase-list li + li { border-top: 1px solid var(--line); margin-top: .65rem; padding-top: .65rem; }
    .purchase-title { font-weight: 700; overflow-wrap: anywhere; white-space: pre-line; }
    .purchase-meta { font-size: .8rem; color: var(--muted); overflow-wrap: anywhere; }
    .purchase-quantity { margin-top: .2rem; font-variant-numeric: tabular-nums; }
    .purchase-note { white-space: pre-wrap; }
    .purchase-extra { margin-top: .9rem; }
    .purchase-extra > summary { font-weight: 700; width: fit-content; }
    .purchase-extra h2 { margin-top: .85rem; }
    .purchase-extra .table td { white-space: normal; overflow-wrap: anywhere; }
    .purchase-source { display: inline-block; margin-top: .6rem; font-weight: 700; }
    .loading { padding: 2rem; text-align: center; }
    .login { display: grid; place-items: center; min-height: 60vh; padding: 1rem; }
    .sign-in { width: min(100%, 25rem); padding: 1.45rem; background: var(--paper); border: 1px solid var(--line); border-top: 4px solid var(--accent); border-radius: .55rem; }
    .sign-in h1 { font-size: 1.85rem; }
    .sign-in label, .sign-in input, .sign-in button { display: block; width: 100%; }
    .sign-in label { font-size: .9rem; font-weight: 700; margin-top: 1rem; }
    .sign-in input { margin-block: .35rem .75rem; }
    .skip-link { position: absolute; top: -5rem; left: .75rem; background: var(--paper); color: var(--ink); padding: .7rem; }
    .skip-link:focus { top: .7rem; z-index: 2; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (min-width: 58.01rem) and (max-height: 50rem) {
      .bar { min-height: 3.4rem; }
      .brand img { height: 2.35rem; }
      .report { padding-top: 1.2rem; }
      .card > summary { padding: .86rem 1.1rem; }
    }
    @media (max-width: 48rem) {
      .wrap { width: calc(100% - 1.5rem); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 36rem) {
      .bar { flex-wrap: wrap; gap: .2rem .45rem; padding-block: .35rem; }
      .brand img { height: 2.35rem; }
      .dashboard-nav { order: 3; flex-basis: 100%; margin: 0 0 .2rem; }
      .actions { gap: .25rem; }
      .actions .button { font-size: .8rem; padding-inline: .55rem; }
    }
    @media (max-width: 24rem) {
      .release-row { grid-template-columns: minmax(0, 1fr) auto; }
      .release-row label:first-child { grid-column: 1 / -1; }
    }
    @media print {
      .actions, .dashboard-nav, .source, .disclosure, .form-tools { display: none !important; }
      .card { break-inside: avoid; }
      :root, .consumption { background: white; color: black; }
      .consumption .unit, .consumption .caption { color: #444; }
    }
  </style>
</head>
<body>
  <a id="skipLink" class="skip-link" href="#lab">Skip to Roastery Lab</a>
  <header><div class="wrap bar">
    <a class="brand" href="/"><img src="/bmc-logo.png" alt="Black Market Coffee"></a>
    <nav class="dashboard-nav" aria-label="Dashboards">
      <a href="/">Steam Room</a>
      <a href="/roastery-lab" aria-current="page">Roastery Lab</a>
    </nav>
    <div id="actions" class="actions" hidden>
      <button id="refresh" class="button quiet" type="button">Refresh</button>
      <button id="logout" class="button" type="button">Sign out</button>
    </div>
  </div></header>
  <p id="loading" class="loading" role="status">Opening Roastery Lab…</p>
  <noscript><p class="loading">Enable JavaScript to sign in and view the dashboard.</p></noscript>
  <main id="login" class="login" tabindex="-1" hidden>
    <section class="sign-in" aria-labelledby="signInTitle">
      <h1 id="signInTitle">Roastery Lab</h1>
      <form id="signInForm">
        <label for="password">Stock Take App password</label>
        <input id="password" type="password" autocomplete="current-password" required maxlength="256">
        <button id="signIn" class="button primary" type="submit">Sign in</button>
        <p id="loginMessage" class="note error" role="alert"></p>
      </form>
    </section>
  </main>
  <main id="lab" class="wrap report" tabindex="-1" hidden>
    <h1>Roastery Lab</h1>
    <p id="status" class="report-status" role="status"></p>
    <div id="board" hidden>
      <div class="grid">
        <details class="card prices">
          <summary>
            <span class="card-head"><span class="card-title">Green coffee prices</span><span class="disclosure" aria-hidden="true"></span></span>
            <span id="blendHighlights" class="leaders"></span>
            <span class="caption emphasis">Raw green price and average roast weight loss</span>
          </summary>
          <div class="card-body">
            <section>
              <h2>Signature blend recipes</h2>
              <p class="note">Recipe shares weight each green ingredient’s Cropster price. Roast loss is shown separately.</p>
              <p id="priceDates" class="note" hidden></p>
              <p id="lossNote" class="note" hidden></p>
              <div id="blendDetails" class="blend-list"></div>
            </section>
            <section>
              <h2>Other coffees</h2>
              <p id="otherPricesEmpty" class="note" hidden>No other green coffee prices are recorded.</p>
              <table id="otherPrices" class="table" aria-label="Other green coffees">
                <thead><tr><th scope="col">Coffee</th><th scope="col">AUD/kg</th><th scope="col">Avg loss</th></tr></thead>
                <tbody id="otherPriceRows"></tbody>
              </table>
            </section>
          </div>
        </details>
        <details class="card consumption">
          <summary>
            <span class="card-head"><span class="card-title">Green coffee consumption</span><span class="disclosure" aria-hidden="true"></span></span>
            <span class="key-stats"><span id="avgKg" class="large">—</span><span id="avgBags" class="large">—</span></span>
            <span id="consumptionWindow" class="caption emphasis">Monthly averages over the last 3 completed months</span>
          </summary>
          <div class="card-body">
            <section>
              <h2>Monthly consumption</h2>
              <p id="consumptionNote" class="note" hidden></p>
              <p id="monthsEmpty" class="note" hidden>No completed months are recorded.</p>
              <table id="monthsTable" class="table" aria-label="Green coffee consumption by month">
                <thead><tr><th scope="col">Month</th><th scope="col">Kg</th><th scope="col">Bags</th></tr></thead>
                <tbody id="monthRows"></tbody>
              </table>
              <details id="lastMonth" class="by-coffee" hidden>
                <summary id="lastMonthTitle">Last month by coffee</summary>
                <table class="table" aria-labelledby="lastMonthTitle">
                  <thead><tr><th scope="col">Coffee</th><th scope="col">Kg</th><th scope="col">Bags</th></tr></thead>
                  <tbody id="lastMonthRows"></tbody>
                </table>
              </details>
            </section>
            <section>
              <h2>Stock runout forecast</h2>
              <p id="stockAsOf" class="note"></p>
              <p id="forecastNote" class="note" hidden></p>
              <p id="forecastEmpty" class="note" hidden>No green coffee stock is recorded for the forecast.</p>
              <table id="forecastTable" class="table" aria-label="Stock runout forecast by coffee">
                <thead><tr><th scope="col">Coffee</th><th scope="col">Stock kg</th><th scope="col">Avg kg / mo</th><th scope="col">Runout</th></tr></thead>
                <tbody id="forecastRows"></tbody>
              </table>
            </section>
          </div>
        </details>
      </div>
      <div class="grid market-grid">
        <details class="card coffee-c">
          <summary>
            <span class="card-head"><span class="card-title">Coffee C futures</span><span class="disclosure" aria-hidden="true"></span></span>
            <span id="coffeeCPrice" class="large">—</span>
            <span id="coffeeCChange" class="quote-change" hidden></span>
            <span id="coffeeCContract" class="caption" hidden></span>
            <span id="coffeeCTiming" class="caption"></span>
            <span id="coffeeCAsOf" class="caption"></span>
          </summary>
          <div class="card-body">
            <p id="coffeeCNote" class="note" hidden></p>
            <a id="coffeeCSource" class="purchase-source" target="_blank" rel="noopener noreferrer" hidden>Open quote source</a>
          </div>
        </details>
        <details id="purchaseCard" class="card purchases" open>
          <summary>
            <span class="card-head"><span class="card-title">Coffee purchases</span><span class="disclosure" aria-hidden="true"></span></span>
            <span id="purchasePreview" class="preview muted"></span>
          </summary>
          <div class="card-body">
            <div class="calendar-nav">
              <h2 id="purchaseMonth" aria-live="polite"></h2>
              <button id="purchasePrevious" type="button" class="button" aria-label="Previous month">‹</button>
              <button id="purchaseToday" type="button" class="button">Today</button>
              <button id="purchaseNext" type="button" class="button" aria-label="Next month">›</button>
            </div>
            <p class="note">Order dates. Planned orders are estimates.</p>
            <table class="calendar" aria-labelledby="purchaseMonth">
              <thead><tr>
                <th scope="col"><abbr title="Monday">M</abbr></th><th scope="col"><abbr title="Tuesday">T</abbr></th><th scope="col"><abbr title="Wednesday">W</abbr></th><th scope="col"><abbr title="Thursday">T</abbr></th><th scope="col"><abbr title="Friday">F</abbr></th><th scope="col"><abbr title="Saturday">S</abbr></th><th scope="col"><abbr title="Sunday">S</abbr></th>
              </tr></thead>
              <tbody id="purchaseDays"></tbody>
            </table>
            <div class="calendar-legend" aria-label="Calendar markers">
              <span><i class="calendar-marker ordered" aria-hidden="true"></i>Ordered</span>
              <span><i class="calendar-marker upcoming" aria-hidden="true"></i>Planned order</span>
            </div>
            <section aria-labelledby="selectedPurchaseDate">
              <h2 id="selectedPurchaseDate" aria-live="polite"></h2>
              <p id="selectedPurchaseEmpty" class="note"></p>
              <ul id="selectedPurchases" class="purchase-list"></ul>
            </section>
            <details class="purchase-extra">
              <summary>Month totals and planned orders</summary>
              <h2 id="purchaseTotalsTitle">Recorded order totals</h2>
              <table id="purchaseTotals" class="table" aria-labelledby="purchaseTotalsTitle">
                <thead><tr><th scope="col">Status</th><th scope="col">Purchases</th><th scope="col">Kg</th><th id="purchaseValueHeading" scope="col">Value</th></tr></thead>
                <tbody id="purchaseTotalRows"></tbody>
              </table>
              <h2>Planned orders</h2>
              <p id="upcomingPurchaseEmpty" class="note"></p>
              <ul id="upcomingPurchases" class="purchase-list"></ul>
            </details>
            <p id="purchaseNote" class="note" hidden></p>
            <p id="purchaseAsOf" class="note" hidden></p>
            <a id="purchaseSource" class="purchase-source" target="_blank" rel="noopener noreferrer" hidden>Open purchase sheet</a>
          </div>
        </details>
      </div>
      <form id="settingsForm" class="settings grid">
        <details class="card">
          <summary>
            <span class="card-head"><span class="card-title">Upcoming release</span><span class="disclosure" aria-hidden="true"></span></span>
            <span id="releasePreview" class="preview muted"></span>
          </summary>
          <div class="card-body">
            <fieldset id="releaseEditor" aria-label="Upcoming releases">
              <div id="releaseRows" class="release-fields"></div>
              <div class="form-tools">
                <button id="addRelease" type="button" class="button">Add coffee</button>
                <button id="saveReleases" type="submit" class="button primary">Save lab settings</button>
              </div>
              <p id="releaseMessage" class="form-message"></p>
            </fieldset>
          </div>
        </details>
        <details class="card">
          <summary>
            <span class="card-head"><span class="card-title">QA status</span><span class="disclosure" aria-hidden="true"></span></span>
            <span id="qaPreview" class="preview muted"></span>
          </summary>
          <div class="card-body">
            <fieldset id="qaEditor">
              <label for="qa" class="form-label">QA notes</label>
              <textarea id="qa" rows="5" maxlength="4000"></textarea>
              <div class="form-tools">
                <button id="saveQa" type="submit" class="button primary">Save lab settings</button>
              </div>
              <p id="qaMessage" class="form-message"></p>
            </fieldset>
          </div>
        </details>
        <div id="settingsConflict" class="conflict" hidden>
          <h2>Latest saved lab settings</h2>
          <p>The settings changed while you were editing. Review the saved version before applying your draft.</p>
          <ul id="latestReleases"></ul>
          <p id="latestQa"></p>
          <button id="rebaseSettings" type="button" class="button">Keep draft and use latest version</button>
        </div>
        <p id="settingsAnnounce" class="visually-hidden" role="status"></p>
      </form>
      <details id="source" class="source">
        <summary>Data source</summary>
        <p id="sourceNote" class="note"></p>
        <div class="source-links">
          <a href="https://c-sar.cropster.com/apps/lots/inventory-report/location" target="_blank" rel="noopener noreferrer">Cropster green inventory</a>
          <a href="https://c-sar.cropster.com/app/roast/blend-profiles" target="_blank" rel="noopener noreferrer">Blend profiles</a>
          <a href="https://c-sar.cropster.com/apps/roast/production-report/inventory" target="_blank" rel="noopener noreferrer">Production by green inventory</a>
        </div>
        <form id="cropsterForm">
          <fieldset id="cropsterEditor">
            <label for="cropsterInput" class="form-label">Cropster report JSON</label>
            <textarea id="cropsterInput" aria-describedby="cropsterHelp" spellcheck="false" required></textarea>
            <p id="cropsterHelp" class="note">Paste verified Cropster data for inventory, recipes, consumption or roast loss. Sections you leave out keep their saved data.</p>
            <div class="form-tools"><button id="saveCropster" class="button primary" type="submit">Save Cropster data</button></div>
            <p id="cropsterMessage" class="form-message" role="status"></p>
          </fieldset>
        </form>
      </details>
    </div>
  </main>
  <script>
    const el = id => document.getElementById(id);
    const numbers = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });
    const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
    const monthFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'short', year: 'numeric' });
    const releaseFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
    const timeFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const fullMonthFormat = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const quoteFormat = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sydneyCalendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
    const blendNames = ['Liberty', 'Rhythm', 'OH'];
    const maximumReleases = 12;
    const missing = '—';
    let signedIn = false;
    let sessionGeneration = 0;
    let activeRequest;
    let busy = false;
    let settings;
    let draftRevision;
    let conflictPending = false;
    let releaseSequence = 0;
    let priceVersion;
    let consumptionVersion;
    let purchases;
    let purchaseMonth = todaySydney().slice(0, 7);
    let selectedPurchaseDate = todaySydney();
    const dirty = new Set();

    function node(tag, content, className) {
      const element = document.createElement(tag);
      if (content !== undefined) element.textContent = content;
      if (className) element.className = className;
      return element;
    }
    function message(id, text, error = false) {
      el(id).textContent = text;
      el(id).classList.toggle('error', error);
    }
    function format(value, formatter = numbers) {
      return Number.isFinite(value) ? formatter.format(value) : missing;
    }
    function withUnit(value, unit) {
      return Number.isFinite(value) ? numbers.format(value) + ' ' + unit : missing;
    }
    function percent(value) {
      return Number.isFinite(value) ? numbers.format(value) + '%' : missing;
    }
    function dateText(value, formatter = releaseFormat) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? formatter.format(date) : '';
    }
    function monthText(month) {
      return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? dateText(month + '-01', monthFormat) : '';
    }
    function todaySydney() {
      const parts = Object.fromEntries(sydneyCalendar.formatToParts(new Date()).map(part => [part.type, part.value]));
      return parts.year + '-' + parts.month + '-' + parts.day;
    }
    function validCalendarDate(value) {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    }
    function safeSourceLink(id, value) {
      const link = el(id);
      let url;
      try { url = new URL(value); } catch {}
      const allowed = url?.protocol === 'https:' && !url.username && !url.password;
      link.hidden = !allowed;
      if (allowed) link.href = url.href;
      else link.removeAttribute('href');
    }
    function renderCoffeeC(quote = {}) {
      const available = quote.status !== 'unavailable' && Number.isFinite(quote.price);
      el('coffeeCPrice').replaceChildren(available ? quoteFormat.format(quote.price) : missing,
        ' ', node('span', 'US¢/lb', 'unit'));
      const changes = [];
      if (available && Number.isFinite(quote.change)) changes.push((quote.change > 0 ? '+' : '') + quoteFormat.format(quote.change) + ' US¢/lb');
      if (available && Number.isFinite(quote.changePercent)) changes.push((quote.changePercent > 0 ? '+' : '') + percent(quote.changePercent));
      el('coffeeCChange').textContent = changes.length ? 'Change ' + changes.join(' / ') : '';
      el('coffeeCChange').hidden = !changes.length;
      el('coffeeCContract').textContent = quote.contract ? 'Contract ' + quote.contract : '';
      el('coffeeCContract').hidden = !quote.contract;
      const delay = Number.isFinite(quote.delayMinutes) && quote.delayMinutes > 0
        ? 'Delayed at least ' + numbers.format(quote.delayMinutes) + ' minutes. Last traded price.'
        : 'Last traded price. Quote delay unconfirmed.';
      const market = quote.marketStatus === 'closed' ? 'Market closed. ' : '';
      const stale = quote.status === 'stale' ? 'Last available quote. ' : '';
      el('coffeeCTiming').textContent = available ? market + stale + delay : 'Quote unavailable';
      const timestamp = dateText(quote.asOf, timeFormat);
      el('coffeeCAsOf').textContent = timestamp ? 'As of ' + timestamp + ' Sydney time' : 'Trade time unavailable';
      el('coffeeCNote').textContent = quote.note || '';
      el('coffeeCNote').hidden = !quote.note;
      safeSourceLink('coffeeCSource', quote.sourceUrl);
    }
    function purchaseMoney(event) {
      if (!Number.isFinite(event.value)) return '';
      if (!event.currency && event.currencySymbol === '$') return '$' + quoteFormat.format(event.value) + ' as recorded';
      if (!/^[A-Z]{3}$/.test(event.currency || '')) return '';
      const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: event.currency, currencyDisplay: 'code' });
      return money.format(event.value);
    }
    function purchaseListItem(event, includeDate = false) {
      const item = node('li');
      item.append(node('p', event.coffee || 'Coffee to be confirmed', 'purchase-title'));
      const kind = event.kind === 'ordered' ? 'Ordered' : 'Planned order';
      const details = [includeDate && dateText(event.date), kind, event.supplier].filter(Boolean);
      item.append(node('p', details.join(' · '), 'purchase-meta'));
      const quantity = [Number.isFinite(event.kg) && withUnit(event.kg, 'kg'), Number.isFinite(event.bags) && withUnit(event.bags, 'bags'), purchaseMoney(event)].filter(Boolean);
      item.append(node('p', quantity.join(' · '), 'purchase-quantity'));
      if (event.quantityText) item.append(node('p', event.quantityText, 'purchase-meta purchase-note'));
      const payment = [event.invoice && 'Reference ' + event.invoice.replace(/\n/g, ' · '),
        validCalendarDate(event.dueDate) && 'Payment due ' + dateText(event.dueDate)].filter(Boolean);
      if (payment.length) item.append(node('p', payment.join(' · '), 'purchase-meta'));
      if (event.note) item.append(node('p', event.note, 'note purchase-note'));
      return item;
    }
    function purchaseEvents() {
      return (purchases?.events || []).filter(event => validCalendarDate(event.date) && ['ordered', 'upcoming'].includes(event.kind))
        .sort((left, right) => left.date.localeCompare(right.date) || (left.coffee || '').localeCompare(right.coffee || ''));
    }
    function renderSelectedPurchases(events) {
      const selected = events.filter(event => event.date === selectedPurchaseDate);
      el('selectedPurchaseDate').textContent = dateText(selectedPurchaseDate);
      el('selectedPurchases').replaceChildren(...selected.map(event => purchaseListItem(event)));
      el('selectedPurchaseEmpty').hidden = Boolean(selected.length);
      el('selectedPurchaseEmpty').textContent = purchases?.status === 'unavailable'
        ? 'Purchase data is unavailable.' : 'No dated purchases recorded for this day.';
    }
    function renderPurchaseCalendar() {
      const events = purchaseEvents();
      const today = todaySydney();
      const focusedDate = el('purchaseDays').contains(document.activeElement) ? document.activeElement.dataset.date : null;
      const first = new Date(purchaseMonth + '-01T12:00:00Z');
      const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const offset = (first.getUTCDay() + 6) % 7;
      const rows = [];
      let row;
      for (let position = 0; position < Math.ceil((offset + days) / 7) * 7; position++) {
        if (position % 7 === 0) { row = node('tr'); rows.push(row); }
        const cell = node('td');
        const day = position - offset + 1;
        if (day > 0 && day <= days) {
          const date = purchaseMonth + '-' + String(day).padStart(2, '0');
          const dated = events.filter(event => event.date === date);
          const ordered = dated.filter(event => event.kind === 'ordered').length;
          const upcoming = dated.filter(event => event.kind === 'upcoming').length;
          const button = node('button', undefined, 'calendar-day');
          button.type = 'button';
          button.dataset.date = date;
          button.setAttribute('aria-pressed', String(date === selectedPurchaseDate));
          const counts = [ordered && ordered + ' ordered', upcoming && upcoming + ' planned'].filter(Boolean);
          button.setAttribute('aria-label', dateText(date) + (counts.length ? ', ' + counts.join(', ') + ' purchases' : ', no recorded purchases'));
          if (date === today) button.setAttribute('aria-current', 'date');
          const markers = node('span', undefined, 'calendar-markers');
          markers.setAttribute('aria-hidden', 'true');
          if (ordered) markers.append(node('i', undefined, 'calendar-marker ordered'));
          if (upcoming) markers.append(node('i', undefined, 'calendar-marker upcoming'));
          button.append(node('span', String(day)), markers);
          cell.append(button);
        }
        row.append(cell);
      }
      el('purchaseMonth').textContent = fullMonthFormat.format(first);
      el('purchaseDays').replaceChildren(...rows);
      if (focusedDate) el('purchaseDays').querySelector('button[data-date="' + focusedDate + '"]')?.focus({ preventScroll: true });
      renderSelectedPurchases(events);
      const monthEvents = events.filter(event => event.date.startsWith(purchaseMonth));
      const isUnavailable = purchases?.status === 'unavailable';
      const audValues = monthEvents.length > 0 && monthEvents.every(event => event.currency === 'AUD');
      const sourceDollars = monthEvents.length > 0 && monthEvents.every(event => !event.currency && event.currencySymbol === '$');
      el('purchaseValueHeading').textContent = audValues ? 'AUD value' : sourceDollars ? '$ as recorded' : 'Value';
      el('purchaseTotalsTitle').textContent = fullMonthFormat.format(first) + ' recorded order totals';
      const totals = ['ordered', 'upcoming'].map(kind => {
        const group = monthEvents.filter(event => event.kind === kind);
        const sum = field => !isUnavailable && group.every(event => Number.isFinite(event[field]))
          ? group.reduce((total, event) => total + event[field], 0) : null;
        const value = audValues || sourceDollars ? sum('value') : null;
        return makeTableRow(kind === 'ordered' ? 'Ordered' : 'Planned',
          isUnavailable ? missing : format(group.length), format(sum('kg')), format(value, audValues ? currency : quoteFormat));
      });
      el('purchaseTotalRows').replaceChildren(...totals);
    }
    function renderPurchases(next = { status: 'unavailable' }) {
      const same = JSON.stringify(purchases) === JSON.stringify(next);
      purchases = next;
      const upcoming = purchaseEvents().filter(event => event.kind === 'upcoming' && event.date >= todaySydney());
      const nextEvent = upcoming.find(event => event.date >= todaySydney());
      el('purchasePreview').textContent = nextEvent
        ? dateText(nextEvent.date) + ' · ' + (nextEvent.coffee || 'Coffee to be confirmed')
        : purchases.status === 'unavailable' ? 'Purchase data unavailable' : 'No upcoming planned orders';
      el('purchasePreview').classList.toggle('muted', !nextEvent);
      el('purchaseNote').textContent = purchases.note || '';
      el('purchaseNote').hidden = !purchases.note;
      const timestamp = dateText(purchases.asOf, timeFormat);
      el('purchaseAsOf').textContent = [purchases.sheetName, timestamp && 'Read ' + timestamp + ' Sydney time'].filter(Boolean).join(' · ');
      el('purchaseAsOf').hidden = !el('purchaseAsOf').textContent;
      safeSourceLink('purchaseSource', purchases.sourceUrl);
      if (!same) {
        renderPurchaseCalendar();
        el('upcomingPurchases').replaceChildren(...upcoming.map(event => purchaseListItem(event, true)));
        el('upcomingPurchaseEmpty').hidden = Boolean(upcoming.length);
        el('upcomingPurchaseEmpty').textContent = purchases.status === 'unavailable'
          ? 'Purchase data is unavailable.' : 'No planned orders recorded.';
      }
    }
    function changePurchaseMonth(offset) {
      const first = new Date(purchaseMonth + '-01T12:00:00Z');
      first.setUTCMonth(first.getUTCMonth() + offset);
      purchaseMonth = first.toISOString().slice(0, 7);
      selectedPurchaseDate = purchaseMonth + '-01';
      renderPurchaseCalendar();
    }
    function makeTableRow(firstCell, ...columns) {
      const row = node('tr');
      const name = node('th');
      name.scope = 'row';
      name.append(firstCell);
      row.append(name, ...columns.map(value => node('td', value)));
      return row;
    }
    function numberWithUnit(id, value, unit) {
      el(id).replaceChildren(format(value), ' ', node('span', unit, 'unit'));
    }
    function openItems(container) {
      return new Set([...container.querySelectorAll('details[open] > summary')].map(summary => summary.textContent));
    }
    function renderPrices(prices = {}) {
      const highlights = prices.highlights || [];
      const other = prices.others || [];
      const open = openItems(el('blendDetails'));
      const lead = [];
      const details = [];
      const priceAsOf = dateText(prices.priceAsOf);
      const lossFrom = dateText(prices.lossFrom);
      const lossAsOf = dateText(prices.lossAsOf);
      const lossWindow = lossFrom && lossAsOf ? lossFrom + ' to ' + lossAsOf : lossAsOf && 'through ' + lossAsOf;
      const dates = [priceAsOf && 'Green prices as of ' + priceAsOf + '.', lossWindow && 'Roast loss ' + lossWindow + '.'].filter(Boolean).join(' ');
      el('priceDates').textContent = dates;
      el('priceDates').hidden = !dates;
      el('lossNote').textContent = prices.lossNote || '';
      el('lossNote').hidden = !prices.lossNote;
      for (const name of blendNames) {
        const item = highlights.find(row => row.name?.toLowerCase() === name.toLowerCase()) || {};
        const figure = node('span', undefined, 'leader-price');
        figure.append(format(item.pricePerKg, currency), node('span', 'AUD/kg', 'unit'));
        const highlight = node('span', undefined, 'leader');
        const loss = Number.isFinite(item.lossPercent) ? percent(item.lossPercent) + ' loss' : 'Loss ' + missing;
        highlight.append(node('span', name, 'leader-name'), figure, node('span', loss, 'leader-loss caption'));
        lead.push(highlight);
        const blend = node('details');
        blend.open = open.has(name);
        blend.append(node('summary', name));
        if (item.components?.length) {
          const table = node('table', undefined, 'table');
          table.setAttribute('aria-label', name + ' recipe');
          const head = table.createTHead().insertRow();
          for (const label of ['Green ingredient', 'Recipe share', 'AUD/kg']) {
            const column = node('th', label);
            column.scope = 'col';
            head.append(column);
          }
          table.createTBody().append(...item.components.map(component => {
            const label = component.coffee && component.coffee !== component.name ? component.name + ' (' + component.coffee + ')' : component.name;
            return makeTableRow(label, percent(component.percent), format(component.pricePerKg, currency));
          }));
          blend.append(table);
        } else {
          blend.append(node('p', 'No recipe shares are recorded.', 'note'));
        }
        if (Number.isInteger(item.lossBatchCount) && item.lossBatchCount > 0) {
          blend.append(node('p', 'Roast weight loss averaged across ' + item.lossBatchCount +
            (item.lossBatchCount === 1 ? ' batch.' : ' batches.'), 'note'));
        }
        details.push(blend);
      }
      el('blendHighlights').replaceChildren(...lead);
      el('blendDetails').replaceChildren(...details);
      el('otherPriceRows').replaceChildren(...other.map(item => makeTableRow(
        item.name, format(item.pricePerKg, currency), percent(item.lossPercent))));
      el('otherPrices').hidden = !other.length;
      el('otherPricesEmpty').hidden = Boolean(other.length);
    }
    function forecastName(row, open) {
      if (!row.locations?.length) return row.name;
      const locations = node('details', undefined, 'row-locations');
      locations.open = open.has(row.name);
      const list = node('ul', undefined, 'location-list');
      for (const position of row.locations) list.append(node('li', position.name + ': ' + withUnit(position.kg, 'kg')));
      locations.append(node('summary', row.name), list);
      return locations;
    }
    function renderConsumption(consumption = {}) {
      const months = consumption.months || [];
      const forecast = consumption.forecasts || [];
      const open = openItems(el('forecastRows'));
      numberWithUnit('avgKg', consumption.averageKg, 'kg');
      numberWithUnit('avgBags', consumption.averageBags, 'bags');
      const first = monthText(months.at(0)?.month);
      const last = monthText(months.at(-1)?.month);
      el('consumptionWindow').textContent = first && last && months.length === 3
        ? 'Monthly averages, ' + first + ' to ' + last
        : 'Monthly averages over the last 3 completed months';
      el('consumptionNote').textContent = consumption.note || '';
      el('consumptionNote').hidden = !consumption.note;
      el('monthRows').replaceChildren(...months.map(row =>
        makeTableRow(monthText(row.month) || missing, format(row.kg), format(row.bags))));
      el('monthsTable').hidden = !months.length;
      el('monthsEmpty').hidden = Boolean(months.length);
      const latest = consumption.lastMonth;
      const latestRows = latest?.rows || [];
      const latestMonth = monthText(latest?.month);
      el('lastMonth').hidden = !latestRows.length;
      el('lastMonthTitle').textContent = latestMonth ? latestMonth + ' by coffee' : 'Last month by coffee';
      el('lastMonthRows').replaceChildren(...latestRows.map(row => makeTableRow(row.name, format(row.kg), format(row.bags))));
      const inventoryDate = dateText(consumption.stockAsOf);
      const total = Number.isFinite(consumption.stockTotalKg) ? withUnit(consumption.stockTotalKg, 'kg') + ' across all locations. ' : '';
      el('stockAsOf').textContent = total + (inventoryDate
        ? 'Inventory as of ' + inventoryDate + '. Estimates use the three-month average for each coffee.'
        : 'Estimates use stock from all green coffee locations and each coffee’s three-month average.');
      el('forecastNote').textContent = consumption.forecastNote || '';
      el('forecastNote').hidden = !consumption.forecastNote;
      el('forecastRows').replaceChildren(...forecast.map(row =>
        makeTableRow(forecastName(row, open), format(row.kg), format(row.avgMonthlyKg), monthText(row.depletionMonth) || missing)));
      el('forecastTable').hidden = !forecast.length;
      el('forecastEmpty').hidden = Boolean(forecast.length);
    }

    function releaseLabel(release) {
      const when = dateText(release.date);
      return when ? release.name + ', ' + when : release.name;
    }
    function addRelease(release = {}) {
      const row = node('div', undefined, 'release-row');
      const name = node('input');
      name.name = 'releaseName';
      name.type = 'text';
      name.maxLength = 120;
      name.value = release.name || '';
      const date = node('input');
      date.name = 'releaseDate';
      date.type = 'date';
      date.value = release.date || '';
      const key = ++releaseSequence;
      name.id = 'release-name-' + key;
      date.id = 'release-date-' + key;
      const nameLabel = node('label', 'Coffee');
      nameLabel.htmlFor = name.id;
      nameLabel.append(name);
      const dateLabel = node('label', 'Release date');
      dateLabel.htmlFor = date.id;
      dateLabel.append(date);
      const remove = node('button', 'Remove', 'button');
      remove.type = 'button';
      remove.setAttribute('aria-label', release.name ? 'Remove ' + release.name : 'Remove coffee row');
      remove.addEventListener('click', () => {
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        editSettings('releases');
        (next?.querySelector('input') || el('addRelease')).focus();
      });
      name.addEventListener('input', () => {
        remove.setAttribute('aria-label', name.value.trim() ? 'Remove ' + name.value.trim() : 'Remove coffee row');
      });
      row.append(nameLabel, dateLabel, remove);
      el('releaseRows').append(row);
      return name;
    }
    function settingsMessage(text, error = false) {
      for (const id of ['releaseMessage', 'qaMessage', 'settingsAnnounce']) message(id, text, error);
    }
    function updateEditors() {
      const conflict = settings && draftRevision !== settings.revision;
      el('releaseEditor').disabled = busy || !settings;
      el('qaEditor').disabled = busy || !settings;
      el('addRelease').disabled = busy || el('releaseRows').childElementCount >= maximumReleases;
      el('saveReleases').disabled = busy || !dirty.size || conflict || conflictPending;
      el('saveQa').disabled = busy || !dirty.size || conflict || conflictPending;
      el('settingsConflict').hidden = !conflict;
      el('rebaseSettings').disabled = busy;
      if (conflict) {
        const savedReleases = settings.releases.map(release => node('li', releaseLabel(release)));
        el('latestReleases').replaceChildren(...(savedReleases.length ? savedReleases : [node('li', 'No saved releases.')]));
        el('latestQa').textContent = settings.qa ? 'QA notes: ' + settings.qa : 'No saved QA notes.';
      }
    }
    function renderSettings(next) {
      if (!next || !Array.isArray(next.releases) || !Number.isInteger(next.revision) || (settings && next.revision < settings.revision)) return;
      const unchanged = settings && settings.revision === next.revision;
      settings = next;
      if (!dirty.size) draftRevision = settings.revision;
      if (draftRevision !== settings.revision) conflictPending = false;
      const first = settings.releases.at(0);
      el('releasePreview').textContent = first ? releaseLabel(first) +
        (settings.releases.length > 1 ? ' and ' + (settings.releases.length - 1) + ' more' : '') : 'No releases listed';
      el('releasePreview').classList.toggle('muted', !first);
      el('qaPreview').textContent = settings.qa?.trim() || 'No QA notes';
      el('qaPreview').classList.toggle('muted', !settings.qa?.trim());
      if (!unchanged) {
        if (!dirty.has('releases')) {
          el('releaseRows').replaceChildren();
          for (const release of settings.releases) addRelease(release);
        }
        if (!dirty.has('qa')) el('qa').value = settings.qa || '';
      }
      updateEditors();
      if (draftRevision !== settings.revision) settingsMessage('Review the latest saved settings below. Your draft is still here.');
    }
    function editSettings(section) {
      dirty.add(section);
      if (settings?.revision === draftRevision && !conflictPending) settingsMessage('');
      updateEditors();
    }
    function payloadReleases() {
      if (!dirty.has('releases')) return settings.releases;
      const releases = [];
      for (const row of el('releaseRows').children) {
        const nameInput = row.querySelector('[name=releaseName]');
        const name = nameInput.value.trim();
        const date = row.querySelector('[name=releaseDate]').value;
        if (!name && date) {
          nameInput.focus();
          throw new Error('Enter a coffee name for each release date.');
        }
        if (name) releases.push({ name, date: date || null });
      }
      return releases;
    }
    function refreshDraft(data) {
      dirty.clear();
      settings = undefined;
      renderSettings(data);
    }

    async function readJson(response) {
      return response.json().catch(() => ({}));
    }
    function sourceStatus(source = {}) {
      const timestamp = dateText(source.asOf, timeFormat);
      if (timestamp && source.status === 'stale') return 'Last Cropster update ' + timestamp + ' Sydney time. Data may be out of date.';
      if (timestamp) return 'Cropster updated ' + timestamp + ' Sydney time.' +
        (source.status === 'partial' ? ' Some readings are unavailable.' : '');
      return 'Cropster data is unavailable.';
    }
    function renderReport(data) {
      const nextPriceVersion = JSON.stringify(data.prices || {});
      const nextConsumptionVersion = JSON.stringify(data.consumption || {});
      if (nextPriceVersion !== priceVersion) {
        priceVersion = nextPriceVersion;
        renderPrices(data.prices);
      }
      if (nextConsumptionVersion !== consumptionVersion) {
        consumptionVersion = nextConsumptionVersion;
        renderConsumption(data.consumption);
      }
      renderCoffeeC(data.coffeeC);
      renderPurchases(data.purchases);
      renderSettings(data.settings);
      message('status', sourceStatus(data.source));
      el('sourceNote').textContent = data.source?.note || '';
      el('sourceNote').hidden = !data.source?.note;
      el('board').hidden = false;
    }
    function abortLoad() {
      activeRequest?.abort();
      activeRequest = undefined;
    }
    function setBusy(value) {
      busy = value;
      el('refresh').disabled = value;
      el('cropsterEditor').disabled = value;
      updateEditors();
    }
    function showSession(value) {
      sessionGeneration++;
      signedIn = value;
      el('loading').hidden = true;
      el('login').hidden = value;
      el('lab').hidden = !value;
      el('actions').hidden = !value;
      el('skipLink').href = value ? '#lab' : '#login';
      if (value) return;
      abortLoad();
      settings = undefined;
      draftRevision = undefined;
      conflictPending = false;
      priceVersion = undefined;
      consumptionVersion = undefined;
      purchases = undefined;
      purchaseMonth = todaySydney().slice(0, 7);
      selectedPurchaseDate = todaySydney();
      dirty.clear();
      setBusy(false);
      el('board').hidden = true;
      for (const id of ['blendHighlights', 'blendDetails', 'otherPriceRows', 'monthRows', 'lastMonthRows', 'forecastRows', 'releaseRows', 'latestReleases', 'purchaseDays', 'selectedPurchases', 'upcomingPurchases', 'purchaseTotalRows']) el(id).replaceChildren();
      for (const id of ['releasePreview', 'qaPreview', 'latestQa', 'stockAsOf', 'forecastNote', 'sourceNote', 'status', 'consumptionNote', 'lastMonthTitle', 'consumptionWindow', 'priceDates', 'lossNote', 'coffeeCChange', 'coffeeCContract', 'coffeeCTiming', 'coffeeCAsOf', 'coffeeCNote', 'purchasePreview', 'purchaseNote', 'purchaseAsOf', 'purchaseMonth', 'selectedPurchaseDate', 'selectedPurchaseEmpty', 'upcomingPurchaseEmpty']) el(id).textContent = '';
      for (const id of ['avgKg', 'avgBags', 'coffeeCPrice']) el(id).textContent = missing;
      for (const id of ['coffeeCSource', 'purchaseSource']) safeSourceLink(id, undefined);
      for (const id of ['qa', 'cropsterInput', 'password']) el(id).value = '';
      settingsMessage('');
      message('cropsterMessage', '');
    }
    function expireSession() {
      showSession(false);
      message('loginMessage', 'Sign in again to open Roastery Lab.', true);
      el('password').focus();
    }
    async function load(showLoading = true) {
      if (!signedIn || busy) return;
      abortLoad();
      const controller = new AbortController();
      activeRequest = controller;
      if (showLoading) message('status', 'Loading Roastery Lab…');
      try {
        const response = await fetch('/api/roastery-lab', { cache: 'no-store', signal: controller.signal });
        if (controller !== activeRequest) return;
        if (response.status === 401) { expireSession(); return; }
        const data = await readJson(response);
        if (controller !== activeRequest) return;
        if (!response.ok || !data.source || !data.settings) throw new Error(data.error || 'Roastery Lab could not be loaded. Try refreshing.');
        renderReport(data);
      } catch (error) {
        if (controller === activeRequest) message('status', error.message, true);
      } finally {
        if (controller === activeRequest) activeRequest = undefined;
      }
    }
    el('addRelease').addEventListener('click', () => {
      if (el('releaseRows').childElementCount >= maximumReleases) return;
      addRelease().focus();
      editSettings('releases');
    });
    el('purchasePrevious').addEventListener('click', () => changePurchaseMonth(-1));
    el('purchaseNext').addEventListener('click', () => changePurchaseMonth(1));
    el('purchaseToday').addEventListener('click', () => {
      selectedPurchaseDate = todaySydney();
      purchaseMonth = selectedPurchaseDate.slice(0, 7);
      renderPurchaseCalendar();
    });
    el('purchaseDays').addEventListener('click', event => {
      const button = event.target.closest('button[data-date]');
      if (!button) return;
      selectedPurchaseDate = button.dataset.date;
      for (const day of el('purchaseDays').querySelectorAll('button')) {
        day.setAttribute('aria-pressed', String(day === button));
      }
      renderSelectedPurchases(purchaseEvents());
    });
    el('releaseRows').addEventListener('input', () => editSettings('releases'));
    el('qa').addEventListener('input', () => editSettings('qa'));
    el('rebaseSettings').addEventListener('click', () => {
      draftRevision = settings.revision;
      updateEditors();
      settingsMessage('Draft kept. Save when ready.');
      const save = dirty.has('releases') ? el('saveReleases') : el('saveQa');
      save.focus();
    });
    el('settingsForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!signedIn || busy || !dirty.size || conflictPending || draftRevision !== settings?.revision) return;
      let releases;
      try { releases = payloadReleases(); }
      catch (error) { settingsMessage(error.message, true); return; }
      const generation = sessionGeneration;
      const body = { releases, qa: el('qa').value, expectedRevision: draftRevision };
      let reload = false;
      abortLoad();
      setBusy(true);
      settingsMessage('Saving lab settings…');
      try {
        const response = await fetch('/api/roastery-lab/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const data = await readJson(response);
        if (generation !== sessionGeneration) return;
        if (response.status === 401) { expireSession(); return; }
        if (response.status === 409) {
          conflictPending = true;
          reload = true;
          throw new Error('The settings have changed. Your draft is still here.');
        }
        if (!response.ok || !Number.isInteger(data.revision)) throw new Error(data.error || 'Settings could not be saved.');
        refreshDraft(data);
        settingsMessage('Lab settings saved.');
      } catch (error) {
        if (generation === sessionGeneration) settingsMessage(error.message, true);
      } finally {
        if (generation === sessionGeneration) {
          setBusy(false);
          if (reload) load(false);
        }
      }
    });
    el('cropsterForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !signedIn) return;
      let report;
      try {
        report = JSON.parse(el('cropsterInput').value);
        if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error();
      } catch {
        message('cropsterMessage', 'Paste a valid Cropster report JSON object.', true);
        return;
      }
      const generation = sessionGeneration;
      abortLoad();
      setBusy(true);
      message('cropsterMessage', 'Saving Cropster data…');
      try {
        const response = await fetch('/api/roastery-lab/cropster', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
        });
        const data = await readJson(response);
        if (generation !== sessionGeneration) return;
        if (response.status === 401) { expireSession(); return; }
        if (!response.ok || !data.source || !data.settings) throw new Error(data.error || 'Cropster data could not be saved.');
        renderReport(data);
        el('cropsterInput').value = '';
        message('cropsterMessage', 'Cropster data saved.');
      } catch (error) {
        if (generation === sessionGeneration) message('cropsterMessage', error.message, true);
      } finally {
        if (generation === sessionGeneration) setBusy(false);
      }
    });
    el('signInForm').addEventListener('submit', async event => {
      event.preventDefault();
      el('signIn').disabled = true;
      message('loginMessage', '');
      try {
        const response = await fetch('/api/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: el('password').value }),
        });
        const data = await readJson(response);
        if (!response.ok || !data.authenticated) throw new Error(data.error || 'Sign-in could not be completed.');
        showSession(true);
        el('lab').focus({ preventScroll: true });
        load();
      } catch (error) {
        message('loginMessage', error.message, true);
      } finally {
        el('password').value = '';
        el('signIn').disabled = false;
      }
    });
    el('logout').addEventListener('click', async () => {
      el('logout').disabled = true;
      try {
        const response = await fetch('/api/auth', { method: 'DELETE' });
        if (!response.ok) throw new Error('Sign-out could not be completed. Try again.');
        showSession(false);
        message('loginMessage', '');
        el('password').focus();
      } catch (error) {
        if (signedIn) message('status', error.message, true);
      } finally {
        el('logout').disabled = false;
      }
    });
    el('refresh').addEventListener('click', () => load());
    fetch('/api/auth', { cache: 'no-store' }).then(readJson).then(data => {
      showSession(data.authenticated === true);
      if (signedIn) load();
    }).catch(() => {
      showSession(false);
      message('loginMessage', 'The sign-in service could not be reached. Try signing in again.', true);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !activeRequest) load(false); });
    setInterval(() => { if (!document.hidden && !activeRequest) load(false); }, 60000);
  </script>
</body>
</html>`;
