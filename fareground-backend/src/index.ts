/**
 * Server entry point: check the database, start listening, shut down cleanly.
 */
import { createApp } from './app';
import { config } from './config/env';
import { assertDatabaseConnection, pool } from './db/pool';
import { startNotificationLoop } from './services/notify.service';

async function main(): Promise<void> {
  // Fail fast and loudly if the database is unreachable - much better than
  // booting "successfully" and then erroring on every request.
  await assertDatabaseConnection();
  console.log('[db] Connected to PostgreSQL.');

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[api] Fareground backend listening on http://localhost:${config.port}`);
    console.log(`[api] Environment: ${config.nodeEnv}`);
    if (config.devLuckyEmails.length > 0) {
      console.warn(`[api] TESTING: every claim is a RUBY for ${config.devLuckyEmails.join(', ')}`);
    }
  });

  // Streak reminders, the morning chest and win-backs. Runs in-process on a
  // timer under a Postgres advisory lock, so a second instance is harmless.
  const notifications = startNotificationLoop();

  /**
   * Graceful shutdown: when the process is asked to stop (Ctrl+C, or a deploy
   * replacing the container), finish in-flight requests and close the database
   * pool instead of cutting everything off mid-transaction.
   */
  const shutdown = (signal: string) => {
    console.log(`\n[api] ${signal} received, shutting down...`);

    notifications.stop();

    server.close(() => {
      pool
        .end()
        .then(() => {
          console.log('[api] Shutdown complete.');
          process.exit(0);
        })
        .catch((error) => {
          console.error('[api] Error closing the database pool:', error);
          process.exit(1);
        });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] Failed to start:', error);
  process.exit(1);
});
