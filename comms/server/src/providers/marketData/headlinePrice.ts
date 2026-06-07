import { config } from '../../config';
import { fetchJson } from '../../lib/http';
import type { MarketDataProvider, Metric, SourceRef } from './types';

// Optional FREE headline UK gas price via OilPriceAPI (free key tier).
// https://www.oilpriceapi.com — only runs if OILPRICE_API_KEY is set.
// Confirm the correct `by_code` value for UK natural gas and adjust if needed.

export class HeadlinePriceProvider implements MarketDataProvider {
  readonly name = 'headline-price';

  async getPartial(): Promise<{ metrics: Metric[]; sources: SourceRef[] }> {
    if (!config.oilPriceApiKey) return { metrics: [], sources: [] };
    try {
      const url = `https://api.oilpriceapi.com/v1/prices/latest?by_code=${encodeURIComponent(config.oilPriceGasCode)}`;
      const raw = await fetchJson<any>(url, {
        headers: { Authorization: `Token ${config.oilPriceApiKey}`, 'Content-Type': 'application/json' },
      });
      const price = Number(raw?.data?.price ?? raw?.price);
      if (Number.isNaN(price)) return { metrics: [], sources: [] };
      const metric: Metric = {
        id: 'nbp_gas',
        label: 'Wholesale gas (NBP)',
        value: Math.round(price * 100) / 100,
        unit: 'p/therm',
        changePct: null,
        sourceName: 'OilPriceAPI',
      };
      return {
        metrics: [metric],
        sources: [{ name: 'OilPriceAPI', url: 'https://www.oilpriceapi.com', attribution: 'Indicative price via OilPriceAPI.' }],
      };
    } catch (err) {
      console.warn('[headline-price] unavailable:', (err as Error).message);
      return { metrics: [], sources: [] };
    }
  }
}
