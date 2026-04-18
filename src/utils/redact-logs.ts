/**
 * @fileoverview Patches the global `console` so any log message containing
 * a registered secret (e.g. the Alchemy API key) is replaced with
 * `<redacted>` before it reaches the console.
 *
 * @responsibilities
 * - Wrap `console.log/warn/error/info/debug` in each entry point
 * - Redact strings, Error messages + stacks, and deeply-nested objects
 * - Be a no-op when no secrets have been registered
 *
 * @security Defense-in-depth for the extension. Browser devtools still
 * show the Alchemy URL (with the key) in the Network tab — that's not
 * something this module can prevent. The goal here is to stop the key
 * from appearing in error messages thrown by ethers / @solana/web3.js
 * / fetch that propagate to console.error, and to catch any accidental
 * direct log of a processed config object.
 *
 * @notes Short or empty secrets are ignored — protects against redacting
 * common substrings if a caller passes an uninitialized key.
 */

const MIN_SECRET_LENGTH = 8;
const REDACTION = '<redacted>';

let secrets: string[] = [];
let installed = false;

/**
 * Registers a secret to redact. Safe to call multiple times; duplicates
 * and short values are dropped. Installs the console wrappers the first
 * time a valid secret is registered.
 */
export function installConsoleRedactor(secret: string | undefined): void {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return;
  if (secrets.includes(secret)) return;
  secrets = [...secrets, secret];
  if (!installed) {
    wrapConsole();
    installed = true;
  }
}

function wrapConsole(): void {
  const methods = ['log', 'warn', 'error', 'info', 'debug'] as const;
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args.map(redact));
    };
  }
}

function redactString(s: string): string {
  let out = s;
  for (const secret of secrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACTION);
    }
  }
  return out;
}

/**
 * Walks a value and returns a redacted copy.
 * - Strings get substring replacement.
 * - Errors get `message` + `stack` redacted on a new Error (preserves class name).
 * - Plain objects/arrays get recursively redacted (depth-capped to avoid cycles).
 * - Everything else (number, boolean, function, bigint, symbol) passes through.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') return redactString(value);

  if (value instanceof Error) {
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    if (value.stack) copy.stack = redactString(value.stack);
    // Some runtimes attach .cause, .request, .url, etc; normalize best-effort.
    const extra = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(extra)) {
      if (key === 'message' || key === 'stack' || key === 'name') continue;
      try {
        (copy as unknown as Record<string, unknown>)[key] = redact(extra[key], depth + 1);
      } catch {
        // Read-only or unusual property — skip.
      }
    }
    return copy;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = redact(v, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Exposed only for tests. Resets module state so a test can re-install
 * with a fresh secret set.
 */
export function __resetForTests(): void {
  secrets = [];
  installed = false;
}
