export const weeklyPage = String.raw`<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Steam Room | Black Market Coffee</title>
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
    body, h1, h2, h3, p, dl, dd { margin: 0; }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .56; cursor: default; }
    a { color: inherit; text-underline-offset: .2em; }
    :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
    .wrap { width: min(100% - 3rem, 86rem); margin-inline: auto; }
    header { background: var(--paper); border-bottom: 1px solid var(--line); }
    .bar, .brand, .actions, .dashboard-nav, .week-nav { display: flex; align-items: center; gap: .6rem; }
    .bar { justify-content: space-between; min-height: 4.25rem; }
    .brand { text-decoration: none; }
    .brand img { display: block; width: auto; height: 2.9rem; max-width: 9rem; object-fit: contain; }
    .dashboard-nav { margin-inline: .6rem auto; gap: .35rem; font-size: .87rem; }
    .dashboard-nav a { padding: .45rem .65rem; border-radius: .3rem; text-decoration: none; white-space: nowrap; }
    .dashboard-nav a:hover { background: var(--background); }
    .dashboard-nav a[aria-current] { background: var(--green-light); color: var(--green); font-weight: 700; }
    .button { border: 1px solid var(--line); border-radius: .35rem; background: var(--paper); color: var(--ink); padding: .4rem .75rem; min-height: 2.7rem; }
    .actions .button { white-space: nowrap; }
    .primary { background: var(--accent); border-color: var(--accent); color: white; }
    .quiet { border-color: transparent; }
    .button:hover:not(:disabled) { border-color: var(--muted); }
    main.report { padding-block: clamp(1.45rem, 3vw, 2.45rem) 2rem; }
    .intro { display: flex; justify-content: space-between; align-items: end; flex-wrap: wrap; gap: .8rem 1.25rem; margin-bottom: .85rem; }
    h1 { font-size: clamp(1.9rem, 4vw, 2.85rem); letter-spacing: -.045em; line-height: 1.1; }
    .dates { color: var(--muted); font-size: clamp(1rem, 2vw, 1.2rem); margin-top: .37rem; }
    .week-nav { flex-wrap: wrap; font-size: .85rem; }
    .report-status { display: flex; gap: .4rem 1.1rem; align-items: baseline; flex-wrap: wrap; font-size: .83rem; color: var(--muted); min-height: 1.25rem; margin-bottom: 1rem; }
    .error { color: #912125; }
    .report-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: clamp(.7rem, 1.3vw, 1.15rem); align-items: start; }
    .meeting-card { grid-column: span 2; min-width: 0; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: .55rem; }
    .meeting-card.featured { grid-column: span 3; }
    .meeting-card.week-note, .meeting-card.expenses { grid-column: span 3; }
    .meeting-card.demand { border-top: 4px solid var(--accent); }
    .meeting-card.production { color: #fff; background: var(--green); border-color: var(--green); border-top-width: 4px; }
    .meeting-card summary { cursor: pointer; display: block; min-height: 12.65rem; padding: clamp(1rem, 1.7vw, 1.55rem); border-radius: inherit; }
    .meeting-card.featured summary { min-height: 13.8rem; }
    .meeting-card.week-note summary { display: flex; align-items: center; gap: .65rem 1rem; min-height: 0; padding-block: .65rem; }
    .meeting-card.expenses summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: .25rem .7rem; min-height: 0; padding-block: .65rem; }
    .expenses .metric-figure { margin: 0; font-size: clamp(1.7rem, 3.2vw, 2.65rem); }
    .expenses .expense-copy { display: grid; gap: .2rem; }
    .expenses .over-limit { color: var(--accent); }
    .expenses .status-flag { grid-column: 1 / -1; margin: 0; }
    .expense-freshness { grid-column: 1 / -1; font-size: .73rem; line-height: 1.35; color: var(--muted); }
    .expense-forecast { margin-top: 1rem; padding-top: .8rem; border-top: 1px solid var(--line); }
    .expense-capture textarea { display: block; width: 100%; min-height: 7rem; margin-block: .45rem .65rem; padding: .5rem; border: 1px solid var(--line); border-radius: .3rem; resize: vertical; }
    .week-note .disclosure { margin-inline-start: auto; }
    .week-note-preview { flex: 1; min-width: 0; color: var(--muted); font-size: .87rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .week-note-points { margin: 0 0 1rem; padding-inline-start: 1.25rem; overflow-wrap: anywhere; }
    .week-note-points li + li { margin-top: .28rem; }
    .week-note-form { max-width: 53rem; }
    .week-note-form label { display: block; font-weight: 700; }
    .week-note-form textarea { display: block; width: 100%; min-height: 6rem; resize: vertical; padding: .6rem .65rem; margin: .4rem 0 .65rem; border: 1px solid var(--line); border-radius: .3rem; }
    .week-note-form .detail-note { margin-top: .35rem; }
    .week-note-tools { display: flex; flex-wrap: wrap; gap: .4rem .6rem; }
    .meeting-card summary::-webkit-details-marker { display: none; }
    .meeting-card summary::marker { content: ""; }
    .meeting-card summary:hover { background: rgba(0, 0, 0, .03); }
    .meeting-card.production summary:hover { background: rgba(255, 255, 255, .055); }
    .meeting-card.production summary:focus-visible { outline-color: #fff; outline-offset: -4px; }
    .card-head { display: flex; align-items: start; justify-content: space-between; gap: .75rem; margin-bottom: .75rem; }
    .card-title { font-size: clamp(1.03rem, 1.6vw, 1.3rem); font-weight: 700; letter-spacing: -.02em; line-height: 1.2; }
    .disclosure { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; flex: 0 0 auto; border: 1px solid currentColor; border-radius: 50%; color: var(--muted); line-height: 1; font-size: 1.14rem; }
    .disclosure::before { content: "+"; }
    .meeting-card[open] .disclosure::before { content: "−"; }
    .production .disclosure, .production .metric-label, .production .status-flag, .production .source-note, .production .detail-note, .production .comparison .context, .production dt { color: var(--green-light); }
    .headline { display: block; margin-block: .2rem .35rem; }
    .metric-figure { display: block; font-size: clamp(2.25rem, 4.1vw, 4rem); line-height: 1.05; font-weight: 750; letter-spacing: -.055em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .demand .metric-figure { font-size: clamp(3rem, 5.7vw, 5rem); }
    .production-primary .metric-figure { font-size: clamp(2rem, 3.5vw, 3.25rem); margin-top: .3rem; }
    .production-primary.single { grid-template-columns: 1fr; }
    .production-capture { display: block; margin-top: .85rem; font-size: .78rem; line-height: 1.4; color: var(--green-light); }
    .production-capture[data-state="failed"] { color: #ffe0d9; border-left: 3px solid #ff9e8d; padding-left: .6rem; }
    .production-capture[data-state="pending"], .production-capture[data-state="unknown"] { color: #f6dfb7; }
    .ui-update { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; margin: .8rem 0; padding: .8rem; border: 1px solid var(--line); border-radius: .7rem; }
    .production-headline { display: flex; flex-wrap: wrap; gap: .4rem .85rem; align-items: baseline; margin-top: .35rem; }
    .production-headline .metric-secondary { margin-top: 0; }
    .production-total-label { margin-top: .3rem; }
    .production-comparison { font-size: .94rem; color: var(--green-light); }
    .metric-figure .unit { font-size: .46em; font-weight: 700; letter-spacing: -.026em; white-space: nowrap; }
    .metric-label { display: block; color: var(--muted); font-size: .84rem; font-weight: 700; }
    .metric-secondary { display: block; font-size: clamp(1rem, 1.9vw, 1.45rem); font-weight: 700; margin-top: .26rem; font-variant-numeric: tabular-nums; line-height: 1.26; overflow-wrap: anywhere; }
    .metric-secondary .unit { font-size: .83em; }
    .green-stock .metric-secondary { font-size: clamp(1.25rem, 2vw, 1.75rem); }
    .comparison { display: block; font-weight: 700; font-size: clamp(.91rem, 1.65vw, 1.2rem); margin-top: .54rem; line-height: 1.25; }
    .comparison .context { font-weight: 400; font-size: .81em; color: var(--muted); }
    .status-flag { display: block; color: var(--caution); font-size: .78rem; line-height: 1.4; margin-top: .75rem; }
    .production .status-flag { color: #f6dfb7; }
    .card-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem 1rem; align-items: start; margin-top: .85rem; }
    .card-pair>span { min-width: 0; display: block; }
    .card-pair>span + span { padding-inline-start: .9rem; border-inline-start: 1px solid var(--line); }
    .production .card-pair>span + span { border-color: #779083; }
    .production .metric-figure { font-size: clamp(2.25rem, 4.1vw, 4rem); }
    .production .card-pair { margin-top: .85rem; }
    .production .card-pair .metric-secondary { margin-top: .19rem; }
    .wholesale-results .metric-figure { font-size: clamp(1.42rem, 2.55vw, 2.2rem); margin-top: .18rem; }
    .wholesale .headline { margin-bottom: .5rem; }
    .wholesale-results { margin-top: .5rem; }
    .card-body { border-top: 1px solid var(--line); padding: .96rem clamp(1rem, 1.7vw, 1.55rem) 1.15rem; font-size: .89rem; }
    .production .card-body { border-color: #779083; }
    .card-body h2 { font-size: 1rem; line-height: 1.3; margin-bottom: .58rem; }
    .production .breakdown + h2 { margin-top: .85rem; }
    .breakdown { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem .85rem; }
    dt { color: var(--muted); font-size: .84rem; line-height: 1.35; }
    dd { font-size: 1.05rem; font-weight: 700; margin-top: .16rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .source-note, .detail-note { color: var(--muted); font-size: .8rem; line-height: 1.5; margin-top: .75rem; }
    .carry-forward { display: block; color: var(--muted); font-size: .8rem; line-height: 1.4; margin-top: .35rem; font-variant-numeric: tabular-nums; }
    .carry-forward-detail { margin-top: .85rem; }
    .detail-table { width: 100%; border-collapse: collapse; margin-top: .7rem; text-align: left; }
    .detail-table th, .detail-table td { padding: .4rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    .detail-table th:last-child, .detail-table td:last-child { padding-inline-start: .6rem; text-align: right; font-variant-numeric: tabular-nums; }
    .detail-table th { color: var(--muted); font-size: .78rem; }
    .detail-table tbody th { font-size: inherit; color: inherit; font-weight: 400; overflow-wrap: anywhere; }
    .source-details, .links { color: var(--muted); font-size: .82rem; margin-top: 1rem; }
    .source-details summary { cursor: pointer; width: fit-content; }
    .source-details a, .links a { font-weight: 700; }
    .source-list { padding-left: 1.15rem; margin: .55rem 0 0; max-width: 72ch; }
    .source-list li + li { margin-top: .4rem; }
    .capture-form { max-width: 42rem; margin-block: .75rem; color: var(--ink); }
    .capture-form fieldset { border: 0; padding: 0; margin: 0 0 .8rem; }
    .capture-form legend { font-weight: 700; margin-bottom: .4rem; }
    .monday-form { border-top: 1px solid var(--line); padding-top: .8rem; }
    .monday-form .capture-fields { grid-template-columns: minmax(0, 15rem); margin-top: .55rem; }
    .monday-form .detail-note { margin-top: .25rem; }
    .capture-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .45rem .75rem; }
    .capture-fields label { display: grid; gap: .2rem; }
    .capture-fields input { width: 100%; min-width: 0; padding: .375rem; border: 1px solid var(--line); border-radius: .25rem; }
    .cropster-link { display: inline-block; margin-top: .75rem; }
    .friday-links { display: flex; flex-wrap: wrap; gap: .4rem .85rem; margin-bottom: .65rem; }
    .wholesale-window { margin: 0 0 .65rem; }
    #greenCapture .capture-fields { margin-top: .65rem; }
    .links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .45rem 1rem; }
    .login { display: grid; place-items: center; min-height: 60vh; padding: 1rem; }
    .sign-in { width: min(100%, 25rem); padding: 1.45rem; background: var(--paper); border: 1px solid var(--line); border-top: 4px solid var(--accent); border-radius: .55rem; }
    .sign-in h1 { font-size: 1.85rem; }
    .sign-in label, .sign-in input, .sign-in button { display: block; width: 100%; }
    .sign-in label { font-size: .9rem; font-weight: 700; margin-top: 1rem; }
    .sign-in input { border: 1px solid var(--line); border-radius: .35rem; padding: .55rem; margin-block: .35rem .75rem; }
    .loading { padding: 2rem; text-align: center; }
    .skip-link { position: absolute; top: -5rem; left: .75rem; background: var(--paper); color: var(--ink); padding: .7rem; }
    .skip-link:focus { top: .7rem; z-index: 1; }
    @media (min-width: 58.01rem) and (max-height: 50rem) {
      .bar { min-height: 3.4rem; }
      .brand img { height: 2.35rem; }
      main.report { padding-block: 1.2rem 1rem; }
      .intro { margin-bottom: .55rem; }
      .report-status { margin-bottom: .65rem; }
      .report-grid { gap: .75rem; }
      .meeting-card summary { min-height: 10.9rem; padding: .8rem clamp(.85rem, 1.4vw, 1.2rem); }
      .meeting-card.featured summary { min-height: 13.25rem; }
      .card-head { margin-bottom: .42rem; }
      .headline { margin-block: .12rem .25rem; }
      .metric-figure, .production .metric-figure { font-size: clamp(2.35rem, 3.65vw, 3.35rem); }
      .demand .metric-figure { font-size: clamp(3rem, 4.6vw, 4.15rem); }
      .card-pair, .production .card-pair, .wholesale-results { margin-top: .4rem; }
      .production-headline, .production-total-label { margin-top: .2rem; }
      .comparison { margin-top: .36rem; }
      .status-flag { margin-top: .42rem; }
      .links, .source-details { margin-top: .65rem; }
    }
    @media (max-width: 58rem) {
      .meeting-card { grid-column: span 3; }
      .meeting-card.wholesale { grid-column: 1 / -1; }
      .wholesale summary { min-height: 0; }
      .wholesale-results { max-width: 26rem; }
    }
    @media (max-width: 36rem) {
      .wrap { width: calc(100% - 1.5rem); }
      .report-grid { grid-template-columns: 1fr; }
      .meeting-card, .meeting-card.featured, .meeting-card.wholesale, .meeting-card.week-note, .meeting-card.expenses { grid-column: auto; }
      .meeting-card summary, .meeting-card.featured summary { min-height: 0; }
      .brand img { height: 2.35rem; }
      .bar { flex-wrap: wrap; gap: .2rem .45rem; padding-block: .35rem; }
      .dashboard-nav { order: 3; flex-basis: 100%; margin: 0 0 .2rem; }
      .actions { gap: .25rem; }
      .actions .button, .week-nav .button { font-size: .8rem; padding-inline: .55rem; }
      .production .metric-figure { font-size: clamp(2.1rem, 8vw, 3rem); }
      .meeting-card.expenses summary { grid-template-columns: minmax(0, 1fr) auto; }
      .expenses .metric-figure { grid-row: 2; grid-column: 1 / -1; }
      .expenses .disclosure { grid-row: 1; grid-column: 2; }
    }
    @media print {
      :root, .meeting-card.production { background: white; color: black; }
      .production .metric-label, .production .status-flag, .production .source-note, .production .detail-note, .production .comparison .context, .production dt { color: #444; }
      .actions, .dashboard-nav, .week-nav, .disclosure, .source-details, .links { display: none !important; }
      .meeting-card { break-inside: avoid; }
      .wrap { width: 100%; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#report">Skip to Steam Room</a>
  <header><div class="wrap bar">
    <a class="brand" href="/"><img src="/bmc-logo.png" alt="Black Market Coffee"></a>
    <nav class="dashboard-nav" aria-label="Dashboards">
      <a href="/" aria-current="page">Steam Room</a>
      <a href="/roastery-lab">Roastery Lab</a>
      <a href="/warehouse">Warehouse</a>
    </nav>
    <div id="actions" class="actions" hidden>
      <button id="refresh" class="button quiet" type="button">Refresh</button>
      <button id="logout" class="button" type="button">Sign out</button>
    </div>
  </div></header>
  <p id="loading" class="loading" role="status">Opening Steam Room…</p>
  <noscript><p class="loading">Enable JavaScript to sign in and view the dashboard.</p></noscript>
  <main id="login" class="login" hidden>
    <section class="sign-in" aria-labelledby="signInTitle">
      <h1 id="signInTitle">Steam Room</h1>
      <form id="signInForm">
        <label for="password">Stock Take App password</label>
        <input id="password" type="password" autocomplete="current-password" required maxlength="256">
        <button id="signIn" class="button primary" type="submit">Sign in</button>
        <p id="loginMessage" class="detail-note error" role="alert" hidden></p>
      </form>
    </section>
  </main>
  <main id="report" class="wrap report" tabindex="-1" hidden>
    <div class="intro">
      <div><h1>Steam Room</h1><p id="dates" class="dates"></p></div>
      <nav class="week-nav" aria-label="Reporting week">
        <button id="previous" class="button" type="button">Previous week</button>
        <button id="next" class="button" type="button" disabled>Next week</button>
        <button id="currentWeek" class="button" type="button" hidden>This week</button>
      </nav>
    </div>
    <div class="report-status"><p id="status" role="status"></p><p id="refreshPolicy" hidden>Cropster uses saved readings.</p></div>
    <div id="uiUpdate" class="ui-update" role="status" hidden><span id="uiUpdateText"></span><button id="uiReload" class="button" type="button">Reload dashboard</button></div>
    <div id="figures" class="report-grid" hidden>
      <details class="meeting-card featured demand">
        <summary>
          <span class="card-head"><span class="card-title">Weekly demand</span><span class="disclosure" aria-hidden="true"></span></span>
          <span id="demandKg" class="metric-figure headline">—</span>
          <span id="demandChange" class="comparison"></span>
          <span id="demandCarryForward" class="carry-forward" hidden></span>
          <span id="demandFlag" class="status-flag" hidden></span>
        </summary>
        <div class="card-body">
          <h2>Weekly demand comparison</h2>
          <dl class="breakdown"><div><dt id="demandCurrentLabel">Selected week</dt><dd id="demandDetail">—</dd></div><div><dt id="demandPreviousLabel">Previous week</dt><dd id="demandPrevious">—</dd></div></dl>
          <p id="demandSource" class="source-note" hidden></p>
          <p id="demandNote" class="detail-note" hidden></p>
          <div id="demandCarryDetail" class="carry-forward-detail" hidden>
            <h2>Carry-forward calculation</h2>
            <dl class="breakdown">
              <div><dt>Roasted coffee on hand</dt><dd id="demandBrownOnHand">—</dd></div>
              <div><dt id="demandMondayDate">Monday roasted</dt><dd id="demandMondayRoast">—</dd></div>
            </dl>
            <p id="demandCarryNote" class="detail-note" hidden></p>
          </div>
        </div>
      </details>
      <details class="meeting-card featured production">
        <summary>
          <span class="card-head"><span id="productionCardTitle" class="card-title">Roasted &amp; scheduled</span><span class="disclosure" aria-hidden="true"></span></span>
          <span id="productionPair" class="card-pair production-primary">
            <span><span class="metric-label">Roasted · actual output</span><span id="roastedKg" class="metric-figure">—</span></span>
            <span id="scheduledPrimary"><span class="metric-label">Scheduled to roast</span><span id="scheduledKg" class="metric-figure">—</span><span id="scheduledBatchCount" class="metric-label" hidden></span></span>
          </span>
          <span id="productionValue" class="metric-secondary">—</span>
          <span id="productionCostLabel" class="metric-label">Green cost · roasted + scheduled estimate</span>
          <span id="productionChange" class="comparison production-comparison"></span>
          <span id="productionCapture" class="production-capture" hidden></span>
          <span id="productionFlag" class="status-flag" hidden></span>
        </summary>
        <div class="card-body">
          <dl class="breakdown" id="productionDetails" hidden>
            <div id="expectedOutputRow"><dt id="productionTotalLabel">Expected roasted output this week</dt><dd id="productionKg">—</dd></div>
            <div><dt>Roasted</dt><dd id="roastedDetailKg">—</dd></div>
            <div id="scheduledGreenRow"><dt>Scheduled to roast (green)</dt><dd id="scheduledGreenDetailKg">—</dd></div>
            <div id="scheduledBatchRow"><dt>Pending scheduled batches</dt><dd id="scheduledBatchDetailCount">—</dd></div>
            <div id="scheduledDetailRow"><dt>Remaining roasted output · estimate</dt><dd id="scheduledDetailKg">—</dd></div>
            <div><dt>Roasted green cost</dt><dd id="roastedValue">—</dd></div>
            <div id="scheduledValueRow"><dt>Scheduled green cost estimate</dt><dd id="scheduledValue">—</dd></div>
          </dl>
          <p id="scheduledSourceNote" class="detail-note">Roasted is actual output from Cropster Production Report. Scheduled to roast is pending green input from Cropster Scheduled batches, Monday to Friday, excluding roasted batches. Expected roasted output uses the remaining roast-output estimate; raw green kilograms are not added directly to roasted kilograms.</p>
          <a id="cropsterScheduleLink" class="cropster-link" href="https://c-sar.cropster.com/apps/roast/schedule/calendar/week" target="_blank" rel="noopener noreferrer">Open Cropster Scheduled batches</a>
          <h2 id="productionPreviousLabel">Previous week</h2>
          <dl class="breakdown">
            <div id="previousCombinedRow"><dt>Combined production</dt><dd id="previousProductionKg">—</dd></div>
            <div><dt id="previousProductionValueLabel">Production value</dt><dd id="previousProductionValue">—</dd></div>
            <div><dt>Roasted</dt><dd id="previousRoastedKg">—</dd></div>
            <div id="previousScheduledRow" hidden><dt>Scheduled</dt><dd id="previousScheduledKg">—</dd></div>
          </dl>
          <p id="productionComparisonNote" class="source-note" hidden></p>
          <p id="productionSource" class="source-note" hidden></p>
          <p id="productionNote" class="detail-note" hidden></p>
          <a id="cropsterProductionLink" class="cropster-link" target="_blank" rel="noopener noreferrer">Open Cropster Production Report</a>
        </div>
      </details>
      <details class="meeting-card green-stock">
        <summary>
          <span class="card-head"><span class="card-title">Green bean stock</span><span class="disclosure" aria-hidden="true"></span></span>
          <span class="metric-label">Marrickville</span>
          <span id="greenKg" class="metric-figure headline">—</span>
          <span id="greenValue" class="metric-secondary">—</span>
          <span id="greenFlag" class="status-flag" hidden></span>
        </summary>
        <div class="card-body">
          <h2>Marrickville green stock on hand</h2>
          <dl class="breakdown" id="greenDetails" hidden>
            <div><dt id="greenWeightLabel">Current weight</dt><dd id="greenDetailKg">—</dd></div>
            <div><dt>Inventory value</dt><dd id="greenDetailValue">—</dd></div>
          </dl>
          <dl class="breakdown" id="greenBreakdown" hidden><div><dt>Lots needing review</dt><dd id="greenUnpriced">—</dd></div></dl>
          <p id="greenSource" class="source-note" hidden></p>
          <p id="greenNote" class="detail-note" hidden></p>
          <a id="greenInventoryLink" class="cropster-link" href="https://c-sar.cropster.com/apps/lots/inventory-report/location" target="_blank" rel="noopener noreferrer">Open Cropster Green Inventory Report</a>
        </div>
      </details>
      <details class="meeting-card stock">
        <summary>
          <span class="card-head"><span id="stockCardTitle" class="card-title">Current non-coffee stock</span><span class="disclosure" aria-hidden="true"></span></span>
          <span id="stockValue" class="metric-figure headline">—</span>
          <span id="stockItems" class="metric-secondary" hidden></span>
          <span id="stockFlag" class="status-flag" hidden></span>
        </summary>
        <div class="card-body">
          <h2 id="stockCategoryTitle">Value by category</h2>
          <table id="stockBreakdown" class="detail-table" hidden>
            <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
            <tbody id="stockCategories"></tbody>
          </table>
          <p id="stockSource" class="source-note" hidden></p>
          <p id="stockNote" class="detail-note" hidden></p>
        </div>
      </details>
      <details class="meeting-card wholesale">
        <summary>
          <span class="card-head"><span class="card-title">Wholesale dispatch</span><span class="disclosure" aria-hidden="true"></span></span>
          <span id="wholesaleTotal" class="metric-figure headline">—</span>
          <span class="metric-label" id="wholesaleTotalLabel">Scheduled orders</span>
          <span class="card-pair wholesale-results">
            <span><span class="metric-label">Done orders</span><span id="wholesaleDone" class="metric-figure">—</span></span>
            <span><span class="metric-label">Pending orders</span><span id="wholesalePending" class="metric-figure">—</span></span>
          </span>
          <span id="wholesaleClients" class="metric-secondary">— clients completed</span>
          <span id="wholesaleClientsFlag" class="status-flag" hidden></span>
          <span id="wholesaleFlag" class="status-flag" hidden></span>
        </summary>
        <div class="card-body">
          <p id="wholesaleScheduleLabel" class="detail-note wholesale-window">Scheduled orders</p>
          <h2>Clients with completed deliveries</h2>
          <p id="completedClientsScope" class="detail-note"></p>
          <table id="completedClientsTable" class="detail-table" hidden>
            <thead><tr><th scope="col">Client</th><th scope="col">Latest completion</th></tr></thead>
            <tbody id="completedClientsRows"></tbody>
          </table>
          <p id="completedClientsEmpty" class="detail-note"></p>
          <p id="completedClientsSource" class="source-note" hidden></p>
          <p id="completedClientsNote" class="detail-note" hidden></p>
          <h2 id="wholesalePreviousLabel">Previous week</h2>
          <dl class="breakdown">
            <div><dt>Scheduled orders</dt><dd id="previousWholesaleTotal">—</dd></div>
            <div><dt>Done</dt><dd id="previousWholesaleDone">—</dd></div>
            <div><dt>Pending</dt><dd id="previousWholesalePending">—</dd></div>
          </dl>
          <p id="wholesaleSource" class="source-note" hidden></p>
          <p id="wholesaleNote" class="detail-note" hidden></p>
        </div>
      </details>
      <details class="meeting-card expenses">
        <summary>
          <span class="expense-copy"><span class="card-title">Expenses</span><span id="expensesPeriod" class="metric-label">Week to date</span></span>
          <span id="expensesValue" class="metric-figure">—</span>
          <span class="disclosure" aria-hidden="true"></span>
          <span id="expensesFlag" class="status-flag" hidden></span>
          <span id="expensesFreshness" class="expense-freshness" hidden></span>
        </summary>
        <div class="card-body">
          <h2>Source total · BMR Wholesale COGS</h2>
          <p id="expensesMonday" class="detail-note"></p>
          <p id="expensesCurrency" class="detail-note"></p>
          <table id="expensesBreakdown" class="detail-table" hidden>
            <thead><tr><th scope="col">Expense</th><th scope="col">Value</th></tr></thead>
            <tbody id="expensesItems"></tbody>
          </table>
          <p id="expensesSource" class="source-note" hidden></p>
          <p id="expensesNote" class="detail-note" hidden></p>
          <a id="expensesSourceLink" class="cropster-link" target="_blank" rel="noopener noreferrer" hidden>Open expense sheet</a>
          <section class="expense-forecast" aria-labelledby="greenForecastTitle">
            <h2 id="greenForecastTitle">Current month forecast Green Buy · EST cost</h2>
            <p id="greenForecastMonth" class="metric-label"></p>
            <p id="greenForecastValue" class="metric-secondary">—</p>
            <p class="detail-note">Estimate for the current Sydney calendar month.</p>
            <p id="greenForecastFlag" class="status-flag" hidden></p>
            <p id="greenForecastSource" class="source-note" hidden></p>
            <p id="greenForecastNote" class="detail-note" hidden></p>
            <a id="greenForecastLink" class="cropster-link" target="_blank" rel="noopener noreferrer" hidden>Open Green Buy forecast</a>
          </section>
        </div>
      </details>
      <details id="weekNote" class="meeting-card week-note">
        <summary>
          <span class="card-title">Note</span><span id="weekNotePreview" class="week-note-preview">Loading this week’s note…</span><span class="disclosure" aria-hidden="true"></span>
        </summary>
        <div class="card-body">
          <ul id="weekNotePoints" class="week-note-points" aria-label="Saved points" hidden></ul>
          <form id="weekNoteForm" class="week-note-form">
            <label for="weekNoteInput">Meeting points</label>
            <p id="weekNoteHelp" class="detail-note">Enter one point per line, up to 10 points. Save an empty note to clear it.</p>
            <textarea id="weekNoteInput" maxlength="2600" rows="5" aria-describedby="weekNoteHelp weekNoteFeedback" disabled></textarea>
            <div class="week-note-tools">
              <button id="weekNoteSave" class="button primary" type="submit" disabled>Save note</button>
              <button id="weekNoteReview" class="button" type="button" hidden>Keep draft and use latest version</button>
              <button id="weekNoteRetry" class="button" type="button" hidden>Refresh note</button>
            </div>
            <p id="weekNoteFeedback" class="detail-note" role="status" hidden></p>
          </form>
        </div>
      </details>
    </div>
    <details id="sources" class="source-details" hidden>
      <summary>Data sources</summary>
      <ul id="sourceList" class="source-list"></ul>
      <details id="expensesCapture" class="source-details">
        <summary>Save a verified sheet reading</summary>
        <form id="expensesCaptureForm" class="capture-form expense-capture">
          <label for="expensesCaptureInput">Verified expense sheet reading</label>
          <p id="expensesCaptureHelp" class="detail-note">Paste the verified reading from the private expense sheet for the selected Monday. This saves a dated reading while the sheet connection is being set up.</p>
          <p id="expensesCaptureWeek" class="detail-note"></p>
          <textarea id="expensesCaptureInput" maxlength="100000" spellcheck="false" aria-describedby="expensesCaptureHelp expensesCaptureWeek" required></textarea>
          <button id="expensesCaptureSave" type="submit" class="button primary">Save verified reading</button>
          <p id="expensesCaptureMessage" class="detail-note" role="status" hidden></p>
        </form>
      </details>
      <details id="capture" class="source-details" hidden>
        <summary>Record Cropster readings</summary>
        <form id="captureForm" class="capture-form">
          <p class="detail-note">Use the figures from the Cropster website. Enter scheduled output and green cost for batches still to roast. Use 0 only when Cropster confirms none. Blank fields are unavailable.</p>
          <div id="captureFields"></div>
          <button id="captureSave" type="submit" class="button primary">Save readings</button>
          <p id="captureMessage" class="detail-note" role="status" hidden></p>
        </form>
        <form id="mondayCaptureForm" class="capture-form monday-form">
          <fieldset>
            <legend>Monday roast total</legend>
            <p id="mondayCaptureHelp" class="detail-note">In the Cropster Production Report, filter to this Monday in Sydney and enter the actual roasted output in kilograms. Enter 0 only if Cropster confirms no completed roasts.</p>
            <div class="capture-fields"><label>Monday roasted (kg)<input name="roastedKg" type="number" inputmode="decimal" min="0" max="1000000" step=".01" aria-describedby="mondayCaptureHelp" required></label></div>
          </fieldset>
          <button id="mondayCaptureSave" type="submit" class="button primary">Save Monday total</button>
          <p id="mondayCaptureMessage" class="detail-note" role="status" hidden></p>
        </form>
      </details>
      <details id="greenCapture" class="source-details" hidden>
        <summary>Record Marrickville green stock</summary>
        <form id="greenCaptureForm" class="capture-form">
          <fieldset>
            <legend>Marrickville green stock</legend>
            <p id="greenCaptureHelp" class="detail-note">Open the Cropster Green Inventory Report, select By location, and use the Marrickville row. Leave value blank if Cropster does not show it.</p>
            <a class="cropster-link" href="https://c-sar.cropster.com/apps/lots/inventory-report/location" target="_blank" rel="noopener noreferrer">Open Cropster inventory report</a>
            <div class="capture-fields">
              <label>Stock weight (kg)<input name="kg" type="number" inputmode="decimal" min="0" max="1000000" step=".01" aria-describedby="greenCaptureHelp" required></label>
              <label>Stock value (AUD, optional)<input name="value" type="number" inputmode="decimal" min="0" max="100000000" step=".01" aria-describedby="greenCaptureHelp"></label>
            </div>
          </fieldset>
          <button id="greenCaptureSave" type="submit" class="button primary">Save Marrickville stock</button>
          <p id="greenCaptureMessage" class="detail-note" role="status" hidden></p>
        </form>
      </details>
      <details id="fridayCapture" class="source-details" hidden>
        <summary>Record historical Cropster figures</summary>
        <form id="fridayCaptureForm" class="capture-form">
          <fieldset>
            <legend id="fridayCaptureTitle">Friday close</legend>
            <p id="fridayCaptureHelp" class="detail-note">Use actual roasted output and green cost from the Monday to Friday Cropster Production Report. For stock, use the dated Green Inventory Report and the Marrickville row at Friday close. Enter at least one weight.</p>
            <div class="friday-links">
              <a id="fridayProductionLink" class="cropster-link" target="_blank" rel="noopener noreferrer">Open Monday to Friday production</a>
              <a id="fridayGreenLink" class="cropster-link" target="_blank" rel="noopener noreferrer">Open Friday green inventory</a>
            </div>
            <div class="capture-fields">
              <label>Roasted output (kg)<input name="roastedKg" type="number" inputmode="decimal" min="0" max="1000000" step=".01" aria-describedby="fridayCaptureHelp"></label>
              <label>Roasted green cost (AUD)<input name="roastedValue" type="number" inputmode="decimal" min="0" max="100000000" step=".01" aria-describedby="fridayCaptureHelp"></label>
              <label>Marrickville green stock (kg)<input name="greenKg" type="number" inputmode="decimal" min="0" max="1000000" step=".01" aria-describedby="fridayCaptureHelp"></label>
              <label>Marrickville stock value (AUD)<input name="greenValue" type="number" inputmode="decimal" min="0" max="100000000" step=".01" aria-describedby="fridayCaptureHelp"></label>
            </div>
          </fieldset>
          <button id="fridayCaptureSave" type="submit" class="button primary">Save Friday figures</button>
          <p id="fridayCaptureMessage" class="detail-note" role="status" hidden></p>
        </form>
      </details>
    </details>
    <footer class="links"><p>Sydney reporting week · expenses use $ as recorded</p><a href="/details">Operations details and issue notes</a></footer>
  </main>
  <script>
    const uiBuildId = "__BMC_UI_BUILD_ID__";
    const el = id => document.getElementById(id);
    const amount = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
    const detailKg = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });
    const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
    const detailCurrency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
    const expenseAmount = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateTime = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const calendarDay = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' });
    const unavailable = '—';
    const sourceNames = { stockroom: 'Stock Take App', dispatch: 'Dispatch', cropster: 'Cropster' };
    let loadedWeek;
    let loadedCropsterRefresh = null;
    let requestedWeek = new URL(location.href).searchParams.get('week') || '';
    let currentRequest;
    let loadedWholesale = null, dispatchRequest = null, dispatchGeneration = 0, dispatchPollFailed = false;
    let signedIn = false;
    let expensesCaptureGeneration = 0;
    const weekNotes = new Map();
    const captureGroups = [
      ['This week', [
        ['roastedKg', 'Roasted (kg)', true], ['roastedValue', 'Roasted green cost (AUD)'],
        ['scheduledKg', 'Outstanding output (kg, estimate)'], ['scheduledValue', 'Outstanding green cost (AUD, estimate)'],
      ]],
      ['Previous week', [
        ['previousRoastedKg', 'Previous roasted (kg)'], ['previousRoastedValue', 'Previous roasted green cost (AUD)'],
        ['previousScheduledKg', 'Previous outstanding output (kg)'], ['previousScheduledValue', 'Previous outstanding green cost (AUD)'],
      ]],
    ];

    function format(value, formatter, unit = '') {
      return Number.isFinite(value) ? formatter.format(value) + unit : unavailable;
    }
    function weight(value, formatter = amount) { return format(value, formatter, ' kg'); }
    function money(value) { return format(value, currency); }
    function set(id, value) { el(id).textContent = value; }
    function showText(id, value) {
      set(id, value || '');
      el(id).hidden = !value;
    }
    function weightHeadline(id, value, formatter = amount, unitText = ' kg') {
      if (!Number.isFinite(value)) { set(id, unavailable); return; }
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = unitText;
      el(id).replaceChildren(formatter.format(value), unit);
    }
    function plural(value, singular) { return amount.format(value) + ' ' + singular + (value === 1 ? '' : 's'); }
    function changeWeek(date, offset) {
      const result = new Date(date + 'T12:00:00Z');
      result.setUTCDate(result.getUTCDate() + offset);
      return result.toISOString().slice(0, 10);
    }
    function dateLabel(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
      const date = new Date(value + 'T12:00:00Z');
      return Number.isFinite(date.getTime()) ? calendarDay.format(date) : '';
    }
    function weekRange(start, end) {
      return dateLabel(start) + ' – ' + dateLabel(end);
    }
    function cropsterProductionUrl(week) {
      const url = new URL('https://c-sar.cropster.com/apps/roast/production-report');
      url.searchParams.set('dateFrom', week.start);
      url.searchParams.set('dateTo', week.end);
      return url.href;
    }
    function cropsterInventoryUrl(week) {
      const url = new URL('https://c-sar.cropster.com/apps/lots/inventory-report/location');
      if (!week.isCurrent) url.searchParams.set('reportDates', JSON.stringify([null, week.end]));
      return url.href;
    }
    function formatTimestamp(value) {
      if (typeof value !== 'string' && typeof value !== 'number') return '';
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? dateTime.format(date) : '';
    }
    function comparison(percent, subject = '') {
      if (!Number.isFinite(percent)) return '';
      const label = subject ? subject + ' ' : '';
      if (percent === 0) return label + 'unchanged';
      const absolute = Math.abs(percent);
      const digits = absolute < .1 ? 'under 0.1%' : amount.format(absolute) + '%';
      return label + (percent > 0 ? 'up ' : 'down ') + digits;
    }
    function renderComparison(id, text, fallback) {
      const host = el(id);
      if (!text) { host.textContent = fallback; return; }
      const when = document.createElement('span');
      when.className = 'context';
      when.textContent = ' vs previous week';
      host.replaceChildren(text, when);
    }
    function sourceText(metric, fallback) {
      const label = sourceNames[metric.source] || metric.source || fallback;
      const timestamp = formatTimestamp(metric.asOf);
      if (label === 'Cropster' && timestamp) return 'Saved Cropster reading captured ' + timestamp + ' Sydney time.';
      return timestamp ? label + ' updated ' + timestamp + ' Sydney time.' : 'Source: ' + label + '.';
    }
    function cropsterRefreshText(report) {
      const policy = report.cropsterRefresh || {};
      const historical = policy.mode === 'friday-archive' || report.week?.isCurrent === false;
      if (historical) return 'Cropster: saved Friday archive.';
      const captured = formatTimestamp(policy.productionAsOf || report.metrics?.production?.asOf);
      if (sourceSyncIsRunning(report)) return sourceSyncProgressText({ phase: policy.phase }) + (captured ? ' · last captured ' + captured + ' Sydney time.' : ' · saved readings shown.');
      if (policy.mode !== 'website-reader') return 'Cropster: saved readings · automatic sync not connected.';
      if (policy.status === 'failed') return captured
        ? 'Cropster could not update · previous reading shown, captured ' + captured + ' Sydney time.'
        : 'Cropster could not update · no saved production reading.';
      return captured ? 'Cropster website · captured ' + captured + ' Sydney time.' : 'Cropster website · capture unavailable.';
    }
    function cropsterRefreshResultText(report) {
      const policy = report.cropsterRefresh || {};
      if (policy.mode === 'friday-archive' || report.week?.isCurrent === false) return 'Saved Friday Cropster archive reloaded.';
      if (policy.mode === 'website-reader' && policy.fetched === true && policy.status === 'refreshed') return policy.greenFetched === false
        ? 'Cropster production updated. Green stock was not updated.' : 'Cropster updated from website.';
      if (policy.mode === 'website-reader' && policy.status === 'failed') return formatTimestamp(policy.productionAsOf || report.metrics?.production?.asOf)
        ? 'Cropster could not update. Previous reading retained.' : 'Cropster could not update. No saved production reading is available.';
      return 'Cropster was not fetched again.';
    }
    function cropsterRefreshLoadingText(policy) {
      return policy?.mode === 'website-reader' ? 'Checking Cropster background update…' : 'Refreshing weekly figures…';
    }
    const sourceSyncStorageKey = 'bmc-dashboard-cropster-source-job-v1';
    let pendingSourceSync = null;
    let sourceSyncPollTimer = null, sourceSyncPollDelay = 10000, latestSourceSyncPhase = null;
    function validSourceSyncWeek(value) {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value &&
        new Date(value + 'T00:00:00Z').getUTCDay() === 1;
    }
    function validSourceSyncJob(value) {
      return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    }
    function currentSourceSyncWeek() {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date()).map(part => [part.type, part.value]));
      const day = new Date(parts.year + '-' + parts.month + '-' + parts.day + 'T00:00:00Z');
      day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
      return day.toISOString().slice(0, 10);
    }
    function clearPendingSourceSync(jobId) {
      if (jobId && readPendingSourceSync()?.jobId !== jobId) return;
      pendingSourceSync = null;
      latestSourceSyncPhase = null;
      clearTimeout(sourceSyncPollTimer);
      sourceSyncPollTimer = null;
      try { sessionStorage.removeItem(sourceSyncStorageKey); } catch {}
    }
    function readPendingSourceSync() {
      let candidate = pendingSourceSync;
      try {
        const raw = sessionStorage.getItem(sourceSyncStorageKey);
        if (raw !== null) { candidate = null; if (raw.length <= 250) candidate = JSON.parse(raw); }
      } catch {}
      const age = Date.now() - candidate?.startedAt;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
          Object.keys(candidate).length !== 3 || !validSourceSyncJob(candidate.jobId) || !validSourceSyncWeek(candidate.weekStart) ||
          !Number.isSafeInteger(candidate.startedAt) || candidate.startedAt < 0 || age < 0 || age >= 2100000) {
        pendingSourceSync = null;
        try { sessionStorage.removeItem(sourceSyncStorageKey); } catch {}
        return null;
      }
      pendingSourceSync = { jobId: candidate.jobId, weekStart: candidate.weekStart, startedAt: candidate.startedAt };
      return pendingSourceSync;
    }
    function pendingSourceSyncForWeek(weekStart) {
      const pending = readPendingSourceSync();
      const currentWeek = currentSourceSyncWeek();
      const targetWeek = weekStart || currentWeek;
      return targetWeek === currentWeek && pending?.weekStart === targetWeek ? pending : null;
    }
    function storePendingSourceSync(jobId, weekStart) {
      const previous = readPendingSourceSync();
      pendingSourceSync = { jobId, weekStart, startedAt: previous?.jobId === jobId ? previous.startedAt : Date.now() };
      try { sessionStorage.setItem(sourceSyncStorageKey, JSON.stringify(pendingSourceSync)); } catch {}
      return pendingSourceSync;
    }
    function sourceSyncIsRunning(report) {
      if (report?.week?.isCurrent === false || report?.cropsterRefresh?.mode === 'friday-archive') return false;
      return report?.cropsterRefresh?.status === 'pending' || Boolean(pendingSourceSyncForWeek(report?.week?.start));
    }
    async function coordinateSourceSync(weekStart, signal, onProgress, { fresh = true } = {}) {
      if (signal.aborted) throw new DOMException('Source update stopped.', 'AbortError');
      const pending = pendingSourceSyncForWeek(weekStart);
      if (weekStart && weekStart !== currentSourceSyncWeek()) return null;
      const polling = Boolean(pending && !fresh);
      const unavailable = () => {
        const retained = pendingSourceSyncForWeek(weekStart);
        return { ...(retained || {}), status: retained ? 'running' : 'unavailable',
          weekStart: retained?.weekStart || weekStart || currentSourceSyncWeek(), checkUnavailable: true };
      };
      const options = { cache: 'no-store', credentials: 'same-origin', signal };
      const query = polling ? '?' + new URLSearchParams({ jobId: pending.jobId, week: pending.weekStart }) : '';
      let response;
      try {
        response = await fetch('/api/source-sync' + query, !polling ? {
          ...options, method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: fresh ? 'manual' : 'auto', ...(weekStart ? { weekStart } : {}) }),
        } : options);
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError' || error?.status === 401) throw error;
        return unavailable();
      }
      if (signal.aborted) throw new DOMException('Source update stopped.', 'AbortError');
      if (response.status === 401) {
        const error = new Error('Your session has ended. Sign in again.');
        error.status = 401;
        throw error;
      }
      if ([408, 429].includes(response.status) || response.status >= 500 && response.status <= 599) return unavailable();
      const state = await readJson(response);
      if (signal.aborted) throw new DOMException('Source update stopped.', 'AbortError');
      if (!response.ok) throw new Error(state.error || 'The source update could not be checked.');
      const expectedWeek = polling ? pending.weekStart : weekStart || currentSourceSyncWeek();
      const allowed = polling ? ['running', 'complete', 'failed'] : ['running', 'complete', 'not-connected', 'archive', 'failed'];
      if (!allowed.includes(state.status) || !validSourceSyncWeek(state.weekStart) ||
          expectedWeek && state.weekStart !== expectedWeek || polling && state.jobId !== undefined && state.jobId !== pending.jobId) {
        throw new Error('The source update returned an unexpected reporting week or job.');
      }
      const jobId = state.jobId ?? (polling ? pending.jobId : undefined);
      if (jobId !== undefined && !validSourceSyncJob(jobId)) throw new Error('The source update returned an invalid job reference.');
      const phases = ['warming', 'starting', 'reading', 'complete', 'failed', 'saved', 'outside-hours'];
      const phase = phases.includes(state.phase) ? state.phase : null;
      const safeCode = typeof state.safeCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(state.safeCode) ? state.safeCode : null;
      const retryAfterMs = Number.isFinite(state.retryAfterMs) ? Math.min(15000, Math.max(5000, state.retryAfterMs)) : 10000;
      latestSourceSyncPhase = phase;
      sourceSyncPollDelay = retryAfterMs;
      const details = { phase, safeCode, retryAfterMs };
      if (state.status === 'running') {
        if (!jobId) throw new Error('The source update returned an invalid job reference.');
        const saved = storePendingSourceSync(jobId, state.weekStart);
        onProgress(sourceSyncProgressText(details));
        return { ...saved, ...details, status: 'running', note: state.note };
      }
      if (state.weekStart === readPendingSourceSync()?.weekStart) clearPendingSourceSync();
      return { ...details, status: state.status, weekStart: state.weekStart, ...(jobId ? { jobId } : {}), note: state.note };
    }
    function sourceSyncProgressText(sync = {}) {
      const phase = sync.phase || latestSourceSyncPhase;
      if (phase === 'warming') return 'Waking Cropster connection in background';
      if (phase === 'starting') return 'Starting Cropster website update in background';
      return 'Cropster updating in background';
    }
    function scheduleSourceSyncPoll(reload, weekStart) {
      clearTimeout(sourceSyncPollTimer);
      sourceSyncPollTimer = null;
      if (!pendingSourceSyncForWeek(weekStart)) return;
      sourceSyncPollTimer = setTimeout(() => {
        sourceSyncPollTimer = null;
        if (!document.hidden) reload();
      }, sourceSyncPollDelay);
    }
    function sourceSyncResultText(report, cropsterReport = report, sync) {
      if (sync?.checkUnavailable) return 'Cropster update status could not be checked. Other sources were rechecked.';
      if (sync?.status === 'running' || sourceSyncIsRunning(cropsterReport)) return sourceSyncProgressText(sync) + '. Other sources were rechecked.';
      if (sync?.phase === 'saved' || sync?.phase === 'outside-hours') return (sync.note || 'Saved Cropster readings retain their capture times.') + ' Other sources were rechecked.';
      const summary = report?.sourceSync || report?.weekly?.sourceSync;
      if (sync?.status === 'failed' && !sync.jobId) return 'Cropster could not update. Previous readings are shown. Other sources were rechecked.';
      if (summary && ['complete', 'partial'].includes(summary.status) && typeof summary.message === 'string' && summary.message.trim()) return summary.message;
      return cropsterRefreshResultText(cropsterReport);
    }
    function statusText(metric, unavailableLabel) {
      if (metric.status === 'unavailable') return unavailableLabel;
      if (metric.stale) return 'Cropster reading is over 24 hours old';
      if (metric.status === 'stale') return 'Last saved data';
      if (metric.status === 'partial') return 'Partial data';
      if (metric.status === 'estimated') return 'Estimated';
      return '';
    }
    function renderDemand(demand, week, previousRange) {
      weightHeadline('demandKg', demand.kg, detailKg);
      const change = comparison(demand.changePercent);
      let fallback = 'Previous week’s demand unavailable';
      if (!Number.isFinite(demand.kg)) fallback = 'Demand comparison unavailable';
      else if (demand.previousKg === 0) fallback = 'Previous week had zero demand';
      renderComparison('demandChange', change && change[0].toUpperCase() + change.slice(1), fallback);
      renderCarryForward(demand, week);
      const waiting = !Number.isFinite(demand.kg) && /The dated ROAST TALLY for this week is missing from the shared folder\./.test(demand.note || '');
      showText('demandFlag', waiting ? 'Awaiting this week’s roast tally' : statusText(demand, 'Demand unavailable'));
      set('demandCurrentLabel', week.isCurrent ? 'This week' : 'Selected week');
      set('demandPreviousLabel', 'Previous week (' + previousRange + ')');
      set('demandDetail', weight(demand.kg, detailKg));
      set('demandPrevious', weight(demand.previousKg, detailKg));
      showText('demandSource', sourceText(demand, 'Weekly roast tally · 3. Roast Planning!C18'));
      showText('demandNote', demand.note || (!change && demand.previousKg === 0 ? 'Percentage change is unavailable when the previous week is zero.' : ''));
    }
    function renderCarryForward(demand, week) {
      const hasCarryForward = Number.isFinite(demand.carryForwardKg);
      const show = week.isCurrent || hasCarryForward;
      const caption = hasCarryForward ? 'Carry-forward from last week · ' + weight(demand.carryForwardKg, detailKg) : 'Carry-forward unavailable';
      showText('demandCarryForward', show ? caption : '');
      el('demandCarryDetail').hidden = !show;
      set('demandBrownOnHand', weight(demand.brownOnHandKg, detailKg));
      set('demandMondayDate', 'Monday roasted (' + calendarDay.format(new Date(week.start + 'T12:00:00Z')) + ')');
      set('demandMondayRoast', weight(demand.mondayRoastedKg, detailKg));
      showText('demandCarryNote', demand.carryForwardNote || 'Roasted coffee on hand from the weekly tally less Monday’s actual roasted output in Cropster.');
    }
    function scheduledBatchValues(production) {
      return Number.isFinite(production?.scheduledGreenKg) && production.scheduledGreenKg >= 0 &&
        Number.isSafeInteger(production?.scheduledBatchCount) && production.scheduledBatchCount >= 0 &&
        (production.scheduledGreenKg === 0) === (production.scheduledBatchCount === 0)
        ? {greenKg: production.scheduledGreenKg, batches: production.scheduledBatchCount} : null;
    }
    function renderProduction(production, week, previousRange, report = {}, sync) {
      const historical = !week.isCurrent;
      const hasTotal = !historical && Number.isFinite(production.totalKg);
      const hasRoasted = Number.isFinite(production.roastedKg);
      const value = historical ? production.roastedValue : production.value;
      set('productionCardTitle', historical ? 'Roasted Monday to Friday' : 'Roasted & scheduled');
      set('productionKg', hasTotal ? weight(production.totalKg, detailKg) : 'Unavailable');
      el('expectedOutputRow').hidden = historical;
      set('productionValue', Number.isFinite(value) ? (historical ? format(value, detailCurrency) : money(value)) : '$ unavailable');
      set('productionTotalLabel', 'Expected roasted output this week');
      set('productionCostLabel', historical ? 'Green cost · roasted' : 'Green cost · roasted + scheduled estimate');
      el('productionPair').hidden = false;
      el('productionPair').classList.toggle('single', historical);
      el('scheduledPrimary').hidden = historical;
      weightHeadline('roastedKg', production.roastedKg);
      const scheduled = scheduledBatchValues(production);
      weightHeadline('scheduledKg', scheduled?.greenKg, amount, ' kg green');
      showText('scheduledBatchCount', scheduled ? amount.format(scheduled.batches) + (scheduled.batches === 1 ? ' pending batch' : ' pending batches') : 'Scheduled batch data unavailable');
      set('scheduledGreenDetailKg', weight(scheduled?.greenKg, detailKg));
      set('scheduledBatchDetailCount', format(scheduled?.batches, amount));
      el('scheduledGreenRow').hidden = historical;
      el('scheduledBatchRow').hidden = historical;
      el('scheduledSourceNote').hidden = historical;
      el('cropsterScheduleLink').hidden = historical;
      const weightChange = comparison(production.roastedChangePercent, 'Roasted kg');
      const valueChange = comparison(production.valueChangePercent, 'value');
      const fallback = hasTotal || hasRoasted ? 'Previous week comparison unavailable' : 'Production comparison unavailable';
      renderComparison('productionChange', [weightChange, valueChange].filter(Boolean).join(' · '), fallback);
      const productionFlag = historical ? (hasRoasted ? 'Friday archive' : 'Friday Cropster figures unavailable')
        : production.status === 'partial' && !production.stale && hasRoasted && scheduled
          && [production.scheduledKg, production.roastedValue, production.scheduledValue].some(value => !Number.isFinite(value))
          ? 'Optional output estimate or green cost incomplete'
          : statusText(production, 'Cropster reading needed') || 'Saved Cropster reading';
      showText('productionFlag', productionFlag);
      renderProductionCapture(production, week, report, sync);
      set('roastedDetailKg', weight(production.roastedKg, detailKg));
      set('scheduledDetailKg', Number.isFinite(production.scheduledKg) ? weight(production.scheduledKg, detailKg) : 'Unavailable');
      set('roastedValue', format(production.roastedValue, detailCurrency));
      set('scheduledValue', format(production.scheduledValue, detailCurrency));
      el('scheduledDetailRow').hidden = historical;
      el('scheduledValueRow').hidden = historical;
      el('productionDetails').hidden = historical ? ![production.roastedKg, production.roastedValue].some(Number.isFinite) : ![production.roastedKg, production.scheduledKg, production.roastedValue, production.scheduledValue].some(Number.isFinite);
      el('cropsterProductionLink').href = cropsterProductionUrl(week);
      set('productionPreviousLabel', 'Previous week (' + previousRange + ')');
      set('previousProductionKg', weight(production.previousKg, detailKg));
      el('previousCombinedRow').hidden = historical;
      set('previousProductionValueLabel', historical ? 'Roasted green cost' : 'Production value');
      set('previousProductionValue', format(historical ? production.previousRoastedValue : production.previousValue, detailCurrency));
      set('previousRoastedKg', weight(production.previousRoastedKg, detailKg));
      set('previousScheduledKg', weight(production.previousScheduledKg, detailKg));
      el('previousScheduledRow').hidden = historical || !Number.isFinite(production.previousScheduledKg);
      const notes = [];
      if (!Number.isFinite(value)) notes.push('Green cost is unavailable.');
      if (!historical && !Number.isFinite(production.scheduledKg)) notes.push('The optional remaining roasted-output estimate is unavailable.' + (scheduled ? ' Verified scheduled green kilograms are shown separately.' : ' Scheduled batch data is also unavailable.'));
      if (weightChange) notes.push('The percentage compares recorded roast output between weeks.');
      showText('productionComparisonNote', notes.join(' '));
      showText('productionSource', sourceText(production, 'Cropster'));
      showText('productionNote', production.note);
    }
    function renderProductionCapture(production, week, report = {}, sync) {
      const captured = formatTimestamp(production.asOf);
      const stamp = captured ? 'Captured ' + captured + ' Sydney time' : 'Capture time unavailable';
      const refresh = report.cropsterRefresh || {};
      const productionSource = report.sourceSync?.sources?.find(source => source.id === 'production');
      let state = 'saved', message = stamp;
      if (!week.isCurrent) message = 'Friday archive · ' + stamp;
      else if (sync?.checkUnavailable) { state = 'unknown'; message = 'Cropster update could not be checked · ' + stamp; }
      else if (sync?.status === 'failed' || refresh.status === 'failed' && refresh.fetched !== true || productionSource?.status === 'failed') {
        state = 'failed'; message = 'Cropster update failed · ' + (captured ? 'previous reading shown · ' + stamp : 'no saved production reading available');
      } else if (sync?.status === 'running' || refresh.status === 'pending' || report.sourceSync?.jobStatus === 'running') {
        state = 'pending'; message = sourceSyncProgressText(sync || refresh) + ' · ' + stamp;
      }
      showText('productionCapture', message);
      el('productionCapture').dataset.state = state;
    }
    function renderGreen(green, week) {
      const isMarrickville = green.location === 'Marrickville';
      const historical = !week.isCurrent;
      const hasFriday = historical && green.snapshotDate === week.end && Number.isFinite(green.kg);
      const show = isMarrickville && (!historical || hasFriday);
      const kg = show ? green.kg : null;
      const value = show ? green.value : null;
      weightHeadline('greenKg', kg, detailKg);
      set('greenValue', Number.isFinite(value) ? format(value, detailCurrency) : '$ unavailable');
      const currentFlag = isMarrickville ? statusText(green, 'Cropster reading needed') || 'Cropster snapshot' : 'Marrickville reading needed';
      const flag = historical ? (show ? 'As of Fri ' + dateLabel(green.snapshotDate) : 'Friday snapshot unavailable') : currentFlag;
      showText('greenFlag', flag);
      set('greenWeightLabel', historical ? 'Friday closing weight' : 'Current weight');
      set('greenDetailKg', weight(kg, detailKg));
      set('greenDetailValue', format(value, detailCurrency));
      el('greenDetails').hidden = ![kg, value].some(Number.isFinite);
      set('greenUnpriced', format(green.unpricedLots, amount));
      el('greenBreakdown').hidden = !show || !(green.unpricedLots > 0);
      showText('greenSource', historical && !show ? 'Source: Cropster Green Inventory Report.' : sourceText(green, 'Cropster'));
      showText('greenNote', green.note);
      el('greenInventoryLink').href = cropsterInventoryUrl(week);
    }
    function renderStock(stock, week) {
      const historical = !week.isCurrent;
      const show = !historical || stock.snapshotDate === week.end;
      const partial = stock.status === 'partial' && Number.isFinite(stock.value);
      set('stockCardTitle', historical ? 'Friday non-coffee stock' : 'Current non-coffee stock');
      set('stockValue', format(show ? stock.value : null, detailCurrency));
      showText('stockItems', show && Number.isFinite(stock.itemCount) ? plural(stock.itemCount, 'stock item') : '');
      const estimateLabel = partial ? 'partial estimate at current prices' : 'estimated at current prices';
      const fridayFlag = show && Number.isFinite(stock.value) ? 'Fri ' + dateLabel(stock.snapshotDate) + ' · ' + estimateLabel : 'Friday stock value unavailable';
      showText('stockFlag', historical ? fridayFlag : partial ? 'Known-price subtotal' : statusText(stock, 'Stock value unavailable'));
      set('stockCategoryTitle', partial ? 'Known prices by category' : 'Value by category');
      const categories = show && Array.isArray(stock.categories) ? stock.categories : [];
      const rows = categories.map(category => {
        const row = document.createElement('tr');
        const name = document.createElement('th');
        name.scope = 'row';
        name.textContent = category.name;
        const value = document.createElement('td');
        value.textContent = format(category.value, detailCurrency);
        row.append(name, value);
        return row;
      });
      el('stockCategories').replaceChildren(...rows);
      el('stockBreakdown').hidden = !rows.length;
      const latestCount = formatTimestamp(stock.asOf);
      const currentSource = latestCount ? 'Stock Take App · latest saved count ' + latestCount + ' Sydney time.' : 'Source: Stock Take App.';
      const archivedSource = show ? 'Friday closing quantities from Stock Take App, valued using current prices.' : 'Source: Stock Take App Friday close history.';
      showText('stockSource', historical ? archivedSource : currentSource);
      showText('stockNote', stock.note || (!rows.length ? 'Category values are unavailable.' : ''));
    }
    function renderWholesale(wholesale, week) {
      const provisional = wholesale.provisional === true;
      set('wholesaleTotal', format(provisional ? wholesale.scheduledOrders : wholesale.orders, amount));
      set('wholesaleDone', format(wholesale.done, amount));
      set('wholesalePending', format(provisional ? wholesale.scheduledPendingOrders : wholesale.pending, amount));
      const inherited = wholesale.planStatus === 'inherited-plan' || /^Confirm this week’s order import in Dispatch\./i.test(wholesale.note || '');
      showText('wholesaleFlag', provisional ? 'Provisional · import unconfirmed' : inherited ? 'Order import unconfirmed' : statusText(wholesale, 'Dispatch totals unavailable'));
      set('wholesaleScheduleLabel', 'Scheduled orders · ' + weekRange(week.start, week.end));
      const previousStart = changeWeek(week.start, -7);
      const dispatchPreviousRange = weekRange(previousStart, changeWeek(previousStart, 4));
      set('wholesalePreviousLabel', 'Previous week (' + dispatchPreviousRange + ')');
      set('previousWholesaleTotal', format(wholesale.previousOrders, amount));
      set('previousWholesaleDone', format(wholesale.previousDone, amount));
      set('previousWholesalePending', format(wholesale.previousPending, amount));
      showText('wholesaleSource', sourceText(wholesale, 'Dispatch'));
      showText('wholesaleNote', wholesale.note);
      const clientCount = wholesale.completedClientsStatus !== 'unavailable' && Number.isSafeInteger(wholesale.completedClientCount) && wholesale.completedClientCount >= 0
        ? wholesale.completedClientCount : null;
      set('wholesaleClients', format(clientCount, amount) + ' clients completed');
      showText('wholesaleClientsFlag', dispatchPollFailed ? 'Dispatch check failed · showing last read'
        : clientCount === null ? 'Completed clients unavailable' : wholesale.completedClientsStatus === 'partial' ? 'Partial completed-client coverage' : '');
      set('completedClientsScope', 'Full delivery handovers completed ' + weekRange(week.start, week.end) + '. A client may still have other pending orders.');
      const clients = clientCount === null ? [] : (Array.isArray(wholesale.completedClients) ? [...wholesale.completedClients] : []).sort((a, b) => (Date.parse(b.completedAt) || 0) - (Date.parse(a.completedAt) || 0));
      el('completedClientsRows').replaceChildren(...clients.map(client => {
        const row = document.createElement('tr');
        const name = document.createElement('th');
        name.scope = 'row'; name.textContent = client.name || 'Client name unavailable';
        const time = document.createElement('td');
        time.textContent = formatTimestamp(client.completedAt) || unavailable;
        row.append(name, time); return row;
      }));
      el('completedClientsTable').hidden = !clients.length;
      set('completedClientsEmpty', clientCount === null ? 'Completed-client data is unavailable.'
        : clientCount === 0 ? 'No clients have completed deliveries in this period.' : !clients.length ? 'Completed-client names are unavailable.' : '');
      showText('completedClientsSource', sourceText(wholesale, 'Dispatch') + ' Checked every 15 seconds while this page is visible. Times are Sydney time.');
      const clientNotes = [wholesale.completedClientsNote, wholesale.completedClientsTruncated && 'Showing the most recent completed clients.'].filter(Boolean);
      showText('completedClientsNote', clientNotes.join(' '));
    }
    function stopDispatchPoll() {
      dispatchGeneration++;
      dispatchRequest?.abort();
      dispatchRequest = null;
    }
    async function pollDispatch() {
      if (!signedIn || document.hidden || currentRequest || dispatchRequest || !loadedWeek || !loadedWholesale) return;
      const weekStart = loadedWeek.start, generation = dispatchGeneration;
      const controller = new AbortController();
      dispatchRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/dispatch-status?week=' + encodeURIComponent(weekStart), { cache: 'no-store', signal: controller.signal });
        const result = await readJson(response);
        if (dispatchRequest !== controller || generation !== dispatchGeneration || !signedIn || currentRequest || loadedWeek?.start !== weekStart) return;
        if (response.status === 401) { showExpiredSession(); return; }
        if (!response.ok || result.weekStart !== weekStart || !result.wholesale) throw new Error('Dispatch could not be checked.');
        loadedWholesale = { ...loadedWholesale, ...result.wholesale };
        dispatchPollFailed = false;
        renderWholesale(loadedWholesale, loadedWeek);
      } catch {
        if (dispatchRequest === controller && generation === dispatchGeneration && signedIn && loadedWeek?.start === weekStart) {
          dispatchPollFailed = true;
          renderWholesale(loadedWholesale, loadedWeek);
        }
      } finally {
        clearTimeout(timeout);
        if (dispatchRequest === controller) dispatchRequest = null;
      }
    }
    function expenseMoney(value, expenses) {
      if (!Number.isFinite(value)) return unavailable;
      return expenses.currency === 'AUD' ? detailCurrency.format(value) : '$' + expenseAmount.format(value);
    }
    function renderGreenForecast(forecast = {}) {
      const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
      const currentMonth = parts.find(part => part.type === 'year').value + '-' + parts.find(part => part.type === 'month').value;
      const matchesMonth = forecast.month === currentMonth;
      const value = matchesMonth && forecast.status !== 'unavailable' ? forecast.value : null;
      const currentLabel = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', month: 'long', year: 'numeric' }).format(new Date());
      set('greenForecastMonth', matchesMonth && forecast.monthLabel ? forecast.monthLabel : currentLabel);
      set('greenForecastValue', expenseMoney(value, forecast));
      showText('greenForecastFlag', !Number.isFinite(value) ? 'Current month forecast unavailable'
        : forecast.status === 'partial' ? 'Partial estimate' : '');
      const timestamp = matchesMonth ? formatTimestamp(forecast.asOf) : '';
      const source = [matchesMonth && forecast.sourceCell, timestamp && 'Forecast checked ' + timestamp + ' Sydney time',
        Number.isFinite(value) && (forecast.currency === 'AUD' ? 'AUD estimate' : '$ as recorded')].filter(Boolean).join(' · ');
      showText('greenForecastSource', source);
      showText('greenForecastNote', matchesMonth ? forecast.note : 'A forecast is needed for the current month.');
      const url = sourceLink(forecast.sourceUrl);
      el('greenForecastLink').hidden = !url;
      if (url) el('greenForecastLink').href = url;
      else el('greenForecastLink').removeAttribute('href');
    }
    function renderExpenses(expenses = {}, week, { updateForecast = true } = {}) {
      const matchesWeek = expenses.weekStart === week.start;
      const value = matchesWeek && expenses.status !== 'unavailable' ? expenses.value : null;
      const overLimit = Number.isFinite(value) && value > 18900;
      set('expensesPeriod', week.isCurrent ? 'Week to date' : 'Week of ' + dateLabel(week.start));
      set('expensesValue', expenseMoney(value, expenses));
      el('expensesValue').classList.toggle('over-limit', overLimit);
      showText('expensesFlag', overLimit ? 'Over $18,900' : !Number.isFinite(value)
        ? expenses.note === 'No expenses have been entered for the selected week.' ? 'Not entered for this week' : 'Expenses unavailable' : '');
      el('expensesFlag').classList.toggle('over-limit', overLimit);
      set('expensesMonday', 'Monday · ' + dateLabel(week.start));
      set('expensesCurrency', expenses.currency === 'AUD' ? 'Amounts in AUD.' : 'Amounts use $ as recorded in the sheet.');
      const items = matchesWeek && Number.isFinite(value) && Array.isArray(expenses.items) ? expenses.items : [];
      el('expensesItems').replaceChildren(...items.map(item => {
        const row = document.createElement('tr');
        const name = document.createElement('th');
        name.scope = 'row';
        name.textContent = item.name;
        const amount = document.createElement('td');
        amount.textContent = expenseMoney(item.value, expenses);
        row.append(name, amount);
        return row;
      }));
      el('expensesBreakdown').hidden = !items.length;
      const timestamp = formatTimestamp(expenses.asOf);
      const freshness = expenses.status === 'stale' ? 'Saved reading may be out of date'
        : expenses.status === 'live' ? 'Sheet checked' : 'Saved reading';
      showText('expensesFreshness', matchesWeek && Number.isFinite(value)
        ? freshness + (timestamp ? ' · ' + timestamp + ' Sydney time' : '') : '');
      const reading = expenses.status === 'recorded' ? 'Verified reading captured' : expenses.status === 'live' ? 'Sheet checked' : 'Saved reading';
      const source = [expenses.sheetName, matchesWeek && expenses.sourceCell,
        timestamp && reading + ' ' + timestamp + ' Sydney time'].filter(Boolean).join(' · ');
      showText('expensesSource', source);
      showText('expensesNote', expenses.note || (!Number.isFinite(value) ? 'A verified expense total is needed for this Monday.' : ''));
      const url = sourceLink(expenses.sourceUrl);
      el('expensesSourceLink').hidden = !url;
      if (url) el('expensesSourceLink').href = url;
      else el('expensesSourceLink').removeAttribute('href');
      set('expensesCaptureWeek', 'Selected Monday · ' + dateLabel(week.start));
      if (updateForecast) renderGreenForecast(expenses.greenForecast);
    }
    function sourceLink(value) {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
      } catch { return null; }
    }
    function renderSources(sources) {
      const entries = sources.filter(source => source.label).map(source => {
        const entry = document.createElement('li');
        const url = sourceLink(source.url);
        const label = document.createElement(url ? 'a' : 'strong');
        if (url) {
          label.href = url;
          label.target = '_blank';
          label.rel = 'noopener noreferrer';
        }
        label.textContent = source.label;
        entry.append(label);
        const timestamp = formatTimestamp(source.asOf);
        if (timestamp) entry.append((source.label.startsWith('Cropster') ? ' captured ' : ' updated ') + timestamp + ' Sydney time.');
        if (source.note) entry.append(' ' + source.note);
        return entry;
      });
      el('sourceList').replaceChildren(...entries);
      el('sources').hidden = !entries.length;
    }
    function weekNoteState(weekStart) {
      if (!weekNotes.has(weekStart)) {
        weekNotes.set(weekStart, { saved: null, draft: null, baseRevision: 0, reading: null, saving: false, needsReload: false, error: false, message: '' });
      }
      return weekNotes.get(weekStart);
    }
    function validWeekNote(data, weekStart) {
      return data.weekStart === weekStart && Number.isSafeInteger(data.revision) && data.revision >= 0
        && Array.isArray(data.lines) && data.lines.every(line => typeof line === 'string');
    }
    function noteLines(text) { return text.split('\n').map(line => line.trim()).filter(Boolean); }
    function noteWasChanged(state) {
      return state.draft !== null && state.saved && noteLines(state.draft).join('\n') !== state.saved.lines.join('\n');
    }
    function noteNeedsReview(state) {
      return noteWasChanged(state) && state.baseRevision !== state.saved.revision;
    }
    function renderWeekNote(weekStart) {
      const state = weekNoteState(weekStart);
      const saved = state.saved;
      const lines = saved?.lines || [];
      const preview = lines.length ? lines[0] + (lines.length > 1 ? ' · +' + (lines.length - 1) + ' more' : '') : 'Add meeting points';
      set('weekNotePreview', saved ? preview : state.error ? 'Note unavailable' : 'Loading this week’s note…');
      el('weekNotePoints').replaceChildren(...lines.map(line => {
        const point = document.createElement('li');
        point.textContent = line;
        return point;
      }));
      el('weekNotePoints').hidden = !lines.length;
      const input = el('weekNoteInput');
      const text = state.draft ?? lines.join('\n');
      if (input.value !== text) input.value = text;
      input.disabled = !saved || state.saving;
      const needsReview = noteNeedsReview(state);
      el('weekNoteSave').disabled = !noteWasChanged(state) || state.saving || state.needsReload || needsReview;
      set('weekNoteSave', state.saving ? 'Saving…' : 'Save note');
      el('weekNoteReview').hidden = !needsReview || state.needsReload;
      el('weekNoteRetry').hidden = !state.error && !state.needsReload;
      el('weekNoteRetry').disabled = Boolean(state.reading) || state.saving;
      const message = needsReview && !state.needsReload ? 'The saved note changed. Review the saved points above, then choose whether to keep your draft.' : state.message;
      showText('weekNoteFeedback', message);
      el('weekNoteFeedback').classList.toggle('error', state.error || Boolean(needsReview));
      renderUiUpdate();
    }
    function clearWeekNotes() {
      for (const state of weekNotes.values()) state.reading?.abort();
      weekNotes.clear();
      el('weekNoteInput').value = '';
      el('weekNotePoints').replaceChildren();
      set('weekNotePreview', 'Loading this week’s note…');
      showText('weekNoteFeedback', '');
    }
    function noteIsActive(weekStart, state) { return signedIn && weekNotes.get(weekStart) === state; }
    async function loadWeekNote(weekStart, { fresh = false } = {}) {
      const state = weekNoteState(weekStart);
      if (!signedIn) return false;
      if (state.saving) return 'saving';
      if (state.reading && !fresh) return;
      state.reading?.abort();
      const controller = new AbortController();
      state.reading = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/weekly-note?week=' + encodeURIComponent(weekStart), { cache: 'no-store', signal: controller.signal });
        const data = await readJson(response);
        if (!noteIsActive(weekStart, state) || state.reading !== controller) return;
        if (response.status === 401) { showExpiredSession(); return; }
        if (!response.ok || !validWeekNote(data, weekStart)) throw new Error('The note could not be loaded.');
        if (!state.saved || data.revision >= state.saved.revision) state.saved = data;
        state.needsReload = false;
        if (state.error) state.message = '';
        state.error = false;
        return true;
      } catch (error) {
        if (!noteIsActive(weekStart, state) || state.reading !== controller) return;
        state.error = true;
        state.message = error.name === 'AbortError' ? 'Loading the note timed out. Try Refresh note.' : 'The note could not be loaded. Try Refresh note.';
        return false;
      } finally {
        clearTimeout(timeout);
        if (state.reading === controller) {
          state.reading = null;
          if (noteIsActive(weekStart, state) && loadedWeek?.start === weekStart) renderWeekNote(weekStart);
        }
      }
    }
    function showExpiredSession() {
      showSession(false);
      showText('loginMessage', 'Your session has ended. Sign in again.');
      el('password').focus();
    }
    function render(data, { fresh = false, sync } = {}) {
      const { week, metrics } = data;
      const previousStart = changeWeek(week.start, -7);
      const previousRange = weekRange(previousStart, changeWeek(previousStart, week.isCurrent ? 6 : 4));
      set('dates', (week.isCurrent ? 'This week · ' : 'Monday to Friday · ') + week.label);
      renderDemand(metrics.demand, week, previousRange);
      renderProduction(metrics.production, week, previousRange, data, sync);
      renderGreen(metrics.green, week);
      renderStock(metrics.stock, week);
      loadedWholesale = metrics.wholesale;
      dispatchPollFailed = false;
      renderWholesale(metrics.wholesale, week);
      renderExpenses(metrics.expenses, week);
      renderSources(data.sources);
      if (loadedWeek?.start !== week.start) {
        el('fridayCaptureForm').reset();
        showText('fridayCaptureMessage', '');
      }
      loadedWeek = week;
      loadedCropsterRefresh = data.cropsterRefresh || null;
      renderWeekNote(week.start);
      const noteRequest = loadWeekNote(week.start, { fresh });
      el('capture').hidden = !week.isCurrent;
      el('greenCapture').hidden = false;
      el('fridayCapture').hidden = week.isCurrent;
      set('fridayCaptureTitle', 'Friday close · ' + dateLabel(week.end));
      el('fridayProductionLink').href = cropsterProductionUrl(week);
      el('fridayGreenLink').href = cropsterInventoryUrl(week);
      el('figures').hidden = false;
      el('currentWeek').hidden = week.isCurrent;
      el('refreshPolicy').hidden = false;
      set('refreshPolicy', cropsterRefreshText(data));
      const checked = formatTimestamp(data.generatedAt);
      set('status', checked ? 'Dashboard checked ' + checked + ' Sydney time' : 'Saved dashboard figures loaded');
      el('status').classList.remove('error');
      return noteRequest;
    }
    function setWeekQuery(week) {
      const url = new URL(location.href);
      if (week) url.searchParams.set('week', week);
      else url.searchParams.delete('week');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    function showSession(active) {
      signedIn = active;
      el('loading').hidden = true;
      el('report').hidden = !active;
      el('actions').hidden = !active;
      el('login').hidden = active;
      if (active) return;
      availableUiBuild = null;
      el('uiUpdate').hidden = true;
      clearPendingSourceSync();
      stopDispatchPoll();
      loadedWholesale = null;
      dispatchPollFailed = false;
      expensesCaptureGeneration++;
      currentRequest?.abort();
      currentRequest = null;
      el('refresh').disabled = false;
      set('refresh', 'Refresh');
      el('report').setAttribute('aria-busy', 'false');
      el('figures').hidden = true;
      el('sources').hidden = true;
      el('capture').hidden = true;
      el('capture').open = false;
      el('captureForm').reset();
      showText('captureMessage', '');
      el('mondayCaptureForm').reset();
      showText('mondayCaptureMessage', '');
      el('greenCapture').hidden = true;
      el('greenCapture').open = false;
      el('greenCaptureForm').reset();
      showText('greenCaptureMessage', '');
      el('fridayCapture').hidden = true;
      el('fridayCapture').open = false;
      el('fridayCaptureForm').reset();
      showText('fridayCaptureMessage', '');
      el('expensesCapture').open = false;
      el('expensesCaptureForm').reset();
      showText('expensesCaptureMessage', '');
      el('expensesCaptureSave').disabled = false;
      el('expensesCaptureSave').textContent = 'Save verified reading';
      clearWeekNotes();
      el('sourceList').replaceChildren();
      el('stockCategories').replaceChildren();
      el('completedClientsRows').replaceChildren();
      el('expensesItems').replaceChildren();
      el('expensesSourceLink').removeAttribute('href');
      el('greenForecastLink').removeAttribute('href');
      el('greenForecastLink').hidden = true;
      set('greenForecastMonth', '');
      el('figures').querySelectorAll('[id]').forEach(node => {
        if (node.matches('.metric-figure, .metric-secondary, dd')) node.textContent = unavailable;
        if (node.matches('.comparison, .source-note, .detail-note, .status-flag, .carry-forward, .expense-freshness')) node.textContent = '';
      });
      el('figures').querySelectorAll('details').forEach(card => { card.open = false; });
      el('sources').open = false;
      loadedWeek = undefined;
      loadedCropsterRefresh = null;
    }
    async function readJson(response) { return response.json().catch(() => ({})); }
    const uiResumeKey = 'bmc-dashboard-ui-refresh-v1';
    let availableUiBuild = null, checkingUiBuild = false;
    function hasUnsavedDashboardEdits() {
      if ([...weekNotes.values()].some(state => state.saving || noteWasChanged(state))) return true;
      return ['captureForm', 'mondayCaptureForm', 'greenCaptureForm', 'fridayCaptureForm', 'expensesCaptureForm'].some(id =>
        [...el(id).querySelectorAll('input, textarea')].some(input => input.value.trim() !== ''));
    }
    function renderUiUpdate() {
      const dirty = hasUnsavedDashboardEdits();
      el('uiUpdate').hidden = !availableUiBuild;
      el('uiReload').disabled = dirty;
      if (availableUiBuild) set('uiUpdateText', dirty
        ? 'A dashboard update is ready. Save your notes and entered readings before reloading. Your drafts are still here.'
        : 'A dashboard update is ready. Reload to use the latest view.');
    }
    function reloadUpdatedDashboard() {
      if (!availableUiBuild || hasUnsavedDashboardEdits()) { renderUiUpdate(); return false; }
      try { sessionStorage.setItem(uiResumeKey, JSON.stringify({buildId: availableUiBuild, at: Date.now()})); } catch {}
      location.reload();
      return true;
    }
    function consumeUiRefreshIntent() {
      try {
        const raw = sessionStorage.getItem(uiResumeKey);
        sessionStorage.removeItem(uiResumeKey);
        if (!raw) return false;
        const value = JSON.parse(raw);
        return value?.buildId === uiBuildId && Number.isFinite(value.at) && value.at <= Date.now() && Date.now() - value.at < 120000;
      } catch { return false; }
    }
    async function manualRefresh() {
      if (!signedIn || checkingUiBuild) return;
      checkingUiBuild = true;
      el('refresh').disabled = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        if (/^[a-f0-9]{64}$/.test(uiBuildId)) {
          const response = await fetch('/api/ui-build?view=steam-room', {cache: 'no-store', signal: controller.signal});
          const result = response.ok ? await readJson(response) : null;
          if (signedIn && /^[a-f0-9]{64}$/.test(result?.buildId) && result.buildId !== uiBuildId) {
            availableUiBuild = result.buildId;
            renderUiUpdate();
            if (!hasUnsavedDashboardEdits() && reloadUpdatedDashboard()) return;
          }
        }
      } catch {} finally {
        clearTimeout(timer);
        checkingUiBuild = false;
        if (!currentRequest) el('refresh').disabled = false;
      }
      if (signedIn) return load(true, {fresh: true});
    }
    async function load(announce = true, { fresh = false } = {}) {
      if (!signedIn) return;
      if (currentRequest && !fresh) return;
      stopDispatchPoll();
      currentRequest?.abort();
      const controller = new AbortController();
      controller.fresh = fresh;
      currentRequest = controller;
      const weekToLoad = requestedWeek;
      const timeout = setTimeout(() => controller.abort(), fresh || pendingSourceSyncForWeek(weekToLoad || undefined) ? 90000 : 30000);
      el('report').setAttribute('aria-busy', 'true');
      el('previous').disabled = true;
      el('next').disabled = true;
      el('currentWeek').disabled = true;
      el('refresh').disabled = true;
      set('refresh', fresh ? 'Refreshing…' : 'Refresh');
      if (!loadedWeek || (weekToLoad && weekToLoad !== loadedWeek.start) || (!weekToLoad && !loadedWeek.isCurrent)) {
        el('figures').hidden = true;
        el('sources').hidden = true;
      }
      if (announce || !loadedWeek) {
        set('status', fresh ? cropsterRefreshLoadingText(loadedCropsterRefresh) : 'Loading weekly figures…');
        el('status').classList.remove('error');
      }
      try {
        const sync = await coordinateSourceSync(weekToLoad || undefined, controller.signal, text => set('status', text + '…'), { fresh });
        if (currentRequest !== controller || !signedIn) return;
        const query = new URLSearchParams();
        if (weekToLoad) query.set('week', weekToLoad);
        if (fresh) query.set('refresh', '1');
        if (sync?.jobId) { query.set('sourceSyncJob', sync.jobId); query.set('sourceSyncWeek', sync.weekStart); }
        if (sync?.checkUnavailable) query.set('sourceSyncCheckUnavailable', '1');
        const response = await fetch('/api/weekly-report' + (query.size ? '?' + query : ''), { cache: 'no-store', signal: controller.signal });
        if (currentRequest !== controller) return;
        if (response.status === 401) {
          showSession(false);
          showText('loginMessage', 'Your session has ended. Sign in again.');
          el('password').focus();
          return;
        }
        const data = await readJson(response);
        if (currentRequest !== controller || !signedIn) return;
        if (!response.ok) throw new Error(data.error || 'The report could not be loaded.');
        const noteRequest = render(data, { fresh, sync });
        if (fresh || sync) {
          const noteChecked = await noteRequest;
          if (currentRequest !== controller || !signedIn) return;
          const checked = new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', second: '2-digit' });
          set('status', 'Dashboard rechecked ' + checked + ' Sydney time. ' +
            sourceSyncResultText(data, data, sync) +
            (noteChecked === false ? ' The meeting note could not be checked. Use Refresh note to try again.' : '') +
            (noteChecked === 'saving' ? ' The meeting note is still saving.' : ''));
        }
        if (weekToLoad && loadedWeek.isCurrent) requestedWeek = '';
        setWeekQuery(requestedWeek);
      } catch (error) {
        if (currentRequest !== controller || !signedIn) return;
        if (error.status === 401) {
          showSession(false);
          showText('loginMessage', 'Your session has ended. Sign in again.');
          el('password').focus();
          return;
        }
        const message = error.name === 'AbortError' ? 'The report took too long to load.' : error.message;
        set('status', loadedWeek ? message + ' Showing the last loaded figures.' : message + ' Select Refresh to try again.');
        el('status').classList.add('error');
        requestedWeek = loadedWeek && !loadedWeek.isCurrent ? loadedWeek.start : '';
        if (loadedWeek) el('figures').hidden = false;
      } finally {
        clearTimeout(timeout);
        if (currentRequest === controller) {
          el('report').setAttribute('aria-busy', 'false');
          el('previous').disabled = !loadedWeek;
          el('next').disabled = !loadedWeek || loadedWeek.isCurrent;
          el('currentWeek').disabled = false;
          el('refresh').disabled = false;
          set('refresh', 'Refresh');
          currentRequest = null;
          scheduleSourceSyncPoll(() => load(false), weekToLoad || undefined);
        }
      }
    }
    el('previous').addEventListener('click', () => {
      if (!loadedWeek) return;
      requestedWeek = changeWeek(loadedWeek.start, -7);
      load();
    });
    el('next').addEventListener('click', () => {
      if (!loadedWeek || loadedWeek.isCurrent) return;
      requestedWeek = changeWeek(loadedWeek.start, 7);
      load();
    });
    el('currentWeek').addEventListener('click', () => { requestedWeek = ''; load(); });
    el('refresh').addEventListener('click', manualRefresh);
    el('uiReload').addEventListener('click', reloadUpdatedDashboard);
    el('report').addEventListener('input', renderUiUpdate);
    el('weekNoteInput').addEventListener('input', event => {
      if (!loadedWeek) return;
      const weekStart = loadedWeek.start;
      const state = weekNoteState(weekStart);
      if (!state.saved || state.saving) return;
      if (!noteWasChanged(state)) state.baseRevision = state.saved.revision;
      state.draft = event.target.value;
      state.message = '';
      renderWeekNote(weekStart);
    });
    el('weekNoteReview').addEventListener('click', () => {
      if (!loadedWeek) return;
      const weekStart = loadedWeek.start;
      const state = weekNoteState(weekStart);
      if (!noteNeedsReview(state) || state.needsReload) return;
      state.baseRevision = state.saved.revision;
      state.message = 'Your draft is ready to save.';
      renderWeekNote(weekStart);
      el('weekNoteInput').focus();
    });
    el('weekNoteRetry').addEventListener('click', () => {
      if (loadedWeek) loadWeekNote(loadedWeek.start);
    });
    el('weekNoteForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!signedIn || !loadedWeek) return;
      const weekStart = loadedWeek.start;
      const state = weekNoteState(weekStart);
      if (!noteWasChanged(state) || state.saving || state.needsReload || noteNeedsReview(state)) return;
      const lines = noteLines(state.draft);
      if (lines.length > 10 || lines.some(line => line.length > 240)) {
        state.message = 'Use at most 10 points, each up to 240 characters.';
        renderWeekNote(weekStart);
        return;
      }
      state.saving = true;
      state.reading?.abort();
      state.reading = null;
      state.message = '';
      renderWeekNote(weekStart);
      try {
        const response = await fetch('/api/weekly-note?week=' + encodeURIComponent(weekStart), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines, expectedRevision: state.baseRevision }),
        });
        const data = await readJson(response);
        if (!noteIsActive(weekStart, state)) return;
        if (response.status === 401) { showExpiredSession(); return; }
        if (response.status === 409) {
          state.needsReload = true;
          state.message = 'The saved note may have changed. Refresh before saving your draft.';
          return;
        }
        if (!response.ok || !validWeekNote(data, weekStart)) throw new Error(data.error || 'The note could not be saved. Your draft is kept.');
        if (!state.saved || data.revision >= state.saved.revision) state.saved = data;
        state.draft = null;
        state.message = lines.length ? 'Note saved.' : 'Note cleared.';
      } catch (error) {
        if (noteIsActive(weekStart, state)) state.message = error.message;
      } finally {
        state.saving = false;
        if (noteIsActive(weekStart, state)) {
          if (loadedWeek?.start === weekStart) renderWeekNote(weekStart);
          if (state.needsReload) loadWeekNote(weekStart);
        }
      }
    });
    el('expensesCaptureForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = el('expensesCaptureSave');
      if (!signedIn || !loadedWeek || button.disabled) return;
      const weekStart = loadedWeek.start;
      let body;
      try {
        const reading = JSON.parse(el('expensesCaptureInput').value);
        if (!reading || typeof reading !== 'object' || Array.isArray(reading)) throw new Error('Paste a valid verified sheet reading.');
        if (reading.weekStart !== weekStart) throw new Error('The reading must match the selected Monday. Select its reporting week first.');
        body = JSON.stringify(reading);
        if (new TextEncoder().encode(body).length > 100000) throw new Error('The sheet reading is too large. Use the bounded expense grid.');
      } catch (error) {
        showText('expensesCaptureMessage', error instanceof SyntaxError ? 'Paste a valid verified sheet reading.' : error.message);
        return;
      }
      const generation = ++expensesCaptureGeneration;
      button.disabled = true;
      button.textContent = 'Saving…';
      showText('expensesCaptureMessage', '');
      try {
        const response = await fetch('/api/expenses/readings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
        const result = await readJson(response);
        if (!signedIn || generation !== expensesCaptureGeneration) return;
        if (response.status === 401) { showExpiredSession(); return; }
        if (!response.ok || !result.ok || !result.expenses) throw new Error(result.error || 'The verified reading could not be saved.');
        if (loadedWeek?.start === weekStart) {
          renderExpenses(result.expenses, loadedWeek, { updateForecast: false });
          el('expensesCaptureForm').reset();
          showText('expensesCaptureMessage', 'Verified sheet reading saved.');
          await load(false, { fresh: true });
        }
      } catch (error) {
        if (signedIn && generation === expensesCaptureGeneration) showText('expensesCaptureMessage', error.message);
      } finally {
        if (generation === expensesCaptureGeneration) {
          button.disabled = false;
          button.textContent = 'Save verified reading';
        }
      }
    });
    for (const [heading, fields] of captureGroups) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = heading;
      const grid = document.createElement('div');
      grid.className = 'capture-fields';
      for (const [name, caption, required] of fields) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.name = name;
        input.type = 'number';
        input.inputMode = 'decimal';
        input.min = '0';
        input.step = '.01';
        input.required = Boolean(required);
        label.append(caption, input);
        grid.append(label);
      }
      fieldset.append(legend, grid);
      el('captureFields').append(fieldset);
    }
    el('captureForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!signedIn || !loadedWeek?.isCurrent) return;
      const fields = Object.fromEntries([...new FormData(el('captureForm'))].map(([key, value]) => [key, value === '' ? null : Number(value)]));
      el('captureSave').disabled = true;
      showText('captureMessage', '');
      try {
        const response = await fetch('/api/cropster-readings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekStart: loadedWeek.start, ...fields }),
        });
        const result = await readJson(response);
        if (!response.ok || !result.ok) throw new Error(result.error || 'The readings could not be saved.');
        if (!signedIn) return;
        el('captureForm').reset();
        showText('captureMessage', 'Cropster readings saved.');
        await load(false);
      } catch (error) {
        showText('captureMessage', error.message);
      } finally {
        el('captureSave').disabled = false;
      }
    });
    el('mondayCaptureForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = el('mondayCaptureSave');
      if (!signedIn || !loadedWeek?.isCurrent || button.disabled) return;
      const raw = new FormData(form).get('roastedKg');
      const roastedKg = Number(raw);
      if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(roastedKg) || roastedKg < 0) return;
      button.disabled = true;
      showText('mondayCaptureMessage', '');
      try {
        const response = await fetch('/api/cropster-monday', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekStart: loadedWeek.start, roastedKg }),
        });
        if (!signedIn) return;
        if (response.status === 401) {
          showSession(false);
          showText('loginMessage', 'Your session has ended. Sign in again.');
          el('password').focus();
          return;
        }
        const result = await readJson(response);
        if (!response.ok || !result.ok) throw new Error(result.error || 'The Monday total could not be saved.');
        if (!signedIn) return;
        form.reset();
        showText('mondayCaptureMessage', 'Monday roast total saved.');
        await load(false);
      } catch (error) {
        if (signedIn) showText('mondayCaptureMessage', error.message);
      } finally {
        button.disabled = false;
      }
    });
    el('greenCaptureForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = el('greenCaptureSave');
      if (!signedIn || !loadedWeek || button.disabled || !form.reportValidity()) return;

      const fields = new FormData(form);
      const kg = Number(fields.get('kg'));
      const rawValue = fields.get('value');
      const value = rawValue === '' ? null : Number(rawValue);
      button.disabled = true;
      showText('greenCaptureMessage', '');
      try {
        const response = await fetch('/api/cropster-green-stock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kg, value }),
        });
        if (!signedIn) return;
        if (response.status === 401) {
          showSession(false);
          showText('loginMessage', 'Your session has ended. Sign in again.');
          el('password').focus();
          return;
        }
        const result = await readJson(response);
        if (!response.ok || !result.ok) throw new Error(result.error || 'The Marrickville stock reading could not be saved.');
        if (!signedIn) return;
        form.reset();
        showText('greenCaptureMessage', 'Marrickville green stock saved.');
        await load(false);
      } catch (error) {
        if (signedIn) showText('greenCaptureMessage', error.message);
      } finally {
        button.disabled = false;
      }
    });
    el('fridayCaptureForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = el('fridayCaptureSave');
      if (!signedIn || !loadedWeek || loadedWeek.isCurrent || button.disabled || !form.reportValidity()) return;

      const weekStart = loadedWeek.start;
      const payload = { weekStart };
      for (const [name, rawValue] of new FormData(form)) {
        if (rawValue !== '') payload[name] = Number(rawValue);
      }
      if (payload.roastedKg === undefined && payload.greenKg === undefined) {
        showText('fridayCaptureMessage', 'Enter the roast weight, the Marrickville stock weight, or both.');
        return;
      }
      if ((payload.roastedValue !== undefined && payload.roastedKg === undefined) || (payload.greenValue !== undefined && payload.greenKg === undefined)) {
        showText('fridayCaptureMessage', 'Enter the matching weight for each AUD figure.');
        return;
      }
      button.disabled = true;
      showText('fridayCaptureMessage', '');
      try {
        const response = await fetch('/api/cropster-friday', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!signedIn) return;
        if (response.status === 401) { showExpiredSession(); return; }
        const result = await readJson(response);
        if (!response.ok || !result.ok) throw new Error(result.error || 'The Friday figures could not be saved.');
        if (!signedIn || loadedWeek?.start !== weekStart) return;
        form.reset();
        showText('fridayCaptureMessage', 'Friday figures saved.');
        await load(false);
      } catch (error) {
        if (signedIn && loadedWeek?.start === weekStart) showText('fridayCaptureMessage', error.message);
      } finally {
        button.disabled = false;
      }
    });
    el('signInForm').addEventListener('submit', async event => {
      event.preventDefault();
      el('signIn').disabled = true;
      showText('loginMessage', '');
      try {
        const response = await fetch('/api/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: el('password').value }),
        });
        const data = await readJson(response);
        if (!response.ok || !data.authenticated) throw new Error(data.error || 'Sign-in could not be completed.');
        showSession(true);
        el('report').focus({ preventScroll: true });
        load();
      } catch (error) {
        showText('loginMessage', error.message);
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
        el('password').focus();
      } catch (error) {
        set('status', error.message);
        el('status').classList.add('error');
      } finally {
        el('logout').disabled = false;
      }
    });
    fetch('/api/auth', { cache: 'no-store' }).then(readJson).then(data => {
      showSession(data.authenticated === true);
      if (signedIn) load(true, {fresh: consumeUiRefreshIntent()});
    }).catch(() => showSession(false));
    document.addEventListener('visibilitychange', () => { if (signedIn && !document.hidden && !currentRequest) load(false); });
    setInterval(() => { if (signedIn && !document.hidden && !currentRequest) load(false); }, 60000);
    const dispatchTimer = setInterval(pollDispatch, 15000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopDispatchPoll(); });
    window.addEventListener('pagehide', () => { stopDispatchPoll(); clearInterval(dispatchTimer); });
  </script>
</body>
</html>`;
