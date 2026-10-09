import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
if (!process.env.RABBITMQ_URL) throw new Error('RABBITMQ_URL is required');
const database = new URL(url).pathname.replace(/^\//, '');
if (!database.toLowerCase().includes('test')) throw new Error(`Refusing to reset non-test database: ${database}`);
const env = { ...process.env, DATABASE_URL: url, RABBITMQ_INTEGRATION: '1', RABBITMQ_TOPOLOGY_PREFIX: `contrava-test-${randomUUID()}` };
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [
  ['run', 'prisma:generate', '-w', '@contrava/api'],
  ['exec', '-w', '@contrava/api', '--', 'prisma', 'migrate', 'reset', '--force'],
  ['exec', '-w', '@contrava/api', '--', 'vitest', 'run', 'src/jobs/rabbitmq.integration.test.ts'],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
