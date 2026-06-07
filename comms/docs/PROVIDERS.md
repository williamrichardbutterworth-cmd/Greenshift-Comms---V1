# Providers — free today, paid when approved

Everything external is behind a small interface, so upgrading is additive: write a
new file, register it, add a key. Nothing else in the app changes.

---

## 1. Market data

**Interface:** `server/src/providers/marketData/types.ts` → `MarketDataProvider`
```ts
interface MarketDataProvider {
  name: string;
  getPartial(): Promise<{ metrics: Metric[]; sources: SourceRef[]; generationMix?: FuelShare[] }>;
}
```
The aggregator (`marketData/index.ts`) seeds **sample data**, then merges each provider's
metrics **over** it by `id`. Partial/failed sources are fine — gaps stay filled by samples.

### Free sources wired now
- **Elexon Insights / BMRS** (`elexon.ts`) — electricity prices, demand, generation mix. No key.
  Verify dataset paths at https://developer.data.elexon.co.uk. **Attribution required** (BMRS terms).
- **National Gas Data Portal** (`nationalGas.ts`) — gas demand/supply/storage/SAP. Open data, no key.
  Stubbed: wire the specific Data Items per https://data.nationalgas.com.
- **OilPriceAPI** (`headlinePrice.ts`) — optional free headline gas price. Add `OILPRICE_API_KEY`.

### Add a paid source (example: Trading Economics)
1. `server/src/providers/marketData/tradingEconomics.ts`:
   ```ts
   export class TradingEconomicsProvider implements MarketDataProvider {
     readonly name = 'trading-economics';
     async getPartial() {
       if (!config.tradingEconomicsKey) return { metrics: [], sources: [] };
       // fetch NBP gas, Brent, TTF, forecasts… map to Metric[] with stable ids
       return { metrics, sources: [{ name: 'Trading Economics', url: '…' }] };
     }
   }
   ```
2. Register it in `marketData/index.ts`'s `liveProviders` array (order = precedence; later wins).
3. Add `TRADING_ECONOMICS_KEY` to `.env`. Done.

Use a **stable `id`** (e.g. `nbp_gas`) and your paid value automatically overrides the sample/free one.

---

## 2. News

**Interface:** `server/src/providers/news/types.ts` → `NewsProvider`.
- Free now: `rss.ts` over the curated list in `feeds.ts`. Edit the list to curate.
- Paid drop-in (e.g. **Marketaux** for keyword search + sentiment): create `marketaux.ts`
  implementing `getItems(limit)`, then prefer it in `news/index.ts` when `MARKETAUX_API_KEY` is set,
  falling back to RSS, then sample.

---

## 3. AI engine

**Interface:** `server/src/providers/ai/types.ts` → `AIProvider` (`generateText`, `generateJSON`).
- `claude.ts` and `openai.ts` are both implemented. Switch with `AI_PROVIDER` in `.env`.
- To add another (e.g. a local/Azure model): implement `AIProvider`, branch in `ai/index.ts`.
- Keep all keys **server-side only** — the browser never sees them.

---

## 4. Word export (the `/api/report/docx` 501 stub)

The PDF path is complete. To add Word with **docxtemplater**:

```bash
cd server && npm i docxtemplater pizzip
```
1. Create a `report-template.docx` with `{executiveSummary}`, `{marketContext}`, `{outlook}`,
   `{recommendation}`, `{companyName}`, etc. as placeholders, styled with the brand + logo.
2. In `services/reportGenerator.ts` add `renderReportDocx(inputs, narrative)`:
   ```ts
   import PizZip from 'pizzip';
   import Docxtemplater from 'docxtemplater';
   import { readFileSync } from 'node:fs';
   const zip = new PizZip(readFileSync(templatePath));
   const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
   doc.render({ ...inputs, ...narrative });
   return doc.getZip().generate({ type: 'nodebuffer' });
   ```
3. Replace the 501 in `routes/report.ts` with the buffer + the `.docx` content type, and flip the
   web "Word (soon)" button to active.
