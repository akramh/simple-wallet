/**
 * @fileoverview Minimal `.env` file writer used by the CLI getting-started
 * flow to persist the Alchemy API key. Node-only (uses fs).
 *
 * @responsibilities
 * - Update `KEY=value` lines in place without disturbing anything else
 *   (comments, blank lines, unrelated vars, ordering, CRLF endings)
 * - Append missing keys under a marker comment
 * - Write the file with owner-only permissions (0600)
 *
 * @security The `.env` file holds live API keys; it is gitignored and must
 * be written mode 0600. Values are written verbatim — callers must not pass
 * values containing newlines.
 */

import * as fs from 'fs';

/** Comment line inserted above appended vars. */
const APPEND_MARKER = '# Added by Simple Wallet setup';

/**
 * Pure core of the .env writer: returns `content` with each `vars` entry
 * upserted. For an existing assignment (`KEY=...`, optionally with an
 * `export ` prefix and surrounding whitespace) the first matching line's
 * value is replaced in place, preserving any `export` prefix; later
 * duplicate definitions are left untouched (dotenv uses the first). Missing
 * keys are appended at the end under {@link APPEND_MARKER}. Comments, blank
 * lines, unrelated vars, ordering, and CRLF line endings are preserved.
 * Idempotent: applying the same vars twice is a fixpoint.
 *
 * @param content - Current file content ('' for a new file).
 * @param vars - Key → value map to upsert.
 * @returns The updated content.
 */
export function upsertEnvContent(content: string, vars: Record<string, string>): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  const replaced = new Set<string>();

  const updated = lines.map((line) => {
    for (const [key, value] of Object.entries(vars)) {
      if (replaced.has(key)) continue;
      const match = line.match(new RegExp(`^(\\s*)(export\\s+)?(${key})\\s*=`));
      if (match) {
        replaced.add(key);
        return `${match[1]}${match[2] ?? ''}${key}=${value}`;
      }
    }
    return line;
  });

  const missing = Object.entries(vars).filter(([key]) => !replaced.has(key));
  if (missing.length > 0) {
    // Drop a single trailing blank line so the appended block sits flush,
    // then re-add the trailing newline at the end.
    while (updated.length > 0 && updated[updated.length - 1] === '') {
      updated.pop();
    }
    if (updated.length > 0) updated.push('');
    updated.push(APPEND_MARKER);
    for (const [key, value] of missing) {
      updated.push(`${key}=${value}`);
    }
  }

  let result = updated.join(eol);
  if (result.length > 0 && !result.endsWith(eol)) result += eol;
  return result;
}

/**
 * Reads `filePath` if it exists (else starts from empty), upserts `vars`
 * via {@link upsertEnvContent}, and writes the result with mode 0600.
 *
 * @param filePath - Path to the .env file (created if missing).
 * @param vars - Key → value map to upsert.
 * @throws On filesystem errors (unreadable / unwritable path).
 */
export function upsertEnvFile(filePath: string, vars: Record<string, string>): void {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const next = upsertEnvContent(current, vars);
  fs.writeFileSync(filePath, next, { mode: 0o600 });
}
