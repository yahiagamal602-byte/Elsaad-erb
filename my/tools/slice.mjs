import fs from 'node:fs';
import path from 'node:path';

const [file, startArg, endArg, outArg] = process.argv.slice(2);
const start = Number(startArg);
const end = Number(endArg);
const out = outArg ?? path.join('tools', '.slice.txt');
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const slice = lines.slice(start - 1, end).map((line, index) => `${start + index} | ${line}`).join('\n');
fs.writeFileSync(out, slice, 'utf8');
console.log(`wrote ${out} (${end - start + 1} lines)`);
