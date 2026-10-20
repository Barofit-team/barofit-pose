import {readFileSync} from 'node:fs';
import {PushupAnalyzer} from '../runtime/index.js';

const file = process.argv[2] ?? new URL('../tests/fixtures/standing.jsonl', import.meta.url);
const engine = new PushupAnalyzer();
for (const line of readFileSync(file, 'utf8').trim().split(/\r?\n/)) {
  const result = engine.pushFrame(JSON.parse(line));
  console.log(JSON.stringify(result));
}
for (const event of engine.finish()) console.log(JSON.stringify(event));
