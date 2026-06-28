// GREEN SHIFT · TEMPLATE 02 — PROCUREMENT / MARKET REPORT (tokenised)
// The user's pixel-perfect HTML, verbatim CSS. Market figures + deltas are tokens;
// the 12-month trend SVG is generated from the real power series → {{{trendSvg}}}.
export const PROCURE_AHEAD_HTML = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market Brief &amp; Procurement Outlook — Green Shift Energy Consulting</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --green:#40A800;--green-dark:#318300;
    --green-tint:rgba(64,168,0,.08);--green-tint-strong:rgba(64,168,0,.14);
    --ink:#2B2A2E;--ink-60:#6c6b70;--ink-40:#9a999e;
    --amber:#b5790a;
    --line:#e7e6e3;--line-strong:#d8d7d3;
    --paper:#fff;--backdrop:#eceae6;
    --sans:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;}
  body{font-family:var(--sans);color:var(--ink);background:var(--backdrop);-webkit-font-smoothing:antialiased;line-height:1.5;padding:32px 16px;}
  .sheet{background:var(--paper);max-width:840px;margin:0 auto;padding:56px 60px 40px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 18px 50px rgba(0,0,0,.08);border-radius:2px;}

  .masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;}
  .brand{display:flex;align-items:center;gap:12px;}
  .mark{width:34px;height:34px;flex:none;}
  .wordmark{font-weight:600;font-size:18px;letter-spacing:-.02em;line-height:1;}
  .wordmark .sub{display:block;font-family:var(--mono);font-weight:400;font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-60);margin-top:5px;}
  .meta{font-family:var(--mono);font-size:10.5px;line-height:1.7;text-align:right;color:var(--ink-60);}
  .meta b{color:var(--ink);font-weight:500;}
  .rule{height:2px;background:var(--green);margin:18px 0 30px;border:0;}

  .eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--green-dark);font-weight:500;}
  h1{font-size:30px;font-weight:600;letter-spacing:-.02em;margin:8px 0 4px;line-height:1.08;}
  .lede{color:var(--ink-60);font-size:14px;margin:0;}

  section{margin:0 0 34px;}
  .sec-head{display:flex;align-items:baseline;gap:12px;margin-bottom:14px;}
  .sec-head .hr{flex:1;height:1px;background:var(--line);}
  p{margin:0 0 12px;font-size:13.5px;}
  p:last-child{margin-bottom:0;}

  /* metric cards */
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:28px 0 8px;}
  .card{background:var(--paper);padding:16px 16px 14px;}
  .card .k{font-family:var(--mono);font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-40);line-height:1.4;min-height:24px;}
  .card .v{font-family:var(--mono);font-weight:600;font-size:23px;letter-spacing:-.01em;margin:6px 0 4px;}
  .card .u{font-size:11px;color:var(--ink-40);font-weight:400;}
  .card .d{font-family:var(--mono);font-size:11px;font-weight:500;display:flex;align-items:center;gap:4px;}
  .down{color:var(--green-dark);}
  .up{color:var(--amber);}
  .arrow{font-size:10px;}
  .cards-note{font-family:var(--mono);font-size:9px;color:var(--ink-40);text-align:right;margin:0 2px 0 0;}

  /* chart */
  .chartwrap{border:1px solid var(--line);border-radius:8px;padding:20px 22px 16px;margin-top:6px;}
  .chart-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
  .chart-title{font-size:13px;font-weight:600;}
  .chart-legend{font-family:var(--mono);font-size:9.5px;color:var(--ink-60);display:flex;align-items:center;gap:6px;}
  .swatch{width:14px;height:2.5px;background:var(--green);display:inline-block;border-radius:2px;}
  .chart-cap{font-size:10.5px;color:var(--ink-60);margin-top:8px;}
  svg.trend{width:100%;height:auto;display:block;}
  .gridline{stroke:var(--line);stroke-width:1;}
  .axislab{font-family:'IBM Plex Mono',monospace;font-size:9px;fill:var(--ink-40);}
  .monthlab{font-family:'IBM Plex Mono',monospace;font-size:8.5px;fill:var(--ink-40);text-anchor:middle;}
  .series{fill:none;stroke:var(--green);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round;}
  .area{fill:url(#g);stroke:none;}
  .dot{fill:#fff;stroke:var(--green);stroke-width:2.4;}
  .nowlab{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;fill:var(--green-dark);}

  /* recommendation */
  .reco{border:1px solid var(--line-strong);border-left:3px solid var(--green);border-radius:8px;padding:22px 24px;background:#fcfdfb;}
  .reco .tag{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:var(--green-dark);padding:4px 9px;border-radius:100px;display:inline-block;}
  .reco h3{margin:12px 0 8px;font-size:16px;font-weight:600;}
  .talking{margin:14px 0 0;padding:0;list-style:none;}
  .talking li{position:relative;padding:0 0 9px 22px;font-size:12.5px;}
  .talking li:last-child{padding-bottom:0;}
  .talking li::before{content:"";position:absolute;left:2px;top:7px;width:6px;height:6px;border-radius:2px;background:var(--green);}

  footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:24px;align-items:flex-start;}
  .compliance{font-size:9.5px;color:var(--ink-40);line-height:1.6;max-width:560px;}
  .compliance b{color:var(--ink-60);font-weight:500;}
  .foot-brand{font-family:var(--mono);font-size:9.5px;color:var(--ink-40);text-align:right;white-space:nowrap;}

  @media (max-width:680px){
    .sheet{padding:32px 22px;}
    .cards{grid-template-columns:repeat(2,1fr);}
    h1{font-size:24px;}
    .masthead{flex-direction:column;}
    .meta{text-align:left;}
  }
  @media print{
    body{background:#fff;padding:0;}
    .sheet{box-shadow:none;max-width:none;padding:0;}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    @page{size:A4;margin:16mm;}
  }
</style>
</head>
<body>
<div class="sheet">

  <header class="masthead">
    <div class="brand">
      <svg class="mark" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="34" height="34" rx="8" fill="#40A800"/>
        <path d="M11 9.5l6 7-6 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M17.5 9.5l6 7-6 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>
      </svg>
      <div class="wordmark">Green Shift<span class="sub">Energy Consulting</span></div>
    </div>
    <div class="meta">
      <div>Brief <b>{{reportRef}}</b></div>
      <div>Week of <b>{{weekOf}}</b></div>
      <div>Prepared for <b>{{clientName}}</b></div>
    </div>
  </header>

  <hr class="rule">

  <div class="eyebrow">Wholesale Market Intelligence</div>
  <h1>Market Brief &amp; Procurement Outlook</h1>
  <p class="lede">{{briefSubtitle}}</p>

  <section style="margin-bottom:8px">
    <div class="cards">
      <div class="card">
        <div class="k">Front-year baseload power</div>
        <div class="v">&pound;{{frontYearPower}}<span class="u"> /MWh</span></div>
        <div class="d {{frontYearDir}}"><span class="arrow">{{{frontYearArrow}}}</span>{{frontYearDelta}}</div>
      </div>
      <div class="card">
        <div class="k">Day-ahead power</div>
        <div class="v">&pound;{{dayAheadPower}}<span class="u"> /MWh</span></div>
        <div class="d {{dayAheadDir}}"><span class="arrow">{{{dayAheadArrow}}}</span>{{dayAheadDelta}}</div>
      </div>
      <div class="card">
        <div class="k">NBP gas (front-month)</div>
        <div class="v">{{gasPrice}}<span class="u"> p/th</span></div>
        <div class="d {{gasDir}}"><span class="arrow">{{{gasArrow}}}</span>{{gasDelta}}</div>
      </div>
      <div class="card">
        <div class="k">Brent crude (context)</div>
        <div class="v">$&#8203;{{brent}}<span class="u"> /bbl</span></div>
        <div class="d {{brentDir}}"><span class="arrow">{{{brentArrow}}}</span>{{brentDelta}}</div>
      </div>
    </div>
    <p class="cards-note">Source: Elexon BMRS, National Gas, market feeds &middot; {{asOf}}</p>
  </section>

  <section>
    <div class="chartwrap">
      <div class="chart-head">
        <div class="chart-title">UK power &mdash; 12-month trend</div>
        <div class="chart-legend"><span class="swatch"></span> &pound;/MWh</div>
      </div>
      {{{trendSvg}}}
      <p class="chart-cap">{{chartCaption}}</p>
    </div>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">What's moving the market</span><span class="hr"></span></div>
    <p>{{commentaryDrivers}}</p>
    <p>{{commentaryOutlook}}</p>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">What this means for you</span><span class="hr"></span></div>
    <p>{{implication}}</p>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">Our view</span><span class="hr"></span></div>
    <div class="reco">
      <span class="tag">{{stanceTag}}</span>
      <h3>{{stanceHeadline}}</h3>
      <p style="margin-bottom:0">{{stanceRationale}}</p>
      <ul class="talking">
        <li>{{talkingPoint1}}</li>
        <li>{{talkingPoint2}}</li>
        <li>{{talkingPoint3}}</li>
        <li>{{talkingPoint4}}</li>
      </ul>
    </div>
  </section>

  <footer>
    <div class="compliance">
      <b>Market data and commentary are provided for general guidance only</b> and do not constitute a personal recommendation to trade or hedge. Figures are indicative and sourced from third-party market feeds. {{complianceRegistration}}
    </div>
    <div class="foot-brand">greenshiftenergy.co.uk<br>Weekly Brief</div>
  </footer>

</div>
</body>
</html>`;
