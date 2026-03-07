/**
 * @fileoverview Tests for sendMessageWithRetry logic.
 *
 * Verifies the retry behavior for Chrome extension popup → service worker
 * messaging that handles MV3 service-worker suspension.
 *
 * Following the same pattern as dapp-approval.test.js, we recreate the core
 * logic here for unit testing without browser/Vite dependencies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// Inline implementation (mirrors extension/popup/utils/messaging.ts)
// ============================================================================

function isConnectionError(error) {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return (
            msg.includes('could not establish connection') ||
            msg.includes('receiving end does not exist')
        );
    }
    return false;
}

async function sendMessageWithRetry(
    sendFn,
    message,
    maxRetries = 3,
    retryDelayMs = 10, // short delay for tests
) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await sendFn(message);
        } catch (error) {
            lastError = error;

            if (!isConnectionError(error) || attempt === maxRetries) {
                throw error;
            }

            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }

    throw lastError;
}

// ============================================================================
// Tests
// ============================================================================

test('sendMessageWithRetry succeeds immediately when sendMessage works', async () => {
    const sendFn = async (msg) => ({ status: 'ok', type: msg.type });

    const result = await sendMessageWithRetry(sendFn, { type: 'GET_STATE' });
    assert.deepEqual(result, { status: 'ok', type: 'GET_STATE' });
});

test('sendMessageWithRetry retries on connection error and eventually succeeds', async () => {
    let callCount = 0;
    const sendFn = async () => {
        callCount++;
        if (callCount < 3) {
            throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { status: 'ok' };
    };

    const result = await sendMessageWithRetry(sendFn, { type: 'GET_STATE' }, 3, 10);
    assert.deepEqual(result, { status: 'ok' });
    assert.equal(callCount, 3); // Failed twice, succeeded on third
});

test('sendMessageWithRetry propagates non-connection errors immediately', async () => {
    let callCount = 0;
    const sendFn = async () => {
        callCount++;
        throw new Error('Some other Chrome error');
    };

    await assert.rejects(
        () => sendMessageWithRetry(sendFn, { type: 'GET_STATE' }, 3, 10),
        { message: 'Some other Chrome error' }
    );
    assert.equal(callCount, 1); // No retries for non-connection errors
});

test('sendMessageWithRetry fails after max retries with original error', async () => {
    let callCount = 0;
    const sendFn = async () => {
        callCount++;
        throw new Error('Could not establish connection. Receiving end does not exist.');
    };

    await assert.rejects(
        () => sendMessageWithRetry(sendFn, { type: 'GET_STATE' }, 2, 10),
        { message: /Could not establish connection/ }
    );
    // 1 initial + 2 retries = 3 total attempts
    assert.equal(callCount, 3);
});

test('sendMessageWithRetry retries on "receiving end does not exist" variant', async () => {
    let callCount = 0;
    const sendFn = async () => {
        callCount++;
        if (callCount === 1) {
            throw new Error('Receiving end does not exist.');
        }
        return { ok: true };
    };

    const result = await sendMessageWithRetry(sendFn, { type: 'PING' }, 3, 10);
    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
});

test('isConnectionError returns false for non-Error values', () => {
    assert.equal(isConnectionError('string error'), false);
    assert.equal(isConnectionError(null), false);
    assert.equal(isConnectionError(undefined), false);
    assert.equal(isConnectionError(42), false);
});

test('isConnectionError returns true for connection error messages', () => {
    assert.equal(
        isConnectionError(new Error('Could not establish connection. Receiving end does not exist.')),
        true
    );
    assert.equal(
        isConnectionError(new Error('Receiving end does not exist.')),
        true
    );
});

test('isConnectionError returns false for unrelated errors', () => {
    assert.equal(isConnectionError(new Error('Network timeout')), false);
    assert.equal(isConnectionError(new Error('Permission denied')), false);
});

test('sendMessageWithRetry with 0 retries throws on first failure', async () => {
    let callCount = 0;
    const sendFn = async () => {
        callCount++;
        throw new Error('Could not establish connection. Receiving end does not exist.');
    };

    await assert.rejects(
        () => sendMessageWithRetry(sendFn, { type: 'TEST' }, 0, 10),
        { message: /Could not establish connection/ }
    );
    assert.equal(callCount, 1);
});
