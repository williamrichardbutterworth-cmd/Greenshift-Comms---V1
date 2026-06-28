// GREEN SHIFT · TEMPLATE 01 — COST COMPARISON REPORT (tokenised)
// The user's pixel-perfect HTML, verbatim CSS, with dynamic regions turned into
// {{tokens}} and the market table rebuilt as a {{#each quotes}} repeatable row.
export const COST_COMPARISON_HTML = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cost Comparison Report — Green Shift Energy Consulting</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --green:#40A800;
    --green-dark:#318300;
    --green-tint:rgba(64,168,0,.08);
    --green-tint-strong:rgba(64,168,0,.14);
    --ink:#2B2A2E;
    --ink-60:#6c6b70;
    --ink-40:#9a999e;
    --line:#e7e6e3;
    --line-strong:#d8d7d3;
    --paper:#ffffff;
    --backdrop:#eceae6;
    --sans:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;}
  body{
    font-family:var(--sans);
    color:var(--ink);
    background:var(--backdrop);
    -webkit-font-smoothing:antialiased;
    line-height:1.5;
    padding:32px 16px;
  }
  .sheet{
    background:var(--paper);
    max-width:840px;
    margin:0 auto;
    padding:56px 60px 40px;
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 18px 50px rgba(0,0,0,.08);
    border-radius:2px;
  }

  /* ---------- masthead ---------- */
  .masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;}
  .brand{display:flex;align-items:center;gap:12px;}
  .mark{width:34px;height:34px;flex:none;}
  .wordmark{font-weight:600;font-size:18px;letter-spacing:-.02em;line-height:1;}
  .wordmark .sub{display:block;font-family:var(--mono);font-weight:400;font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-60);margin-top:5px;}
  .meta{font-family:var(--mono);font-size:10.5px;line-height:1.7;text-align:right;color:var(--ink-60);}
  .meta b{color:var(--ink);font-weight:500;}
  .rule{height:2px;background:var(--green);margin:18px 0 30px;border:0;}

  /* ---------- title ---------- */
  .eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--green-dark);font-weight:500;}
  h1{font-size:30px;font-weight:600;letter-spacing:-.02em;margin:8px 0 4px;line-height:1.08;}
  .lede{color:var(--ink-60);font-size:14px;margin:0;}

  /* ---------- client strip ---------- */
  .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:28px 0 34px;}
  .strip > div{background:var(--paper);padding:13px 16px;}
  .strip .k{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-40);margin-bottom:4px;}
  .strip .v{font-size:14px;font-weight:500;}
  .strip .v.mono{font-family:var(--mono);}

  /* ---------- sections ---------- */
  section{margin:0 0 34px;}
  .sec-head{display:flex;align-items:baseline;gap:12px;margin-bottom:14px;}
  .sec-head .eyebrow{white-space:nowrap;}
  .sec-head .hr{flex:1;height:1px;background:var(--line);}
  p{margin:0 0 12px;font-size:13.5px;}
  p:last-child{margin-bottom:0;}

  /* ---------- summary + saving ---------- */
  .summary{display:grid;grid-template-columns:1fr 280px;gap:32px;align-items:stretch;}
  .saving{background:var(--ink);color:#fff;border-radius:10px;padding:24px 26px;display:flex;flex-direction:column;justify-content:center;}
  .saving .lab{font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.62);}
  .saving .fig{font-family:var(--mono);font-weight:600;font-size:40px;color:var(--green);line-height:1;margin:10px 0 2px;letter-spacing:-.02em;}
  .saving .pct{font-size:13px;color:rgba(255,255,255,.85);font-weight:500;}
  .saving .term{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.16);font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.7);}
  .saving .term b{color:#fff;font-weight:500;}

  /* ---------- tables ---------- */
  table{width:100%;border-collapse:collapse;font-size:12.5px;}
  caption{display:none;}
  thead th{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60);font-weight:500;text-align:right;padding:0 12px 9px;border-bottom:1.5px solid var(--ink);}
  thead th.l{text-align:left;}
  tbody td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:right;vertical-align:middle;}
  tbody td.l{text-align:left;}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;}
  .supplier{font-weight:600;font-size:13px;}
  .product{color:var(--ink-60);font-size:11px;font-family:var(--mono);}

  tr.rec td{background:var(--green-tint);border-bottom:1px solid var(--green-tint-strong);}
  tr.rec td.l{box-shadow:inset 3px 0 0 var(--green);}
  .pill{display:inline-block;font-family:var(--mono);font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#fff;background:var(--green-dark);padding:3px 7px;border-radius:100px;vertical-align:middle;margin-left:8px;}
  .delta-pos{color:var(--green-dark);font-weight:600;}
  .delta-neg{color:var(--ink-60);}

  .current-table tbody td{border-bottom:1px solid var(--line);}

  /* ---------- recommendation ---------- */
  .reco{border:1px solid var(--line-strong);border-left:3px solid var(--green);border-radius:8px;padding:22px 24px;background:#fcfdfb;}
  .reco h3{margin:0 0 8px;font-size:15px;font-weight:600;}
  .steps{counter-reset:step;list-style:none;margin:8px 0 0;padding:0;}
  .steps li{position:relative;padding:0 0 12px 34px;font-size:13px;color:var(--ink);}
  .steps li:last-child{padding-bottom:0;}
  .steps li::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:-1px;width:22px;height:22px;border-radius:50%;background:var(--green-tint-strong);color:var(--green-dark);font-family:var(--mono);font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;}

  /* ---------- notes ---------- */
  .notes{font-size:11px;color:var(--ink-60);line-height:1.65;}
  .notes li{margin-bottom:4px;}

  /* ---------- footer ---------- */
  footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:24px;align-items:flex-start;}
  .compliance{font-size:9.5px;color:var(--ink-40);line-height:1.6;max-width:560px;}
  .compliance b{color:var(--ink-60);font-weight:500;}
  .foot-brand{font-family:var(--mono);font-size:9.5px;color:var(--ink-40);text-align:right;white-space:nowrap;}

  @media (max-width:680px){
    .sheet{padding:32px 22px;}
    .summary{grid-template-columns:1fr;}
    .strip{grid-template-columns:repeat(2,1fr);}
    h1{font-size:24px;}
    .masthead{flex-direction:column;}
    .meta{text-align:left;}
    table{font-size:11px;}
  }
  @media print{
    body{background:#fff;padding:0;}
    .sheet{box-shadow:none;max-width:none;padding:0;border-radius:0;}
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
      <div>Report <b>{{reportRef}}</b></div>
      <div>Issued <b>{{issueDate}}</b></div>
      <div>Valid until <b>{{validUntil}}</b></div>
    </div>
  </header>

  <hr class="rule">

  <div class="eyebrow">Cost Comparison &amp; Recommendation</div>
  <h1>{{reportTitle}}</h1>
  <p class="lede">Prepared for {{clientName}} &middot; {{ledeNote}}</p>

  <div class="strip">
    <div><div class="k">Prepared for</div><div class="v">{{clientName}}</div></div>
    <div><div class="k">Annual consumption</div><div class="v mono">{{annualKwhLabel}}</div></div>
    <div><div class="k">Current contract ends</div><div class="v mono">{{contractEndDate}}</div></div>
    <div><div class="k">Consultant</div><div class="v">{{consultantName}}</div></div>
  </div>

  <section>
    <div class="summary">
      <div>
        <div class="sec-head"><span class="eyebrow">Summary</span><span class="hr"></span></div>
        <p>{{summaryCurrent}}</p>
        <p>{{summaryRecommended}}</p>
      </div>
      <div class="saving">
        <div class="lab">Estimated annual saving</div>
        <div class="fig">&pound;{{annualSaving}}</div>
        <div class="pct">{{savingPct}} vs. {{savingBasis}}</div>
        <div class="term">{{termYears}}-year value <b>&pound;{{termSaving}}</b></div>
      </div>
    </div>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">Your current position</span><span class="hr"></span></div>
    <table class="current-table">
      <thead>
        <tr>
          <th class="l">Supplier &amp; product</th>
          <th>Unit rate</th>
          <th>Standing charge</th>
          <th>Contract status</th>
          <th>Annual cost</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="l"><span class="supplier">{{currentSupplier}}</span><br><span class="product">{{currentProduct}}</span></td>
          <td class="num">{{currentUnitRate}} <span style="color:var(--ink-40)">p</span></td>
          <td class="num">{{currentStanding}} <span style="color:var(--ink-40)">p/day</span></td>
          <td class="num" style="text-align:right;color:var(--ink-60)">{{currentTermStatus}}</td>
          <td class="num" style="font-weight:600">&pound;{{currentAnnualCost}}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">The market — quotes returned</span><span class="hr"></span></div>
    <table>
      <thead>
        <tr>
          <th class="l">Supplier &amp; term</th>
          <th>Unit rate<br><span style="font-weight:400;text-transform:none;letter-spacing:0">p/kWh</span></th>
          <th>Standing<br><span style="font-weight:400;text-transform:none;letter-spacing:0">p/day</span></th>
          <th>Annual cost</th>
          <th>vs. current</th>
        </tr>
      </thead>
      <tbody>
        {{#each quotes}}
        <tr class="{{rowClass}}">
          <td class="l"><span class="supplier">{{supplier}}</span>{{{recPill}}}<br><span class="product">{{term}}</span></td>
          <td class="num">{{unitRate}}</td>
          <td class="num">{{standing}}</td>
          <td class="num" style="font-weight:600">&pound;{{annualCost}}</td>
          <td class="num {{deltaClass}}">{{{deltaText}}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">Our recommendation</span><span class="hr"></span></div>
    <div class="reco">
      <h3>{{recommendationTitle}}</h3>
      <p>{{recommendationRationale}}</p>
      <p style="margin-bottom:0;font-weight:500">To proceed:</p>
      <ol class="steps">
        <li>{{step1}}</li>
        <li>{{step2}}</li>
        <li>{{step3}}</li>
      </ol>
    </div>
  </section>

  <section>
    <div class="sec-head"><span class="eyebrow">Basis &amp; assumptions</span><span class="hr"></span></div>
    <ul class="notes">
      <li>Prices based on annual consumption of {{annualKwhLabel}} taken from your latest bill and meter data. Actual costs vary with usage.</li>
      <li>All rates and costs shown {{taxBasis}}</li>
      <li>Quotes are indicative and subject to supplier credit check and acceptance. Prices held until {{validUntil}}.</li>
      <li>Saving is calculated against your projected out-of-contract cost; saving against a renewal offer from your existing supplier may differ.</li>
    </ul>
  </section>

  <footer>
    <div class="compliance">
      <b>Green Shift Energy Consulting</b> acts as a third-party intermediary on your behalf. We may receive a commission from the supplier on contracts arranged through us; the amount will be disclosed to you in writing on request and before you sign.
      {{complianceRegistration}} Questions or complaints: {{complaintsEmail}}.
    </div>
    <div class="foot-brand">greenshiftenergy.co.uk<br>Page 1 of 1</div>
  </footer>

</div>
</body>
</html>`;
