import { createServer } from 'node:http';
import { createApp } from './app.js';

const port = Number(process.env.SPEC_WORKER_PORT ?? 3001);
const server = createServer(createApp());
server.listen(port, () => console.info(`spec-worker listening on http://localhost:${port}`));

function shutdown(signal: string): void {
  console.info(`${signal} received; closing spec-worker`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
