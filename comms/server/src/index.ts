import { buildApp } from './app';
import { config } from './config';
import { startScheduler } from './jobs/scheduler';

// Local development entry point: a long-running server + the cron scheduler.
// (On Vercel the app is served by a serverless function instead — see /api.)
async function main() {
  const app = await buildApp();
  startScheduler();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Comms API listening on http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
