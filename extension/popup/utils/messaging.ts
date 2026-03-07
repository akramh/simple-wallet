/**
 * @fileoverview Retry-aware messaging for Chrome extension popup → service worker.
 *
 * In Manifest V3 the background service worker is terminated after ~30 seconds
 * of inactivity.  When the popup opens, `chrome.runtime.sendMessage` may fire
 * before the service worker has re-registered its `onMessage` listener,
 * producing:
 *
 *   "Could not establish connection. Receiving end does not exist."
 *
 * `sendMessageWithRetry` catches this specific error and retries with a short
 * delay, giving Chrome time to spin the service worker back up.
 */

/** Default number of retry attempts before giving up. */
const DEFAULT_MAX_RETRIES = 3;

/** Delay (ms) between retries — enough for the service worker to evaluate. */
const DEFAULT_RETRY_DELAY_MS = 300;

/**
 * Returns true when the error looks like a service-worker-not-ready condition.
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('could not establish connection') ||
      msg.includes('receiving end does not exist')
    );
  }
  return false;
}

/**
 * Send a message to the background service worker, retrying on transient
 * connection errors caused by service-worker suspension.
 *
 * @param message  The message payload (must include a `type` field).
 * @param maxRetries  Number of retries (default 3).
 * @param retryDelayMs  Pause between retries in ms (default 300).
 * @returns The response from the service worker.
 */
export async function sendMessageWithRetry<T = any>(
  message: any,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  retryDelayMs: number = DEFAULT_RETRY_DELAY_MS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      lastError = error;

      // Only retry on connection errors; propagate anything else immediately.
      if (!isConnectionError(error) || attempt === maxRetries) {
        throw error;
      }

      // Wait before next attempt so the service worker can finish loading.
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  // Unreachable in practice, but satisfies the type checker.
  throw lastError;
}
