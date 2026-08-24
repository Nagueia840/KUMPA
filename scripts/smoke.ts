import { parseJSON } from '../src/llm/index.js';

const casos = [
  '{"a":1}',
  '```json\n{"b": 2}\n```',
  'Acá va: {"c": 3} y más texto',
];

for (const c of casos) {
  console.log('OK', JSON.stringify(parseJSON<unknown>(c)));
}
