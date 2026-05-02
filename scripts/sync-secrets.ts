#!/usr/bin/env tsx
/**
 * @file scripts/sync-secrets.ts
 * @description Three-way diff between local `.env`, Doppler, and a `.env.synced`
 *   baseline. For each secret, decides whether local is newer, remote is newer,
 *   or both changed (conflict), then prompts the user to upload, download, or skip.
 * @responsibilities Reconcile per-secret state across machines without ever
 *   logging full secret values. Maintain `.env.synced` as the merge base so
 *   future runs can detect which side changed.
 * @security Secret values are masked when displayed (first 4 + last 4 chars).
 *   Doppler is invoked via `spawnSync` with arg arrays — secret values are never
 *   interpolated into a shell string. `.env` and `.env.synced` are written with
 *   mode 0600. Both are gitignored.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(REPO_ROOT, '.env');
const SYNCED_PATH = join(REPO_ROOT, '.env.synced');

// ============================================================================
// .env parsing — preserves comments and ordering for write-back
// ============================================================================

interface EnvLine {
  kind: 'comment' | 'blank' | 'kv';
  raw: string;
  key?: string;
  value?: string;
}

function parseEnvFile(path: string): EnvLine[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const rawLines = text.split(/\r?\n/);
  // Drop the trailing empty element that split() produces on files ending in \n
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  return rawLines.map(parseEnvLine);
}

function parseEnvLine(raw: string): EnvLine {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'blank', raw };
  if (trimmed.startsWith('#')) return { kind: 'comment', raw };
  const eq = raw.indexOf('=');
  if (eq === -1) return { kind: 'comment', raw }; // malformed, treat as opaque
  const key = raw.slice(0, eq).trim();
  let value = raw.slice(eq + 1);
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return { kind: 'kv', raw, key, value };
}

function envLinesToMap(lines: EnvLine[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of lines) {
    if (l.kind === 'kv' && l.key !== undefined) m.set(l.key, l.value ?? '');
  }
  return m;
}

/**
 * Write a map of values back to a .env file, preserving the original ordering
 * and comments from `lines`. Keys present in `finalValues` but not in `lines`
 * are appended at the bottom under a marker comment.
 */
function writeEnvFile(path: string, lines: EnvLine[], finalValues: Map<string, string>): void {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind === 'kv' && line.key !== undefined) {
      if (!finalValues.has(line.key)) continue; // key was deleted — drop the line
      seen.add(line.key);
      out.push(`${line.key}=${formatValue(finalValues.get(line.key)!)}`);
    } else {
      out.push(line.raw);
    }
  }
  const newKeys = [...finalValues.keys()].filter(k => !seen.has(k)).sort();
  if (newKeys.length > 0) {
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push('# Added by sync-secrets');
    for (const k of newKeys) out.push(`${k}=${formatValue(finalValues.get(k)!)}`);
  }
  writeFileSync(path, out.join('\n') + '\n');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort on platforms that don't support chmod (Windows). Not fatal.
  }
}

function formatValue(v: string): string {
  if (v === '') return '';
  // Quote anything that contains whitespace, quotes, #, or backslashes so the
  // file parses safely back. JSON.stringify gives us correct escaping for free.
  if (/[\s#'"\\]/.test(v)) return JSON.stringify(v);
  return v;
}

// ============================================================================
// Doppler CLI wrapper
// ============================================================================

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], opts: { allowFail?: boolean } = {}): RunResult {
  const r = spawnSync('doppler', args, { encoding: 'utf8' });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('Error: `doppler` CLI not found.');
      console.error('Install: https://docs.doppler.com/docs/install-cli');
      process.exit(1);
    }
    throw r.error;
  }
  if ((r.status ?? 1) !== 0 && !opts.allowFail) {
    console.error(`doppler ${args.join(' ')} failed (exit ${r.status}):`);
    if (r.stderr) console.error(r.stderr.trim());
    process.exit(1);
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function preflight(): { project: string; config: string } {
  const who = run(['whoami', '--json'], { allowFail: true });
  if (who.code !== 0) {
    console.error('Not logged into Doppler. Run: doppler login');
    process.exit(1);
  }
  const proj = run(['configure', 'get', 'project', '--plain'], { allowFail: true });
  const cfg = run(['configure', 'get', 'config', '--plain'], { allowFail: true });
  if (proj.code !== 0 || proj.stdout.trim() === '' || cfg.stdout.trim() === '') {
    console.error('Doppler project/config not linked. From the repo root run:');
    console.error('  doppler setup --project simple-wallet --config dev');
    process.exit(1);
  }
  return { project: proj.stdout.trim(), config: cfg.stdout.trim() };
}

function fetchRemote(): Map<string, string> {
  const r = run(['secrets', 'download', '--no-file', '--format', 'json']);
  const parsed = JSON.parse(r.stdout) as Record<string, string>;
  return new Map(Object.entries(parsed));
}

function uploadSecret(name: string, value: string): void {
  // Positional args via spawnSync arg array — value bytes are passed verbatim,
  // no shell expansion or escaping concerns.
  run(['secrets', 'set', name, value, '--silent']);
}

function deleteSecret(name: string): void {
  run(['secrets', 'delete', name, '--silent', '--yes']);
}

// ============================================================================
// Diff
// ============================================================================

type DiffState =
  | 'in-sync'
  | 'local-newer'
  | 'remote-newer'
  | 'conflict'
  | 'new-local'
  | 'new-remote'
  | 'deleted-local'
  | 'deleted-remote';

interface Diff {
  key: string;
  state: DiffState;
  local?: string;
  remote?: string;
  synced?: string;
}

function computeDiff(
  local: Map<string, string>,
  remote: Map<string, string>,
  synced: Map<string, string>,
): Diff[] {
  const allKeys = new Set([...local.keys(), ...remote.keys(), ...synced.keys()]);
  const diffs: Diff[] = [];
  for (const key of [...allKeys].sort()) {
    const l = local.get(key);
    const r = remote.get(key);
    const s = synced.get(key);
    const inLocal = local.has(key);
    const inRemote = remote.has(key);
    const inSynced = synced.has(key);

    if (inLocal && inRemote && l === r) {
      diffs.push({ key, state: 'in-sync', local: l, remote: r, synced: s });
      continue;
    }
    if (inLocal && inRemote && inSynced) {
      const localChanged = l !== s;
      const remoteChanged = r !== s;
      if (localChanged && !remoteChanged) {
        diffs.push({ key, state: 'local-newer', local: l, remote: r, synced: s });
      } else if (!localChanged && remoteChanged) {
        diffs.push({ key, state: 'remote-newer', local: l, remote: r, synced: s });
      } else {
        diffs.push({ key, state: 'conflict', local: l, remote: r, synced: s });
      }
      continue;
    }
    if (inLocal && inRemote && !inSynced) {
      // First sync: both have it but no baseline. Treat differing values as conflict.
      diffs.push({ key, state: 'conflict', local: l, remote: r });
      continue;
    }
    if (inLocal && !inRemote) {
      diffs.push({ key, state: inSynced ? 'deleted-remote' : 'new-local', local: l, synced: s });
      continue;
    }
    if (!inLocal && inRemote) {
      diffs.push({ key, state: inSynced ? 'deleted-local' : 'new-remote', remote: r, synced: s });
      continue;
    }
    // !inLocal && !inRemote && inSynced — both deleted, nothing to do.
  }
  return diffs;
}

// ============================================================================
// Display + prompts
// ============================================================================

function mask(v: string | undefined): string {
  if (v === undefined) return '<absent>';
  if (v === '') return '<empty>';
  const len = v.length;
  if (len <= 8) return `<${len} chars>`;
  return `${v.slice(0, 4)}…${v.slice(-4)} (${len} chars)`;
}

function colorize(text: string, code: string): string {
  if (!process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}
const dim = (s: string) => colorize(s, '2');
const cyan = (s: string) => colorize(s, '36');
const yellow = (s: string) => colorize(s, '33');
const red = (s: string) => colorize(s, '31');
const green = (s: string) => colorize(s, '32');

interface Choice {
  key: string;
  label: string;
}

async function promptChoice(rl: ReadlineInterface, question: string, choices: Choice[]): Promise<string> {
  const opts = choices.map(c => `[${c.key}]${c.label}`).join(' / ');
  for (;;) {
    const ans = (await rl.question(`  ${question} ${opts}: `)).trim().toLowerCase();
    if (choices.some(c => c.key === ans)) return ans;
    console.log(dim(`    pick one of: ${choices.map(c => c.key).join(', ')}`));
  }
}

type Decision = 'upload' | 'download' | 'skip' | 'delete-remote' | 'delete-local';

async function reconcile(diffs: Diff[]): Promise<Map<string, Decision>> {
  const decisions = new Map<string, Decision>();
  const actionable = diffs.filter(d => d.state !== 'in-sync');
  if (actionable.length === 0) return decisions;

  const rl = createInterface({ input, output });
  try {
    for (const d of actionable) {
      console.log('');
      switch (d.state) {
        case 'local-newer': {
          console.log(`${cyan(d.key)} ${yellow('(local newer)')}`);
          console.log(`  local:  ${mask(d.local)}`);
          console.log(`  remote: ${mask(d.remote)}  ${dim('= last sync')}`);
          const c = await promptChoice(rl, 'upload local to Doppler?', [
            { key: 'u', label: 'pload' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'u' ? 'upload' : 'skip');
          break;
        }
        case 'remote-newer': {
          console.log(`${cyan(d.key)} ${yellow('(remote newer)')}`);
          console.log(`  local:  ${mask(d.local)}  ${dim('= last sync')}`);
          console.log(`  remote: ${mask(d.remote)}`);
          const c = await promptChoice(rl, 'download remote to .env?', [
            { key: 'd', label: 'ownload' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'd' ? 'download' : 'skip');
          break;
        }
        case 'conflict': {
          console.log(`${cyan(d.key)} ${red('(conflict — both changed)')}`);
          console.log(`  local:  ${mask(d.local)}`);
          console.log(`  remote: ${mask(d.remote)}`);
          if (d.synced !== undefined) console.log(`  synced: ${mask(d.synced)}`);
          const c = await promptChoice(rl, 'which wins?', [
            { key: 'u', label: 'pload local' },
            { key: 'd', label: 'ownload remote' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'u' ? 'upload' : c === 'd' ? 'download' : 'skip');
          break;
        }
        case 'new-local': {
          console.log(`${cyan(d.key)} ${green('(new local — not on Doppler)')}`);
          console.log(`  local: ${mask(d.local)}`);
          const c = await promptChoice(rl, 'upload to Doppler?', [
            { key: 'u', label: 'pload' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'u' ? 'upload' : 'skip');
          break;
        }
        case 'new-remote': {
          console.log(`${cyan(d.key)} ${green('(new remote — not in .env)')}`);
          console.log(`  remote: ${mask(d.remote)}`);
          const c = await promptChoice(rl, 'download to .env?', [
            { key: 'd', label: 'ownload' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'd' ? 'download' : 'skip');
          break;
        }
        case 'deleted-local': {
          console.log(`${cyan(d.key)} ${yellow('(deleted locally — still on Doppler)')}`);
          console.log(`  remote: ${mask(d.remote)}`);
          const c = await promptChoice(rl, 'restore locally or remove from Doppler?', [
            { key: 'd', label: 'ownload (restore local)' },
            { key: 'r', label: 'emove from Doppler' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'd' ? 'download' : c === 'r' ? 'delete-remote' : 'skip');
          break;
        }
        case 'deleted-remote': {
          console.log(`${cyan(d.key)} ${yellow('(deleted on Doppler — still in .env)')}`);
          console.log(`  local: ${mask(d.local)}`);
          const c = await promptChoice(rl, 'restore on Doppler or remove locally?', [
            { key: 'u', label: 'pload (restore remote)' },
            { key: 'r', label: 'emove locally' },
            { key: 's', label: 'kip' },
          ]);
          decisions.set(d.key, c === 'u' ? 'upload' : c === 'r' ? 'delete-local' : 'skip');
          break;
        }
        case 'in-sync':
          break;
      }
    }
  } finally {
    rl.close();
  }
  return decisions;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { project, config } = preflight();
  console.log(dim(`Doppler: ${project}/${config}`));

  const localLines = parseEnvFile(ENV_PATH);
  const local = envLinesToMap(localLines);
  const synced = envLinesToMap(parseEnvFile(SYNCED_PATH));
  const remote = fetchRemote();

  console.log(
    dim(`local: ${local.size} keys, synced baseline: ${synced.size} keys, remote: ${remote.size} keys`),
  );

  const diffs = computeDiff(local, remote, synced);
  const inSyncCount = diffs.filter(d => d.state === 'in-sync').length;
  const actionable = diffs.length - inSyncCount;

  console.log('');
  console.log(`${green(String(inSyncCount))} in sync, ${yellow(String(actionable))} to reconcile`);

  if (actionable === 0) {
    // Refresh .env.synced from current state so a deleted/missing baseline heals.
    writeSyncedBaseline(local, remote, synced, new Map());
    console.log(green('All in sync.'));
    return;
  }

  const decisions = await reconcile(diffs);

  // Apply decisions.
  const finalLocal = new Map(local);
  let upload = 0, download = 0, delRemote = 0, delLocal = 0, skip = 0;

  for (const [key, decision] of decisions) {
    const d = diffs.find(x => x.key === key)!;
    switch (decision) {
      case 'upload':
        uploadSecret(key, d.local ?? '');
        upload++;
        break;
      case 'download':
        finalLocal.set(key, d.remote ?? '');
        download++;
        break;
      case 'delete-remote':
        deleteSecret(key);
        delRemote++;
        break;
      case 'delete-local':
        finalLocal.delete(key);
        delLocal++;
        break;
      case 'skip':
        skip++;
        break;
    }
  }

  writeEnvFile(ENV_PATH, localLines, finalLocal);
  writeSyncedBaseline(finalLocal, remote, synced, decisions);

  console.log('');
  const parts: string[] = [];
  if (upload) parts.push(`${green(String(upload))} uploaded`);
  if (download) parts.push(`${green(String(download))} downloaded`);
  if (delRemote) parts.push(`${red(String(delRemote))} deleted from Doppler`);
  if (delLocal) parts.push(`${red(String(delLocal))} deleted locally`);
  if (skip) parts.push(`${dim(String(skip))} skipped`);
  console.log(parts.join(', '));
}

/**
 * Build the new `.env.synced` baseline. The rule is: a key is "synced" if local
 * and remote agree on its value right now. Skipped divergences keep their old
 * baseline so the next run still flags them in the right state (e.g. "remote
 * newer", not freshly "conflict").
 */
function writeSyncedBaseline(
  finalLocal: Map<string, string>,
  remoteBeforeUpload: Map<string, string>,
  oldSynced: Map<string, string>,
  decisions: Map<string, Decision>,
): void {
  const newSynced = new Map<string, string>(oldSynced);

  for (const [key, decision] of decisions) {
    if (decision === 'upload') {
      // After upload, remote = finalLocal[key].
      newSynced.set(key, finalLocal.get(key) ?? '');
    } else if (decision === 'download') {
      // After download, local = remoteBeforeUpload[key].
      newSynced.set(key, finalLocal.get(key) ?? '');
    } else if (decision === 'delete-remote' || decision === 'delete-local') {
      newSynced.delete(key);
    }
    // 'skip' — leave baseline untouched so the divergence stays detectable.
  }

  // Refresh baseline for keys that were already in-sync this run.
  for (const [key, val] of finalLocal) {
    if (remoteBeforeUpload.get(key) === val && !decisions.has(key)) {
      newSynced.set(key, val);
    }
  }

  // Write as a flat sorted KV file (no comments — it's machine-managed).
  const lines: EnvLine[] = [...newSynced.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ kind: 'kv' as const, raw: '', key: k, value: v }));
  writeEnvFile(SYNCED_PATH, lines, newSynced);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
