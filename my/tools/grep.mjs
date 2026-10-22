import fs from 'node:fs';
const [file, ...patterns] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
lines.forEach((line, index) => {
  if (patterns.some((pattern) => line.includes(pattern))) {
    console.log(`${index + 1}: ${line.trim().slice(0, 220)}`);
  }
});
