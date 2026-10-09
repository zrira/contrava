import { spawn } from 'node:child_process';

const workspaces = [
  '@contrava/web',
  '@contrava/api',
  '@contrava/spec-worker',
  '@contrava/scan-worker',
  '@contrava/scan-runner',
  '@contrava/repo-scan-runner',
];
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = workspaces.map((workspace) =>
  spawn(command, ['run', 'dev', '-w', workspace], { stdio: 'inherit', env: process.env }),
);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping && code) {
      process.exitCode = code;
      stop('SIGTERM');
    }
  });
}
