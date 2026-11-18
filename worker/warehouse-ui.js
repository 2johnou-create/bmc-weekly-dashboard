export const warehousePage = String.raw`<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#eef3f3">
  <title>Warehouse | Black Market Coffee</title>
  <style>
    :root { color-scheme:light; --ink:#202624; --muted:#526059; --paper:#fff; --background:#f3f5f1; --line:#d6ddd6; --green:#263e35; --red:#a5282c; --sky:#edf3f4; --caution:#794b15; font:1rem/1.45 Inter,system-ui,sans-serif; color:var(--ink); background:var(--background); }
    * { box-sizing:border-box; }
    [hidden] { display:none !important; }
    body,h1,h2,h3,p,dl,dd { margin:0; }
    button,input { font:inherit; }
    button { cursor:pointer; }
    button:disabled { cursor:default; opacity:.55; }
    a { color:inherit; text-underline-offset:.2em; }
    :focus-visible { outline:3px solid var(--red); outline-offset:3px; }
    .wrap { width:min(100% - 3rem,112rem); margin-inline:auto; }
    .bar { display:flex; align-items:center; gap:1.6rem; min-height:76px; }
    .topbar { background:var(--paper); border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; flex:none; }
    .brand img { width:auto; height:2.9rem; max-width:9rem; object-fit:contain; display:block; }
    .dashboard-nav { display:flex; align-items:center; gap:.35rem; }
    .dashboard-nav a { display:block; min-height:42px; padding:.65rem .75rem; text-decoration:none; font-size:.9rem; font-weight:650; border-radius:.35rem; }
    .dashboard-nav [aria-current] { color:var(--red); background:#f9efed; }
    .page-actions { display:flex; gap:.5rem; margin-left:auto; }
    .button { display:inline-flex; justify-content:center; align-items:center; gap:.35rem; min-height:42px; padding:.5rem .75rem; border:1px solid var(--line); border-radius:.35rem; color:var(--ink); background:var(--paper); font-size:.85rem; font-weight:650; text-decoration:none; }
    .button:hover { border-color:#7b8b82; }
    .button.primary { color:white; background:var(--green); border-color:var(--green); }
    .button.icon { min-width:42px; padding-inline:.5rem; font-size:1.1rem; }
    .intro { display:flex; align-items:end; justify-content:space-between; flex-wrap:wrap; gap:.5rem 1rem; margin:1.4rem 0 1rem; }
    h1 { font-size:clamp(1.85rem,3vw,2.5rem); line-height:1.12; font-weight:760; letter-spacing:-.045em; }
    .intro p { font-size:.83rem; color:var(--muted); margin-top:.45rem; }
    .report-time { text-align:right; font-size:.78rem; color:var(--muted); }
    .report-time strong { display:block; font-weight:650; color:var(--green); }
    .status-line { margin-bottom:.7rem; padding:.6rem .8rem; font-size:.84rem; border:1px solid #dfd2a9; border-radius:.35rem; color:var(--caution); background:#fffaf0; }
    .workspace { display:grid; grid-template-columns:minmax(0,1fr) 375px; border:1px solid var(--line); border-radius:.6rem; overflow:hidden; background:var(--paper); box-shadow:0 8px 30px rgb(28 47 42 / .035); }
    .stage-column { min-width:0; background:var(--sky); }
    .scene-stage { position:relative; height:clamp(550px,70vh,900px); min-height:550px; overflow:hidden; isolation:isolate; background:var(--sky); }
    #sceneCanvas { position:absolute; inset:0; touch-action:none; }
    #sceneCanvas canvas { display:block; width:100%; height:100%; outline-offset:-5px; }
    .scene-caption { position:absolute; z-index:3; top:1rem; left:1rem; pointer-events:none; display:flex; gap:.5rem; align-items:center; padding:.45rem .65rem; border-radius:.35rem; background:rgb(255 255 255 / .91); color:var(--green); font-size:.72rem; font-weight:700; box-shadow:0 1px 7px rgb(29 50 42 / .06); }
    .scene-caption i { height:.4rem; width:.4rem; background:var(--red); border-radius:50%; }
    .local-conditions { position:absolute; z-index:3; top:1rem; right:1rem; width:252px; max-width:calc(100% - 2rem); padding:.55rem .7rem; background:rgb(255 255 255 / .94); color:var(--green); border:1px solid rgb(170 188 181 / .55); border-radius:.4rem; box-shadow:0 2px 8px rgb(29 50 42 / .05); pointer-events:none; }
    .conditions-top { display:grid; grid-template-columns:96px minmax(0,1fr); gap:.6rem; align-items:center; margin-bottom:.35rem; }
    .clock-wrap { text-align:center; }
    .clock-face { display:block; width:96px; height:96px; }
    .clock-numerals text { fill:var(--green); font:600 18px Inter,system-ui,sans-serif; text-anchor:middle; dominant-baseline:middle; }
    .clock-readout { display:block; margin-top:.2rem; font-size:.875rem; font-variant-numeric:tabular-nums; color:var(--muted); }
    .local-zone { font-size:.875rem; font-weight:700; }
    .local-date { color:var(--muted); font-size:.875rem; margin-top:.2rem; }
    .local-temperature { display:block; font-size:1.35rem; font-weight:750; font-variant-numeric:tabular-nums; margin-top:.3rem; }
    .local-weather { margin-top:.15rem; color:var(--muted); font-size:.875rem; }
    .weather-attribution { font-size:.75rem; }
    .local-weather.stale { color:var(--caution); }
    .local-conditions a { pointer-events:auto; }
    .scene-message { position:absolute; inset:0; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.7rem; padding:2rem; text-align:center; color:var(--green); background:var(--sky); }
    .scene-message p { max-width:32ch; font-size:.88rem; }
    .scene-message strong { font-size:1.12rem; }
    .scene-message .spinner { width:27px; height:27px; border:2px solid #cbd7d2; border-top-color:var(--green); border-radius:50%; animation:spin 1s linear infinite; }
    .scene-message.failed .spinner { display:none; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .scene-tools { position:absolute; z-index:5; bottom:1rem; left:1rem; right:1rem; display:flex; align-items:center; justify-content:space-between; gap:.5rem; pointer-events:none; }
    .scene-tools .button { pointer-events:auto; background:rgb(255 255 255 / .94); box-shadow:0 2px 8px rgb(29 50 42 / .06); }
    .scene-tools > div { display:flex; gap:.4rem; }
    .scene-hint { padding:.35rem .5rem; color:#344a40; border-radius:.3rem; font-size:.72rem; background:rgb(255 255 255 / .9); }
    .pins { position:absolute; inset:0; z-index:4; pointer-events:none; overflow:hidden; }
    .pin { position:absolute; left:0; top:0; display:flex; align-items:center; gap:.35rem; min-height:34px; max-width:205px; padding:.37rem .55rem; border:1px solid #b6c6bc; border-radius:.4rem; box-shadow:0 2px 6px rgb(22 43 34 / .12); background:rgb(255 255 255 / .95); color:var(--green); transform:translate(-50%,-50%); pointer-events:auto; font-size:.8125rem; font-weight:750; white-space:nowrap; text-align:left; }
    .pin-label { display:block; font:inherit; }
    .pin-value,.pin-extra { display:block; margin-top:1px; font-size:.75rem; font-weight:550; line-height:1.22; font-variant-numeric:tabular-nums; }
    .pin-extra { color:#5d6e62; font-size:.75rem; }
    .pin::before { content:''; width:5px; height:5px; border-radius:50%; background:var(--red); flex:none; }
    .pin[aria-pressed=true] { border-color:var(--green); color:white; background:var(--green); }
    .pin[aria-pressed=true]::before { background:#f2d5ac; }
    .pin[aria-pressed=true] .pin-extra { color:#d4e4d7; }
    .zone-nav { display:flex; gap:.3rem; padding:.7rem .8rem; flex-wrap:wrap; background:var(--paper); border-top:1px solid var(--line); }
    .zone-nav button { padding:.4rem .55rem; min-height:38px; border:1px solid transparent; border-radius:.3rem; background:transparent; font-size:.76rem; color:var(--muted); font-weight:650; }
    .zone-nav button:hover { background:#eff3ee; }
    .zone-nav button[aria-pressed=true] { background:var(--green); border-color:var(--green); color:white; }
    .detail-panel { min-width:0; border-left:1px solid var(--line); max-height:calc(clamp(550px,70vh,900px) + 67px); display:flex; flex-direction:column; background:var(--paper); }
    .panel-header { padding:1.2rem 1.15rem .9rem; border-bottom:1px solid var(--line); }
    .panel-header h2 { font-size:1.15rem; font-weight:750; letter-spacing:-.025em; }
    .panel-header p { color:var(--muted); font-size:.76rem; margin-top:.35rem; }
    .panel-body { padding:1.05rem 1.15rem 1.35rem; overflow:auto; scrollbar-width:thin; overscroll-behavior:contain; }
    .panel-body section + section { border-top:1px solid var(--line); margin-top:1rem; padding-top:1rem; }
    .panel-body h3 { font-size:.85rem; font-weight:750; margin-bottom:.6rem; }
    .panel-body p { font-size:.78rem; line-height:1.45; }
    .pair { display:grid; grid-template-columns:1fr 1fr; gap:.85rem; margin-bottom:.8rem; }
    .pair .figure { font-size:1.48rem; font-weight:760; letter-spacing:-.045em; line-height:1.2; margin:.2rem 0; color:var(--green); font-variant-numeric:tabular-nums; }
    .pair dt { color:var(--muted); font-size:.72rem; }
    .pair .unit { font-size:.68rem; font-weight:650; letter-spacing:0; margin-left:.2rem; }
    .metrics { display:grid; gap:.4rem; font-size:.8rem; }
    .metrics > div { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:.7rem; align-items:baseline; }
    .metrics dt { color:var(--muted); }
    .metrics dd { font-weight:700; text-align:right; font-variant-numeric:tabular-nums; }
    .source { margin-top:.65rem; font-size:.69rem !important; color:var(--muted); }
    .source .source-title { font-weight:700; }
    .source a { font-weight:650; }
    .note { margin-top:.4rem; color:var(--muted); font-size:.75rem !important; white-space:pre-wrap; }
    .flag { display:inline-block; padding:.2rem .4rem; border-radius:.25rem; background:#f7efdb; color:var(--caution); font-size:.67rem; font-weight:700; margin-top:.4rem; }
    .empty { color:var(--muted); font-size:.78rem; }
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; text-align:left; font-size:.74rem; font-variant-numeric:tabular-nums; }
    th,td { padding:.43rem .35rem; border-bottom:1px solid #e7ece6; vertical-align:top; }
    th { font-weight:650; }
    thead th { color:var(--muted); font-size:.65rem; white-space:nowrap; }
    th:first-child,td:first-child { padding-left:0; }
    td:not(:first-child),thead th:not(:first-child) { text-align:right; }
    td:last-child,th:last-child { padding-right:0; }
    .panel-body details { margin-top:.55rem; }
    .panel-body summary { min-height:37px; display:list-item; cursor:pointer; padding:.4rem 0; font-size:.77rem; font-weight:650; color:var(--green); }
    .panel-body details details { padding-left:.45rem; }
    .simple-list { margin:.4rem 0 0; padding-left:1.15rem; font-size:.78rem; }
    .simple-list li + li { margin-top:.4rem; }
    .locations { margin:.2rem 0 0; font-size:.65rem; color:var(--muted); font-weight:450; }
    .price-name { font-weight:700; }
    .price-grid { display:grid; gap:.55rem; }
    .price-row { display:flex; justify-content:space-between; align-items:baseline; gap:.7rem; font-size:.82rem; }
    .price-row strong { color:var(--green); font-variant-numeric:tabular-nums; }
    .price-row small { display:block; color:var(--muted); font-size:.69rem; font-weight:450; }
    .quote { display:flex; align-items:baseline; gap:.4rem; }
    .quote strong { color:var(--green); font-size:1.8rem; letter-spacing:-.045em; font-variant-numeric:tabular-nums; }
    .quote span { font-size:.75rem; color:var(--muted); }
    .calendar-controls { display:flex; align-items:center; justify-content:space-between; gap:.4rem; margin:.7rem 0 .3rem; }
    .calendar-controls strong { font-size:.78rem; }
    .calendar-controls .button { min-height:35px; min-width:35px; padding:.2rem .4rem; }
    .calendar { table-layout:fixed; font-size:.72rem; text-align:center; }
    .calendar th,.calendar td { border:0; padding:.08rem; text-align:center !important; }
    .calendar th { font-size:.63rem; }
    .calendar button { width:100%; min-height:32px; border:1px solid transparent; border-radius:.25rem; background:transparent; color:var(--ink); font-size:.7rem; position:relative; }
    .calendar button[aria-pressed=true] { background:var(--green); color:white; }
    .calendar button[data-event=true]::after { content:''; position:absolute; width:3px; height:3px; bottom:3px; left:calc(50% - 1.5px); background:var(--red); border-radius:50%; }
    .calendar button[aria-pressed=true]::after { background:#f2d5ac; }
    .purchase-list { list-style:none; margin:.55rem 0 0; padding:0; }
    .purchase-list li { padding:.55rem 0; border-bottom:1px solid #e7ece6; }
    .purchase-list strong { display:block; font-size:.78rem; }
    .purchase-list p { margin-top:.15rem; font-size:.71rem; color:var(--muted); }
    .stat-strip { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin:.85rem 0 0; border:1px solid var(--line); border-radius:.45rem; background:var(--paper); }
    .stat { padding:.8rem 1.1rem; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; column-gap:.6rem; }
    .stat + .stat { border-left:1px solid var(--line); }
    .stat dt { font-size:.76rem; color:var(--muted); }
    .stat dd { font-size:1.2rem; color:var(--green); font-weight:760; letter-spacing:-.025em; font-variant-numeric:tabular-nums; }
    .stat p { grid-column:1/-1; font-size:.69rem; color:var(--muted); margin-top:.1rem; }
    .footer { padding:.8rem .1rem 1.4rem; display:flex; align-items:baseline; gap:.75rem; flex-wrap:wrap; justify-content:space-between; color:var(--muted); font-size:.72rem; }
    .footer a { font-weight:650; }
    .loading { margin:2rem auto; color:var(--muted); font-size:.88rem; }
    .login { max-width:430px; margin:clamp(2rem,10vh,6rem) auto; padding:1.5rem; border:1px solid var(--line); border-radius:.5rem; background:var(--paper); }
    .login h1 { margin-bottom:1rem; }
    .login label { display:block; margin-bottom:.4rem; font-size:.88rem; font-weight:650; }
    .login input { display:block; width:100%; min-height:44px; padding:.5rem .65rem; border:1px solid #87948c; border-radius:.3rem; margin-bottom:.8rem; }
    .login .button { width:100%; }
    .login p { margin-top:.7rem; font-size:.8rem; color:var(--red); }
    @media (min-width:1650px) { .workspace { grid-template-columns:minmax(0,1fr) 400px; } }
    @media (max-width:1150px) { .workspace { grid-template-columns:minmax(0,1fr) 335px; } .scene-hint { display:none; } .panel-body,.panel-header { padding-inline:.9rem; } }
    @media (max-width:900px) { .workspace { grid-template-columns:1fr; } .scene-stage { height:66vh; min-height:460px; } .detail-panel { border-left:0; border-top:1px solid var(--line); max-height:none; } .panel-body { overflow:visible; } .panel-header { padding:.9rem 1rem; } .panel-body { padding:1rem; } .scene-tools { bottom:.75rem; } .zone-nav { justify-content:center; } .pair { max-width:32rem; } }
    @media (max-width:650px) { .wrap { width:calc(100% - 1.4rem); } .bar { flex-wrap:wrap; justify-content:space-between; gap:.3rem .5rem; padding-block:.7rem; } .brand img { width:auto; height:2.35rem; } .dashboard-nav { order:3; width:100%; gap:.2rem; } .dashboard-nav a { min-height:37px; font-size:.8rem; padding:.45rem .6rem; } .page-actions { margin-left:0; } .page-actions .button { min-height:38px; font-size:.75rem; padding:.45rem .55rem; } .intro { margin:1rem 0 .75rem; } .intro p { font-size:.74rem; max-width:45ch; } .report-time { text-align:left; width:100%; font-size:.71rem; } .report-time strong { display:inline; margin-right:.4rem; } .scene-stage { height:58vh; min-height:390px; } .scene-caption { top:.65rem; left:.65rem; font-size:.65rem; } .scene-tools { left:.65rem; right:.65rem; } .scene-tools .button { min-height:37px; font-size:.72rem; padding:.4rem .55rem; } .pin { font-size:.8125rem; padding:.3rem .4rem; min-height:36px; } .zone-nav { justify-content:flex-start; gap:.15rem; padding:.55rem; } .zone-nav button { min-height:38px; font-size:.7rem; padding:.35rem .45rem; } .stat-strip { gap:0; } .stat { padding:.65rem .6rem; display:block; } .stat + .stat { border-left:1px solid var(--line); } .stat dt { font-size:.68rem; } .stat dd { font-size:1.04rem; margin-top:.15rem; } .stat p { font-size:.62rem; } .footer { font-size:.66rem; } .login { margin:2rem .7rem; } }
    @media (prefers-reduced-motion:reduce) { .spinner { animation:none !important; } }
    @media (max-width:650px) { .local-conditions { top:.65rem; right:.65rem; padding:.45rem .55rem; } .scene-caption { display:none; } }
    @media (max-width:650px) { .pin { max-width:185px; } .pin-extra { display:none; } }
    @media print { .topbar,.scene-stage,.zone-nav,.page-actions,.footer { display:none; } .workspace { display:block; border:0; } .detail-panel { max-height:none; border:0; } .panel-body { overflow:visible; } body { background:white; } }
  </style>
</head>
<body>
  <header class="topbar"><div class="wrap bar">
    <a class="brand" href="/"><img src="/bmc-logo.png" alt="Black Market Coffee"></a>
    <nav class="dashboard-nav" aria-label="Dashboards"><a href="/">Steam Room</a><a href="/roastery-lab">Roastery Lab</a><a href="/warehouse" aria-current="page">Warehouse</a></nav>
    <div id="pageActions" class="page-actions" hidden><button id="refresh" class="button" type="button">Refresh</button><button id="logout" class="button" type="button">Sign out</button></div>
  </div></header>
  <p id="opening" class="wrap loading" role="status">Opening Warehouse…</p>
  <main id="login" class="login" hidden>
    <h1>Warehouse</h1><form id="signInForm"><label for="password">Stock Take App password</label><input id="password" type="password" autocomplete="current-password" maxlength="256" required><button id="signIn" class="button primary" type="submit">Sign in</button><p id="loginMessage" role="alert" hidden></p></form>
  </main>
  <main id="warehouse" class="wrap" hidden tabindex="-1">
    <div class="intro"><div><h1>Warehouse</h1><p>Illustrative activity · dashboard figures refresh every minute</p></div><p id="reportTime" class="report-time" aria-live="polite"></p></div>
    <p id="status" class="status-line" role="status" hidden></p>
    <div class="workspace">
      <div class="stage-column">
        <div id="sceneStage" class="scene-stage">
          <div id="sceneCanvas" role="group" aria-label="Interactive roastery illustration"></div>
          <div class="scene-caption"><i aria-hidden="true"></i>Black Market roastery</div>
          <aside class="local-conditions" aria-label="Sydney time and Marrickville outdoor forecast">
            <div class="conditions-top">
              <div class="clock-wrap">
                <svg id="analogueClock" class="clock-face" viewBox="0 0 120 120" role="img" aria-labelledby="clockTitle clockDescription">
                  <title id="clockTitle">Sydney analogue clock</title><desc id="clockDescription">Current time in Sydney.</desc>
                  <circle cx="60" cy="60" r="57.5" fill="#fffdf8" stroke="#263e35" stroke-width="2.5"/>
                  <circle cx="60" cy="60" r="54" fill="none" stroke="#d6ddd6" stroke-width=".8"/>
                  <g id="clockMarks" aria-hidden="true"></g>
                  <g class="clock-numerals" aria-hidden="true"><text x="60" y="29">12</text><text x="91" y="61">3</text><text x="60" y="93">6</text><text x="29" y="61">9</text></g>
                  <g stroke-linecap="round" aria-hidden="true">
                    <line id="clockHour" x1="60" y1="65" x2="60" y2="35" stroke="#263e35" stroke-width="5"/>
                    <line id="clockMinute" x1="60" y1="67" x2="60" y2="21" stroke="#263e35" stroke-width="3"/>
                    <line id="clockSecond" x1="60" y1="70" x2="60" y2="17" stroke="#a5282c" stroke-width="1.5"/>
                    <circle cx="60" cy="60" r="3.2" fill="#a5282c"/>
                  </g>
                </svg>
                <time id="localClock" class="clock-readout"></time>
              </div>
              <div><p class="local-zone">Sydney</p><p id="localDate" class="local-date"></p><strong id="localTemperature" class="local-temperature">—°C</strong></div>
            </div>
            <p id="weatherLabel" class="local-weather">Marrickville · outdoor forecast</p><p id="weatherReading" class="local-weather">Waiting for forecast data</p><p class="local-weather weather-attribution"><a href="https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-33.91&amp;lon=151.16" target="_blank" rel="noopener noreferrer">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p>
          </aside>
          <div id="sceneMessage" class="scene-message" role="status"><span class="spinner" aria-hidden="true"></span><strong id="sceneMessageTitle">Opening the roastery</strong><p id="sceneMessageBody">Your dashboard figures will appear alongside the scene.</p></div>
          <div id="pins" class="pins" aria-label="Roastery zones"></div>
          <div class="scene-tools"><div><button id="pause" type="button" class="button" aria-pressed="false">Pause activity</button><button id="reset" type="button" class="button">Reset view</button></div><p class="scene-hint">Drag to look around · scroll or pinch to zoom</p></div>
        </div>
        <nav id="zoneNav" class="zone-nav" aria-label="Choose a warehouse zone"></nav>
      </div>
      <aside class="detail-panel" aria-labelledby="zoneTitle"><header class="panel-header"><h2 id="zoneTitle" tabindex="-1">Week at a glance</h2><p id="zoneSubtitle">The same figures as Steam Room and Roastery Lab.</p></header><div id="zoneDetails" class="panel-body"><p class="empty">Loading dashboard figures…</p></div></aside>
    </div>
    <dl class="stat-strip"><div class="stat"><dt>Weekly demand</dt><dd id="statDemand">—</dd><p>Weekly roast tally</p></div><div class="stat"><dt>Roasted this week</dt><dd id="statRoasted">—</dd><p id="statRoastSource">Cropster</p></div><div class="stat"><dt>Delivery orders done</dt><dd id="statDispatch">—</dd><p id="statDispatchSource">Dispatch</p></div></dl>
    <footer class="footer"><p>Sydney reporting week · AUD values · scene activity is illustrative</p><a href="/details">Operations details and issue notes</a></footer>
  </main>
  <noscript><p class="wrap loading">Enable JavaScript to sign in and read the warehouse dashboard.</p></noscript>
  <script>
    const el = (id) => document.getElementById(id);
    const zones = [
      { id: "overview", name: "Overview", title: "Week at a glance", subtitle: "The same figures as Steam Room and Roastery Lab." },
      { id: "roasting", name: "Roasting", title: "Roasting floor", subtitle: "Weekly demand and Cropster production." },
      { id: "green", name: "Green stock", title: "Green coffee", subtitle: "Marrickville stock and consumption across all locations." },
      { id: "packing", name: "Packing", title: "Packing & stockroom", subtitle: "Recorded packing rates and non-coffee stock." },
      { id: "dispatch", name: "Dispatch", title: "Dispatch bay", subtitle: "This week’s wholesale delivery schedule." },
      { id: "lab", name: "Roastery Lab", title: "Roastery Lab", subtitle: "Coffee costs, roast loss, releases and quality notes." },
      { id: "purchases", name: "Purchases", title: "Coffee buying", subtitle: "Coffee C market data and the purchase calendar." }
    ];
    let signedIn = false, data = null, selected = "overview", scene = null, scenePromise = null, sceneFailed = false;
    let sessionGeneration = 0, activeRequest = null, pinsFrame = null, pinsTime = 0, sceneVisible = true;
    let weatherMinute = -1;
    const clockDate = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const clockTime = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let paused = motion.matches;
    let purchaseMonth = today().slice(0, 7), purchaseDay = today();
    const numbers = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });
    const precise = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
    const dollars = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
    const unitDollars = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });
    const timeFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    function today() {
      const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(/* @__PURE__ */ new Date());
      return ["year", "month", "day"].map((type) => parts.find((p) => p.type === type).value).join("-");
    }
    function node(tag, text, className) {
      const item = document.createElement(tag);
      if (text !== void 0 && text !== null) item.textContent = text;
      if (className) item.className = className;
      return item;
    }
    function num(value) {
      return Number.isFinite(value) ? numbers.format(value) : "—";
    }
    function kg(value) {
      return Number.isFinite(value) ? numbers.format(value) + " kg" : "—";
    }
    function money(value, detail = false) {
      return Number.isFinite(value) ? (detail ? unitDollars : dollars).format(value) : "—";
    }
    function percent(value) {
      return Number.isFinite(value) ? numbers.format(value) + "%" : "—";
    }
    function change(value) {
      return Number.isFinite(value) ? (value > 0 ? "+" : "") + numbers.format(value) + "%" : "—";
    }
    function date(value, withTime = false) {
      if (!value) return "";
      const parsed = new Date(value.length === 10 ? value + "T12:00:00Z" : value);
      return Number.isFinite(parsed.valueOf()) ? (withTime ? timeFormat : dateFormat).format(parsed) : "";
    }
    function month(value) {
      if (!/^\d{4}-\d{2}$/.test(value || "")) return "—";
      return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "short", year: "numeric" }).format(/* @__PURE__ */ new Date(value + "-01T12:00:00Z"));
    }
    function section(title, ...children) {
      const item = node("section");
      if (title) item.append(node("h3", title));
      item.append(...children.filter(Boolean));
      return item;
    }
    function note(text) {
      return text ? node("p", text, "note") : null;
    }
    function empty(text) {
      return node("p", text, "empty");
    }
    function metrics(rows) {
      const list = node("dl", void 0, "metrics");
      for (const [label, value] of rows) {
        const row = node("div");
        row.append(node("dt", label), node("dd", value));
        list.append(row);
      }
      return list;
    }
    function pair(rows) {
      const list = node("dl", void 0, "pair");
      for (const [label, value] of rows) {
        const row = node("div");
        row.append(node("dt", label), node("dd", value, "figure"));
        list.append(row);
      }
      return list;
    }
    function disclosure(title, ...children) {
      const item = node("details");
      item.append(node("summary", title), ...children.filter(Boolean));
      return item;
    }
    function table(headers, rows, caption) {
      if (!rows.length) return empty("No recorded rows.");
      const wrap = node("div", void 0, "table-wrap");
      const grid = node("table");
      if (caption) grid.setAttribute("aria-label", caption);
      const head = grid.createTHead().insertRow();
      for (const label of headers) {
        const cell = node("th", label);
        cell.scope = "col";
        head.append(cell);
      }
      const body = grid.createTBody();
      for (const values of rows) {
        const row = body.insertRow();
        values.forEach((value, index) => {
          const cell = node(index === 0 ? "th" : "td");
          if (index === 0) cell.scope = "row";
          if (value instanceof Node) cell.append(value);
          else cell.textContent = value ?? "—";
          row.append(cell);
        });
      }
      wrap.append(grid);
      return wrap;
    }
    function source(metric = {}, label = "Source", url) {
      const p = node("p", void 0, "source");
      const title = node("span", label, "source-title");
      p.append(title);
      const at = date(metric.asOf, true);
      if (at) p.append(" · " + at + " Sydney time");
      if (metric.stale || metric.status === "stale") p.append(" · saved reading may be out of date");
      else if (metric.status === "partial") p.append(" · partial data");
      else if (metric.status === "unavailable") p.append(" · unavailable");
      if (url) {
        try {
          const safe = new URL(url, location.origin);
          if (safe.protocol === "https:" || safe.origin === location.origin) {
            const a = node("a", "Open source");
            a.href = safe.href;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            p.append(" · ", a);
          }
        } catch {
        }
      }
      return p;
    }
    function metricNote(metric = {}) {
      return note(metric.note);
    }
    function makeClockMarks() {
      const marks = el("clockMarks");
      for (let index = 0; index < 60; index++) {
        const major = index % 5 === 0;
        const mark = document.createElementNS("http://www.w3.org/2000/svg", "line");
        mark.setAttribute("x1", "60");
        mark.setAttribute("x2", "60");
        mark.setAttribute("y1", major ? "8" : "10");
        mark.setAttribute("y2", major ? "16" : "13");
        mark.setAttribute("stroke", major ? "#263e35" : "#97a69b");
        mark.setAttribute("stroke-width", major ? "1.7" : ".8");
        mark.setAttribute("transform", "rotate(" + index * 6 + " 60 60)");
        marks.append(mark);
      }
    }
    function updateClock() {
      const now = new Date();
      const parts = Object.fromEntries(clockTime.formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
      const hour = Number(parts.hour) % 12;
      const minute = Number(parts.minute);
      const second = Number(parts.second);
      const time = clockTime.format(now);
      const currentDate = clockDate.format(now);
      el("clockHour").setAttribute("transform", "rotate(" + (hour * 30 + minute / 2 + second / 120) + " 60 60)");
      el("clockMinute").setAttribute("transform", "rotate(" + (minute * 6 + second / 10) + " 60 60)");
      el("clockSecond").setAttribute("transform", "rotate(" + second * 6 + " 60 60)");
      el("clockDescription").textContent = "Sydney time is " + time + " on " + currentDate + ".";
      el("localDate").textContent = currentDate;
      el("localClock").textContent = time;
      el("localClock").dateTime = now.toISOString();
      el("localClock").setAttribute("aria-label", "Sydney time " + time);
      const weatherBucket = Math.floor(now.getTime() / 6e4);
      if (weatherMinute !== weatherBucket) {
        weatherMinute = weatherBucket;
        renderWeather();
      }
    }
    function renderWeather() {
      const weather = data?.weather;
      const available = Number.isFinite(weather?.temperatureC);
      const readingAt = weather?.time || weather?.asOf;
      const timestamp = readingAt ? new Date(readingAt).valueOf() : NaN;
      const stale = available && (weather.status === "stale" || weather.status === "unavailable" ||
        Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) > 45 * 6e4);
      el("localTemperature").textContent = available ? num(weather.temperatureC) + "°C" : "—°C";
      el("weatherLabel").textContent = "Marrickville · outdoor forecast";
      el("weatherReading").classList.toggle("stale", stale);
      if (!weather) {
        el("weatherReading").textContent = signedIn ? "Waiting for forecast data" : "Outdoor forecast";
      } else if (!available) {
        el("weatherReading").textContent = "Temperature unavailable";
      } else {
        const when = date(readingAt, true);
        el("weatherReading").textContent = (stale ? "Past forecast " : "For ") + (when || "time unavailable");
      }
      el("weatherReading").title = weather?.note || "";
    }
    function flag(text) {
      return text ? node("p", text, "flag") : null;
    }
    function weekLabel() {
      return data?.weekly?.week?.label || "Current Sydney week";
    }
    function weeklyMetrics() {
      return data?.weekly?.metrics || {};
    }
    function weeklyNotes() {
      const notes = data?.notes || {};
      const lines = Array.isArray(notes.lines) ? notes.lines : [];
      const list = node("ul", void 0, "simple-list");
      for (const line of lines) list.append(node("li", line));
      return section(
        "Weekly meeting notes",
        lines.length ? list : empty(notes.status === "unavailable" ? "Weekly notes are unavailable." : "No meeting notes saved for this week."),
        source({ asOf: notes.updatedAt, status: notes.status }, "Saved meeting notes", "/")
      );
    }
    function overviewPanel() {
      const { demand = {}, production = {}, green = {}, stock = {}, wholesale = {} } = weeklyMetrics();
      return [
        section(
          "This week",
          pair([["Demand", kg(demand.kg)], ["Roasted", kg(production.roastedKg)]]),
          metrics([
            ["Scheduled output estimate", kg(production.scheduledKg)],
            ["Production green cost", money(production.value)],
            ["Marrickville green stock", kg(green.kg)],
            ["Green stock value", money(green.value)],
            ["Non-coffee stock", money(stock.value)],
            ["Wholesale orders done", num(wholesale.done)],
            ["Pending " + (wholesale.provisional ? "(provisional)" : ""), num(wholesale.provisional ? wholesale.scheduledPendingOrders : wholesale.pending)]
          ]),
          source(production, "Cropster saved reading"),
          source(demand, "Weekly roast tally"),
          source(wholesale, "Dispatch"),
          note("Choose a zone in the roastery or below the scene for its full figures and source notes.")
        ),
        weeklyNotes(),
        section(
          "Source coverage",
          source(green, "Cropster · Marrickville"),
          source(stock, "Stock Take App"),
          source(data?.packing, "Stock Take App · packing"),
          source(data?.lab?.source, "Cropster · Roastery Lab"),
          note("Dashboard refresh time is separate from each source’s saved timestamp. The moving roastery is an illustration.")
        )
      ];
    }
    function roastingPanel() {
      const { demand = {}, production = {} } = weeklyMetrics();
      return [
        section(
          "Cropster production",
          pair([["Roasted output", kg(production.roastedKg)], ["Scheduled estimate", kg(production.scheduledKg)]]),
          metrics([
            ["Roasted + scheduled", kg(production.totalKg)],
            ["Green cost", money(production.value)],
            ["Roasted green cost", money(production.roastedValue)],
            ["Scheduled cost estimate", money(production.scheduledValue)],
            ["Production change vs last week", change(production.changePercent)],
            ["Green cost change", change(production.valueChangePercent)]
          ]),
          source(production, "Cropster saved reading", "https://c-sar.cropster.com"),
          metricNote(production),
          disclosure("Previous week", metrics([["Roasted output", kg(production.previousRoastedKg)], ["Scheduled estimate", kg(production.previousScheduledKg)], ["Combined weight", kg(production.previousKg)], ["Green cost", money(production.previousValue)]]))
        ),
        section("Weekly demand", pair([["This week", kg(demand.kg)], ["Previous week", kg(demand.previousKg)]]), metrics([
          ["Change from last week", change(demand.changePercent)],
          ["Carry-forward", kg(demand.carryForwardKg)],
          ["Brown stock on hand", kg(demand.brownOnHandKg)],
          ["Monday Cropster output", kg(demand.mondayRoastedKg)]
        ]), source(demand, "Google roast tally · 3. Roast Planning!C18"), metricNote(demand), note(demand.carryForwardNote)),
        weeklyNotes()
      ];
    }
    function consumptionSection() {
      const c = data?.lab?.consumption || {};
      const last = c.lastMonth || {};
      return section(
        "Green coffee consumption",
        pair([["3-month average", kg(c.averageKg)], ["Average bags / month", num(c.averageBags)]]),
        table(["Completed month", "kg", "Bags"], (c.months || []).map((row) => [month(row.month), num(row.kg), num(row.bags)]), "Monthly green consumption"),
        metricNote(c),
        last.rows?.length ? disclosure(month(last.month) + " by coffee", table(["Coffee", "kg", "Bags"], last.rows.map((row) => [row.name, num(row.kg), num(row.bags)]), "Last month by coffee")) : null,
        source(data?.lab?.source, "Cropster saved consumption")
      );
    }
    function forecastsSection() {
      const c = data?.lab?.consumption || {};
      const rows = (c.forecasts || []).map((row) => {
        const label = node("span", row.name);
        if (row.locations?.length) label.append(node("p", row.locations.map((place) => place.name + " " + kg(place.kg)).join(" · "), "locations"));
        return [label, num(row.kg), num(row.avgMonthlyKg), month(row.depletionMonth)];
      });
      return section(
        "Estimated stock depletion",
        metrics([["Inventory, all locations", kg(c.stockTotalKg)], ["Inventory as of", date(c.stockAsOf) || "—"]]),
        table(["Coffee", "Stock kg", "kg / mo", "Finish"], rows, "Coffee depletion estimates"),
        note(c.forecastNote)
      );
    }
    function greenPanel() {
      const green = weeklyMetrics().green || {};
      const location2 = green.location === "Marrickville";
      return [section(
        "Marrickville green stock",
        pair([["Weight on hand", kg(location2 ? green.kg : null)], ["Green stock value", money(location2 ? green.value : null)]]),
        source(green, "Cropster saved inventory", "https://c-sar.cropster.com/apps/lots/inventory-report/location"),
        metricNote(green),
        Number.isFinite(green.unpricedLots) && green.unpricedLots > 0 ? flag(num(green.unpricedLots) + " lots need a price") : null
      ), consumptionSection(), forecastsSection()];
    }
    function packingPanel() {
      const pack = data?.packing || {}, stock = weeklyMetrics().stock || {};
      const categories = (stock.categories || []).map((item) => [item.name, num(item.itemCount), money(item.value)]);
      return [
        section(
          "Recorded packing",
          pair([["Per active hour", Number.isFinite(pack.kgPerHour) ? num(pack.kgPerHour) + " kg/h" : "—"], ["Per packing day", kg(pack.kgPerDay)]]),
          metrics([["Packed this week", kg(pack.packedKg)], ["Timed weight coverage", percent(pack.timedCoveragePercent)]]),
          source(pack, "Stock Take App · packing timers"),
          metricNote(pack)
        ),
        section(
          "Non-coffee stock",
          pair([["Current holding value", money(stock.value)], ["Active items", num(stock.itemCount)]]),
          metrics([["Categories", num(stock.categoryCount)], ["Unpriced items", num(stock.unpricedItems)]]),
          stock.status === "partial" ? flag("Known-price subtotal") : null,
          table(["Category", "Items", "Value"], categories, "Non-coffee stock by category"),
          source(stock, "Stock Take App saved counts"),
          metricNote(stock)
        )
      ];
    }
    function dispatchPanel() {
      const w = weeklyMetrics().wholesale || {};
      return [
        section(
          "Wholesale delivery orders",
          pair([["Done", num(w.done)], ["Pending", num(w.provisional ? w.scheduledPendingOrders : w.pending)]]),
          metrics([["Scheduled total", num(w.provisional ? w.scheduledOrders : w.orders)], ["Completed deliveries", num(w.completed)]]),
          w.provisional ? flag("Provisional · weekly import unconfirmed") : null,
          source(w, "Dispatch weekly schedule"),
          metricNote(w)
        ),
        section("Previous week", metrics([["Total wholesale orders", num(w.previousOrders)], ["Done", num(w.previousDone)], ["Pending", num(w.previousPending)], ["Delivered orders", num(w.previousCompleted)]])),
        weeklyNotes()
      ];
    }
    function labPanel() {
      const lab = data?.lab || {}, prices = lab.prices || {}, settings = lab.settings || {};
      const leaders = node("div", void 0, "price-grid");
      for (const item of prices.highlights || []) {
        const row = node("div", void 0, "price-row");
        const name = node("span", item.name, "price-name");
        name.append(node("small", "Average roast loss " + percent(item.lossPercent)));
        row.append(name, node("strong", money(item.pricePerKg, true) + " / kg"));
        leaders.append(row);
      }
      const recipes = node("div");
      for (const item of prices.highlights || []) {
        recipes.append(disclosure(item.name + " recipe", item.components?.length ? table(["Ingredient", "Share", "AUD/kg"], item.components.map((row) => [row.coffee && row.coffee !== row.name ? row.name + " (" + row.coffee + ")" : row.name, percent(row.percent), money(row.pricePerKg, true)]), item.name + " recipe") : empty("No verified recipe recorded."), Number.isFinite(item.lossBatchCount) ? note(num(item.lossBatchCount) + " recorded roast batches.") : null));
      }
      const other = table(["Coffee", "AUD/kg", "Loss"], (prices.others || []).map((row) => [row.name, money(row.pricePerKg, true), percent(row.lossPercent)]), "Other coffee prices and roast loss");
      const releases = node("ul", void 0, "simple-list");
      for (const row of settings.releases || []) releases.append(node("li", row.name + (date(row.date) ? " · " + date(row.date) : "")));
      return [
        section(
          "Green cost & roast loss",
          leaders.children.length ? leaders : empty("Verified prices are unavailable."),
          note("Green coffee ingredient cost. Roast weight loss is shown separately."),
          source({ asOf: prices.priceAsOf, status: lab.source?.status }, "Cropster green prices"),
          note(prices.lossFrom || prices.lossAsOf ? "Roast loss " + (date(prices.lossFrom) || "") + (prices.lossFrom ? " to " : "through ") + (date(prices.lossAsOf) || "—") + "." : ""),
          note(prices.lossNote),
          disclosure("Signature blend recipes", recipes),
          disclosure("All other coffees", other)
        ),
        section("Releases", releases.children.length ? releases : empty(settings.revision === null ? "Release information is unavailable." : "No releases saved."), source({ asOf: settings.updatedAt }, "Saved Roastery Lab settings", "/roastery-lab")),
        section("Quality notes", note(settings.qa) || empty(settings.revision === null ? "QA notes are unavailable." : "No QA notes saved."), source({ asOf: settings.updatedAt, status: settings.status }, "Saved Roastery Lab settings", "/roastery-lab"), metricNote(lab.source))
      ];
    }
    function quoteSection() {
      const q = data?.lab?.coffeeC || {};
      const quote = node("p", void 0, "quote");
      quote.append(node("strong", q.status !== "unavailable" && Number.isFinite(q.price) ? precise.format(q.price) : "—"), node("span", "US¢/lb"));
      const movements = [];
      if (Number.isFinite(q.change)) movements.push((q.change > 0 ? "+" : "") + precise.format(q.change) + " US¢/lb");
      if (Number.isFinite(q.changePercent)) movements.push(change(q.changePercent));
      const timing = q.status === "unavailable" ? "Quote unavailable." : (q.marketStatus === "closed" ? "Market closed. " : "") + (q.status === "stale" ? "Last available quote. " : "") + (Number.isFinite(q.delayMinutes) && q.delayMinutes > 0 ? "Delayed at least " + num(q.delayMinutes) + " minutes." : "Quote delay unconfirmed.");
      return section("ICE Coffee C", quote, note(movements.join(" / ")), q.contract ? note("Contract " + q.contract) : null, note(timing), source(q, "Last traded quote", q.sourceUrl), metricNote(q));
    }
    function purchaseAmount(event) {
      if (!Number.isFinite(event.value)) return "";
      if (/^[A-Z]{3}$/.test(event.currency || "")) {
        try {
          return new Intl.NumberFormat("en-AU", { style: "currency", currency: event.currency, currencyDisplay: "code", maximumFractionDigits: 0 }).format(event.value);
        } catch {
          return "";
        }
      }
      return event.currencySymbol === "$" ? "$" + precise.format(event.value) + " as recorded" : "";
    }
    function purchaseList(events, showDate = true) {
      if (!events.length) return empty(data?.lab?.purchases?.status === "unavailable" ? "Purchase data is unavailable." : "No dated purchases recorded.");
      const list = node("ul", void 0, "purchase-list");
      for (const event of events) {
        const row = node("li");
        row.append(node("strong", event.coffee || "Coffee to be confirmed"));
        row.append(node("p", [showDate && date(event.date), event.kind === "ordered" ? "Ordered" : "Planned", event.supplier].filter(Boolean).join(" · ")));
        const quantity = [Number.isFinite(event.kg) && kg(event.kg), Number.isFinite(event.bags) && num(event.bags) + " bags", purchaseAmount(event)].filter(Boolean).join(" · ");
        if (quantity) row.append(node("p", quantity));
        if (event.quantityText) row.append(node("p", event.quantityText));
        if (event.dueDate) row.append(node("p", "Payment due " + (date(event.dueDate) || "—")));
        if (event.invoice) row.append(node("p", "Reference " + event.invoice));
        if (event.note) row.append(note(event.note));
        list.append(row);
      }
      return list;
    }
    function datedPurchases() {
      return (data?.lab?.purchases?.events || []).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") && ["ordered", "upcoming"].includes(row.kind)).sort((a, b) => a.date.localeCompare(b.date) || (a.coffee || "").localeCompare(b.coffee || ""));
    }
    function purchaseCalendar(events) {
      const container = node("div");
      const tools = node("div", void 0, "calendar-controls");
      const back = node("button", "‹", "button");
      back.type = "button";
      back.dataset.monthOffset = "-1";
      back.setAttribute("aria-label", "Previous purchase month");
      const next = node("button", "›", "button");
      next.type = "button";
      next.dataset.monthOffset = "1";
      next.setAttribute("aria-label", "Next purchase month");
      tools.append(back, node("strong", month(purchaseMonth)), next);
      container.append(tools);
      const grid = node("table", void 0, "calendar");
      grid.setAttribute("aria-label", "Purchase calendar for " + month(purchaseMonth));
      const head = grid.createTHead().insertRow();
      for (const day of ["M", "T", "W", "T", "F", "S", "S"]) head.append(node("th", day));
      const start = /* @__PURE__ */ new Date(purchaseMonth + "-01T12:00:00Z");
      const offset = (start.getUTCDay() + 6) % 7;
      const length = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      const body = grid.createTBody();
      let row;
      for (let position = 0; position < Math.ceil((offset + length) / 7) * 7; position++) {
        if (position % 7 === 0) row = body.insertRow();
        const cell = row.insertCell();
        const n = position - offset + 1;
        if (n < 1 || n > length) continue;
        const iso = purchaseMonth + "-" + String(n).padStart(2, "0");
        const count = events.filter((event) => event.date === iso).length;
        const button = node("button", String(n));
        button.type = "button";
        button.dataset.purchaseDate = iso;
        button.dataset.event = String(count > 0);
        button.setAttribute("aria-pressed", String(iso === purchaseDay));
        button.setAttribute("aria-label", date(iso) + (count ? ", " + count + " purchases" : ", no recorded purchases"));
        cell.append(button);
      }
      container.append(grid, node("p", "Dots mark recorded orders or planned purchases.", "source"));
      return container;
    }
    function purchaseTotals(events) {
      const rows = ["ordered", "upcoming"].map((kind) => {
        const group = events.filter((event) => event.kind === kind && event.date.startsWith(purchaseMonth));
        const sum = (field) => data?.lab?.purchases?.status !== "unavailable" && group.every((event) => Number.isFinite(event[field])) ? group.reduce((total, event) => total + event[field], 0) : null;
        const sameAUD = group.length > 0 && group.every((event) => event.currency === "AUD");
        const sameDollar = group.length > 0 && group.every((event) => !event.currency && event.currencySymbol === "$");
        const value = sameAUD ? money(sum("value")) : sameDollar && Number.isFinite(sum("value")) ? "$" + precise.format(sum("value")) + "*" : "—";
        return [kind === "ordered" ? "Ordered" : "Planned", data?.lab?.purchases?.status === "unavailable" ? "—" : num(group.length), kg(sum("kg")), value];
      });
      return disclosure(month(purchaseMonth) + " order totals", table(["Status", "Orders", "Weight", "Value"], rows, "Purchase totals for " + month(purchaseMonth)), note("* Dollar currency as recorded in the source; only like currencies are added."));
    }
    function purchasesPanel() {
      const purchases = data?.lab?.purchases || {}, events = datedPurchases();
      const next = events.filter((event) => event.kind === "upcoming" && event.date >= today());
      return [quoteSection(), section("Purchase calendar", purchaseCalendar(events), node("h3", date(purchaseDay) || "Selected day"), purchaseList(events.filter((event) => event.date === purchaseDay), false), purchaseTotals(events), source(purchases, purchases.sheetName || "Green purchase workbook", purchases.sourceUrl), metricNote(purchases)), section("Next planned orders", purchaseList(next))];
    }
    const panelBuilders = { overview: overviewPanel, roasting: roastingPanel, green: greenPanel, packing: packingPanel, dispatch: dispatchPanel, lab: labPanel, purchases: purchasesPanel };
    function renderPanel(preserve = false) {
      const panel = el("zoneDetails");
      const scroll = preserve ? panel.scrollTop : 0;
      const open = new Set(preserve ? [...panel.querySelectorAll("details[open]>summary")].map((item) => item.textContent) : []);
      const zone = zones.find((item) => item.id === selected) || zones[0];
      el("zoneTitle").textContent = zone.title;
      el("zoneSubtitle").textContent = selected === "overview" ? zone.subtitle : zone.subtitle + " " + weekLabel();
      panel.replaceChildren(...(data ? panelBuilders[selected]() : [empty("Dashboard figures are loading.")]));
      if (preserve) {
        for (const item of panel.querySelectorAll("details")) if (open.has(item.querySelector("summary")?.textContent)) item.open = true;
      }
      panel.scrollTop = scroll;
    }
    function selectZone(id, { focus = false, moveCamera = true } = {}) {
      if (!zones.some((item) => item.id === id)) return;
      const same = selected === id;
      selected = id;
      document.querySelectorAll("[data-zone]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.zone === selected)));
      renderPanel(same);
      if (moveCamera) scene?.focus(id);
      if (focus) el("zoneTitle").focus({ preventScroll: true });
      positionPins();
    }
    function makeZoneControls() {
      for (const zone of zones) {
        const button = node("button", zone.name);
        button.type = "button";
        button.dataset.zone = zone.id;
        button.setAttribute("aria-pressed", String(zone.id === selected));
        el("zoneNav").append(button);
        if (zone.id === "overview") continue;
        const pin = node("button", void 0, "pin");
        const text = node("span");
        text.append(node("span", zone.name, "pin-label"));
        pin.append(text);
        pin.type = "button";
        pin.dataset.zone = zone.id;
        pin.hidden = true;
        pin.setAttribute("aria-pressed", "false");
        pin.setAttribute("aria-label", "View " + zone.name + " figures");
        el("pins").append(pin);
      }
    }
    function renderPinMetrics() {
      const { production = {}, green = {}, wholesale = {} } = weeklyMetrics();
      const packing = data?.packing || {};
      const signature = (data?.lab?.prices?.highlights || []).find((item) => Number.isFinite(item.pricePerKg));
      const next = datedPurchases().find((event) => event.kind === "upcoming" && event.date >= today());
      const pending = wholesale.provisional ? wholesale.scheduledPendingOrders : wholesale.pending;
      const nextDate = next ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" }).format(new Date(next.date + "T12:00:00Z")) : "";
      const values = {
        roasting: [kg(production.roastedKg) + " roasted", Number.isFinite(production.scheduledKg) ? "+ " + kg(production.scheduledKg) + " scheduled" : "Scheduled unavailable"],
        green: [green.location === "Marrickville" ? kg(green.kg) : "Reading unavailable"],
        packing: [Number.isFinite(packing.kgPerHour) ? num(packing.kgPerHour) + " kg/h" : Number.isFinite(packing.packedKg) ? kg(packing.packedKg) + " packed" : "Reading unavailable"],
        dispatch: [num(wholesale.done) + " done · " + num(pending) + " pending" + (wholesale.provisional ? "*" : "")],
        lab: [signature ? signature.name + " " + money(signature.pricePerKg, true) + "/kg" : "Prices unavailable"],
        purchases: [next ? "Next " + nextDate : data?.lab?.purchases?.status === "unavailable" ? "Data unavailable" : "No planned orders"]
      };
      for (const zone of zones) {
        if (zone.id === "overview") continue;
        const pin = el("pins").querySelector('[data-zone="' + zone.id + '"]');
        const text = pin.firstElementChild;
        text.replaceChildren(node("span", zone.name, "pin-label"));
        const lines = data ? values[zone.id] : [];
        lines.forEach((line, index) => text.append(node("span", line, index ? "pin-extra" : "pin-value")));
        pin.setAttribute("aria-label", "View " + zone.name + " figures" + (lines.length ? ", " + lines.join(", ") : ""));
        pin.title = zone.name + (lines.length ? " · " + lines.join(" · ") : "");
      }
    }
    function positionPins() {
      if (!scene || sceneFailed || !signedIn || !sceneVisible || document.hidden) return;
      let positions;
      try {
        positions = scene.projectPins();
      } catch {
        return;
      }
      const occupied = [];
      const width = el("pins").clientWidth, height = el("pins").clientHeight;
      const ordered = [...(positions || [])].sort((left, right) => Number(right.id === selected) - Number(left.id === selected));
      for (const position of ordered) {
        const button = el("pins").querySelector('[data-zone="' + position.id + '"]');
        if (!button) continue;
        const visible = position.visible && Number.isFinite(position.x) && Number.isFinite(position.y);
        button.hidden = !visible;
        if (!visible) continue;
        const halfWidth = button.offsetWidth / 2, halfHeight = button.offsetHeight / 2;
        const x = Math.max(halfWidth + 7, Math.min(width - halfWidth - 7, position.x));
        let placement;
        for (const offset of [0, -44, 44, -88, 88]) {
          const y = Math.max(halfHeight + 52, Math.min(height - halfHeight - 60, position.y + offset));
          const box = { left: x - halfWidth - 4, right: x + halfWidth + 4, top: y - halfHeight - 4, bottom: y + halfHeight + 4 };
          if (occupied.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
          placement = { x, y, box };
          break;
        }
        button.hidden = !placement;
        if (placement) {
          occupied.push(placement.box);
          button.style.left = placement.x + "px";
          button.style.top = placement.y + "px";
        }
      }
    }
    function pinsLoop(now) {
      pinsFrame = null;
      if (!signedIn || !scene || sceneFailed || !sceneVisible || document.hidden) return;
      if (now - pinsTime > 80) {
        positionPins();
        pinsTime = now;
      }
      pinsFrame = requestAnimationFrame(pinsLoop);
    }
    function pauseState() {
      scene?.setPaused(paused || motion.matches || document.hidden || !sceneVisible || sceneFailed);
      el("pause").disabled = sceneFailed || motion.matches;
      el("pause").textContent = motion.matches ? "Reduced motion" : paused ? "Resume activity" : "Pause activity";
      el("pause").title = motion.matches ? "Activity is paused because reduced motion is enabled." : "Pause or resume illustrative activity";
      el("pause").setAttribute("aria-pressed", String(paused || motion.matches));
      if (pinsFrame !== null) cancelAnimationFrame(pinsFrame);
      pinsFrame = null;
      if (signedIn && scene && !sceneFailed && sceneVisible && !document.hidden) pinsFrame = requestAnimationFrame(pinsLoop);
    }
    function sceneError() {
      sceneFailed = true;
      el("sceneMessage").hidden = false;
      el("sceneMessage").classList.add("failed");
      el("sceneMessageTitle").textContent = "3D view unavailable";
      el("sceneMessageBody").textContent = "Choose a zone below to read the dashboard figures.";
      el("pause").disabled = true;
      el("reset").disabled = true;
      el("pins").querySelectorAll("button").forEach((button) => button.hidden = true);
      renderPinMetrics();
      pauseState();
    }
    async function startScene() {
      if (scene || scenePromise || !signedIn) return;
      const generation = sessionGeneration;
      sceneFailed = false;
      el("sceneMessage").hidden = false;
      el("sceneMessage").classList.remove("failed");
      el("sceneMessageTitle").textContent = "Opening the roastery";
      el("sceneMessageBody").textContent = "Your dashboard figures will appear alongside the scene.";
      el("pause").disabled = el("reset").disabled = false;
      const current = import("/warehouse-scene.js");
      scenePromise = current;
      try {
        const { createWarehouseScene } = await current;
        if (!signedIn || generation !== sessionGeneration) return;
        const next = createWarehouseScene({
          container: el("sceneCanvas"),
          reducedMotion: motion.matches,
          onSelect: (id) => {
            if (signedIn) selectZone(id, { focus: true, moveCamera: false });
          },
          onReady: () => {
            if (signedIn && generation === sessionGeneration && !sceneFailed) {
              el("sceneMessage").hidden = true;
              positionPins();
            }
          },
          onError: () => {
            if (signedIn && generation === sessionGeneration) sceneError();
          }
        });
        if (!signedIn || generation !== sessionGeneration) {
          next?.dispose();
          return;
        }
        scene = next;
        if (data) {
          try {
            scene.setData(data);
          } catch {
            sceneError();
          }
        }
        pauseState();
      } catch {
        if (signedIn && generation === sessionGeneration) sceneError();
      } finally {
        if (scenePromise === current) scenePromise = null;
        if (signedIn && generation !== sessionGeneration) startScene();
      }
    }
    function setMessage(id, text) {
      const item = el(id);
      item.textContent = text;
      item.hidden = !text;
    }
    function clearReport() {
      data = null;
      renderWeather();
      for (const id of ["statDemand", "statRoasted", "statDispatch"]) el(id).textContent = "—";
      el("reportTime").replaceChildren();
      el("statRoastSource").textContent = "Cropster";
      el("statDispatchSource").textContent = "Dispatch";
      el("zoneDetails").replaceChildren(empty("Dashboard figures are loading."));
      setMessage("status", "");
      if (scene) {
        scene.dispose();
        scene = null;
      }
      if (pinsFrame !== null) cancelAnimationFrame(pinsFrame);
      pinsFrame = null;
      el("sceneCanvas").replaceChildren();
      el("pins").querySelectorAll("button").forEach((button) => button.hidden = true);
      renderPinMetrics();
    }
    function showSession(authenticated) {
      if (signedIn !== authenticated) sessionGeneration++;
      signedIn = authenticated;
      el("opening").hidden = true;
      el("login").hidden = authenticated;
      el("warehouse").hidden = !authenticated;
      el("pageActions").hidden = !authenticated;
      if (!authenticated) {
        activeRequest?.abort();
        activeRequest = null;
        el("refresh").disabled = false;
        el("refresh").textContent = "Refresh";
        clearReport();
      } else {
        startScene();
        pauseState();
      }
    }
    function renderData() {
      const { demand = {}, production = {}, wholesale = {} } = weeklyMetrics();
      el("statDemand").textContent = kg(demand.kg);
      el("statRoasted").textContent = kg(production.roastedKg);
      el("statDispatch").textContent = num(wholesale.done);
      const cropsterDate = date(production.asOf, true);
      el("statRoastSource").textContent = cropsterDate ? "Cropster saved " + cropsterDate : "Cropster reading unavailable";
      el("statDispatchSource").textContent = wholesale.provisional ? "Provisional weekly schedule" : "Dispatch";
      const timestamp = date(data.generatedAt, true);
      el("reportTime").replaceChildren(node("strong", weekLabel()), document.createTextNode(timestamp ? "Dashboard read " + timestamp + " Sydney time" : ""));
      renderPanel(true);
      renderWeather();
      renderPinMetrics();
      try {
        scene?.setData(data);
      } catch {
        sceneError();
      }
      positionPins();
    }
    async function readJson(response) {
      return response.json().catch(() => ({}));
    }
    async function load(manual = false, { fresh = manual } = {}) {
      if (!signedIn || activeRequest && !fresh) return;
      activeRequest?.abort();
      const generation = sessionGeneration;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 35e3);
      el("refresh").disabled = true;
      el("refresh").textContent = fresh ? "Refreshing…" : "Refresh";
      if (manual || !data) setMessage("status", "Refreshing dashboard figures…");
      try {
        const response = await fetch("/api/warehouse" + (fresh ? "?refresh=1" : ""), { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const next = await readJson(response);
        if (activeRequest !== controller || generation !== sessionGeneration || !signedIn) return;
        if (response.status === 401) {
          showSession(false);
          setMessage("loginMessage", "Your session ended. Sign in again to read the dashboard.");
          return;
        }
        if (!response.ok || !next.weekly || !next.lab) throw new Error("Dashboard figures could not be loaded.");
        data = next;
        renderData();
        setMessage("status", "");
        if (fresh) {
          const checked = new Date(next.generatedAt || Date.now()).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", second: "2-digit" });
          el("reportTime").replaceChildren(node("strong", weekLabel()), document.createTextNode("Refresh complete. Checked " + checked + " Sydney time"));
        }
      } catch {
        if (activeRequest === controller && generation === sessionGeneration && signedIn) {
          const timestamp = date(data?.generatedAt, true);
          setMessage("status", data ? "Refresh failed. Showing the last dashboard read" + (timestamp ? " from " + timestamp + " Sydney time" : "") + ". Use Refresh to try again." : "Dashboard figures could not be loaded. Use Refresh to try again.");
        }
      } finally {
        clearTimeout(timeout);
        if (activeRequest === controller) {
          activeRequest = null;
          el("refresh").disabled = false;
          el("refresh").textContent = "Refresh";
        }
      }
    }
    el("zoneNav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-zone]");
      if (button) selectZone(button.dataset.zone, { focus: true });
    });
    el("pins").addEventListener("click", (event) => {
      const button = event.target.closest("[data-zone]");
      if (button) selectZone(button.dataset.zone, { focus: true });
    });
    el("zoneDetails").addEventListener("click", (event) => {
      const offset = event.target.closest("[data-month-offset]");
      if (offset) {
        const date2 = /* @__PURE__ */ new Date(purchaseMonth + "-01T12:00:00Z");
        date2.setUTCMonth(date2.getUTCMonth() + Number(offset.dataset.monthOffset));
        purchaseMonth = date2.toISOString().slice(0, 7);
        purchaseDay = purchaseMonth + "-01";
        renderPanel(true);
        el("zoneDetails").querySelector('[data-month-offset="' + offset.dataset.monthOffset + '"]')?.focus({ preventScroll: true });
        return;
      }
      const day = event.target.closest("[data-purchase-date]");
      if (day) {
        purchaseDay = day.dataset.purchaseDate;
        renderPanel(true);
        el("zoneDetails").querySelector('[data-purchase-date="' + purchaseDay + '"]')?.focus({ preventScroll: true });
      }
    });
    el("pause").addEventListener("click", () => {
      paused = !paused;
      pauseState();
    });
    el("reset").addEventListener("click", () => selectZone("overview"));
    el("refresh").addEventListener("click", () => load(true));
    el("signInForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      el("signIn").disabled = true;
      setMessage("loginMessage", "");
      try {
        const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ password: el("password").value }) });
        const reply = await readJson(response);
        if (!response.ok || !reply.authenticated) {
          setMessage("loginMessage", reply.error || "Sign-in could not be completed. Check the Stock Take App password.");
          return;
        }
        showSession(true);
        el("warehouse").focus({ preventScroll: true });
        load();
      } catch {
        setMessage("loginMessage", "The sign-in service could not be reached. Try again.");
      } finally {
        el("password").value = "";
        el("signIn").disabled = false;
      }
    });
    el("logout").addEventListener("click", async () => {
      el("logout").disabled = true;
      try {
        const response = await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) throw new Error();
        showSession(false);
        setMessage("loginMessage", "");
        el("password").focus();
      } catch {
        if (signedIn) setMessage("status", "Sign-out could not be completed. Try again.");
      } finally {
        el("logout").disabled = false;
      }
    });
    const observer = new IntersectionObserver((entries) => {
      sceneVisible = entries.some((entry) => entry.isIntersecting);
      pauseState();
    }, { threshold: 0.01 });
    observer.observe(el("sceneStage"));
    document.addEventListener("visibilitychange", () => {
      pauseState();
      if (!document.hidden && signedIn && !activeRequest) load();
    });
    motion.addEventListener("change", () => {
      scene?.setReducedMotion?.(motion.matches);
      if (motion.matches) paused = true;
      pauseState();
    });
    const refreshTimer = setInterval(() => {
      if (signedIn && !document.hidden && !activeRequest) load();
    }, 6e4);
    const clockTimer = setInterval(updateClock, 1000);
    window.addEventListener("pagehide", () => {
      activeRequest?.abort();
      scene?.dispose();
      scene = null;
      if (pinsFrame !== null) cancelAnimationFrame(pinsFrame);
      pinsFrame = null;
      observer.disconnect();
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) window.location.reload();
    });
    makeZoneControls();
    makeClockMarks();
    updateClock();
    pauseState();
    fetch("/api/auth", { cache: "no-store", credentials: "same-origin" }).then(readJson).then((reply) => {
      showSession(reply.authenticated === true);
      if (signedIn) load();
    }).catch(() => {
      showSession(false);
      setMessage("loginMessage", "The sign-in service could not be reached. Try signing in again.");
    });
  </script>
</body>
</html>`;
