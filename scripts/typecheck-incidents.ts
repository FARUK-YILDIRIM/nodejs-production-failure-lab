// Type-checks every incident's service with its own dependencies and tsconfig.
// Installs dependencies first when node_modules is missing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const incidentsDir = path.resolve(import.meta.dirname, '..', 'incidents');
let failed = false;

for (const slug of fs.readdirSync(incidentsDir).sort()) {
  const appDir = path.join(incidentsDir, slug, 'app');
  if (!fs.existsSync(path.join(appDir, 'tsconfig.json'))) continue;

  console.log(`› ${slug}`);
  if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: appDir, stdio: 'inherit' });
  }
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', '.'], { cwd: appDir, stdio: 'inherit' });
  } catch {
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
