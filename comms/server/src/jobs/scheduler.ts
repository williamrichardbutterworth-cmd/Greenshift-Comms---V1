import cron from 'node-cron';
import { getDailyReview } from '../services/dailyReview';

// Warms the daily brief each weekday morning so agents open the app to a
// freshly generated review (cached, so all users share one generation).
export function startScheduler(): void {
  // 07:00, Mon–Fri, server local time.
  cron.schedule('0 7 * * 1-5', async () => {
    try {
      await getDailyReview(true);
      console.log('[scheduler] daily review refreshed');
    } catch (err) {
      console.warn('[scheduler] daily review failed:', (err as Error).message);
    }
  });
  console.log('[scheduler] daily brief scheduled for 07:00 Mon–Fri');
}
