import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.ts';
import type { Incident } from './incidents.ts';
import { ROOT, STATE_DIR } from './paths.ts';

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/** Content hash of a directory tree (paths + bytes). */
export function hashTree(dir: string): string {
  const hash = createHash('sha256');
  for (const file of listFiles(dir)) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(dir, file))).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export function diffTrees(original: string, current: string): { added: string[]; removed: string[]; changed: string[] } {
  const before = new Set(listFiles(original));
  const after = new Set(listFiles(current));
  return {
    added: [...after].filter((file) => !before.has(file)),
    removed: [...before].filter((file) => !after.has(file)),
    changed: [...after].filter(
      (file) =>
        before.has(file) &&
        !fs.readFileSync(path.join(original, file)).equals(fs.readFileSync(path.join(current, file))),
    ),
  };
}

export function replaceTree(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

export const snapshotDir = (incident: Incident) => path.join(STATE_DIR, 'snapshots', incident.slug, 'src');

/**
 * Keeps a copy of the incident's original (broken) source, taken on first start:
 * from git HEAD when the incident is committed, otherwise from the working tree.
 * Used to measure the "before" baseline and by `./lab reset`.
 */
export async function ensureSnapshot(incident: Incident): Promise<string> {
  const target = snapshotDir(incident);
  if (fs.existsSync(target)) return target;

  const relativeSrc = path.relative(ROOT, incident.appSrcDir);
  const committed = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', relativeSrc]);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (committed.code === 0 && committed.stdout.trim() !== '') {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nplab-'));
    const extract = await run('sh', ['-c', 'git archive --format=tar HEAD -- "$1" | tar -x -C "$2"', 'sh', relativeSrc, scratch]);
    if (extract.code === 0) {
      fs.cpSync(path.join(scratch, relativeSrc), target, { recursive: true });
      fs.rmSync(scratch, { recursive: true, force: true });
      return target;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  fs.cpSync(incident.appSrcDir, target, { recursive: true });
  return target;
}

/** Copies the current source aside before it gets overwritten; returns the backup path. */
export function backupSource(incident: Incident): string {
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
  const target = path.join(STATE_DIR, 'backups', `${incident.slug}-${stamp}`, 'src');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(incident.appSrcDir, target, { recursive: true });
  return target;
}
