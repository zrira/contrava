import { extractApiUsages } from '@contrava/repo-scanner';

const sizes = (process.argv.find((arg) => arg.startsWith('--files='))?.split('=')[1] ?? '100,1000,5000').split(',').map(Number);
for (const fileCount of sizes) {
  const before = process.memoryUsage().heapUsed; const parseStarted = performance.now();
  const indexed = Array.from({ length: fileCount }, (_, index) => {
    const source = `import axios from 'axios';\nexport const load${index} = (id: string) => axios.get(\`/resources/${'${id}'}?source=${index}\`);\n`;
    return { path: `src/generated-fixture-${index}.ts`, usages: extractApiUsages(`fixture-${index}.ts`, source) };
  });
  const parseMs = performance.now() - parseStarted;
  const persistenceStarted = performance.now();
  const payloadBytes = Buffer.byteLength(JSON.stringify(indexed));
  const indexPreparationMs = performance.now() - persistenceStarted;
  const memoryDeltaMb = Math.max(0, process.memoryUsage().heapUsed - before) / 1024 / 1024;
  console.log(JSON.stringify({ files: fileCount, usages: indexed.reduce((sum, file) => sum + file.usages.length, 0), filesPerSecond: Number((fileCount / (parseMs / 1000)).toFixed(2)), parseMs: Math.round(parseMs), indexPreparationMs: Number(indexPreparationMs.toFixed(2)), payloadBytes, memoryDeltaMb: Number(memoryDeltaMb.toFixed(2)) }));
}
