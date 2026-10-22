import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const outputDirectory = mkdtempSync(join(tmpdir(), 'elsaad-tests-'));
try {
  await build({
    entryPoints: ['tests/property-sales.test.ts', 'tests/property-sales-db.test.ts', 'tests/users-initial-setup-db.test.ts', 'tests/accounting-db.test.ts', 'tests/csv-safety.test.ts', 'tests/financial-documents-db.test.ts', 'tests/assets-db.test.ts', 'tests/reports-db.test.ts', 'tests/installment-reports-db.test.ts', 'tests/operational-posting-db.test.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir: outputDirectory,
    entryNames: '[name]',
    outExtension: { '.js': '.mjs' },
    alias: { electron: resolve('tests/electron-stub.ts') },
  });
  const result = spawnSync(process.execPath, [
    '--test',
    join(outputDirectory, 'property-sales.test.mjs'),
    join(outputDirectory, 'property-sales-db.test.mjs'),
    join(outputDirectory, 'users-initial-setup-db.test.mjs'),
    join(outputDirectory, 'accounting-db.test.mjs'),
    join(outputDirectory, 'csv-safety.test.mjs'),
    join(outputDirectory, 'financial-documents-db.test.mjs'),
    join(outputDirectory, 'assets-db.test.mjs'),
    join(outputDirectory, 'reports-db.test.mjs'),
    join(outputDirectory, 'installment-reports-db.test.mjs'),
    join(outputDirectory, 'operational-posting-db.test.mjs'),
  ], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}