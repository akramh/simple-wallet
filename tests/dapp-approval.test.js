/**
 * @fileoverview Tests for dApp approval security features.
 *
 * Tests the 24-hour expiration, session-only approvals, and migration logic
 * for the dApp connection approval system.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// Mock Implementation of dApp Approval Logic
// ============================================================================

// These tests verify the logic that's implemented in service-worker.ts
// We recreate the core logic here for unit testing without browser dependencies

const DAPP_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * @typedef {Object} DappApproval
 * @property {string} origin
 * @property {number} approvedAt
 * @property {boolean} sessionOnly
 */

/**
 * Creates a mock approval manager for testing.
 */
function createApprovalManager() {
  /** @type {Map<string, DappApproval>} */
  const approvedDappOrigins = new Map();
  /** @type {Set<string>} */
  const sessionOnlyApprovals = new Set();

  return {
    /**
     * Check if a dApp origin is currently approved (not expired).
     * @param {string} origin
     * @returns {boolean}
     */
    isDappApproved(origin) {
      const approval = approvedDappOrigins.get(origin);
      if (!approval) return false;

      // Check if session-only approval was cleared
      if (approval.sessionOnly && !sessionOnlyApprovals.has(origin)) {
        approvedDappOrigins.delete(origin);
        return false;
      }

      // Check if approval has expired
      const now = Date.now();
      if (now - approval.approvedAt > DAPP_APPROVAL_EXPIRY_MS) {
        approvedDappOrigins.delete(origin);
        return false;
      }

      return true;
    },

    /**
     * Add a dApp approval with timestamp.
     * @param {string} origin
     * @param {boolean} sessionOnly
     */
    approveDapp(origin, sessionOnly = false) {
      const approval = {
        origin,
        approvedAt: Date.now(),
        sessionOnly
      };
      approvedDappOrigins.set(origin, approval);

      if (sessionOnly) {
        sessionOnlyApprovals.add(origin);
      }
    },

    /**
     * Add approval with custom timestamp (for testing expiration).
     * @param {string} origin
     * @param {number} approvedAt
     * @param {boolean} sessionOnly
     */
    approveDappAt(origin, approvedAt, sessionOnly = false) {
      const approval = {
        origin,
        approvedAt,
        sessionOnly
      };
      approvedDappOrigins.set(origin, approval);

      if (sessionOnly) {
        sessionOnlyApprovals.add(origin);
      }
    },

    /**
     * Revoke a dApp approval.
     * @param {string} origin
     */
    revokeDappApproval(origin) {
      approvedDappOrigins.delete(origin);
      sessionOnlyApprovals.delete(origin);
    },

    /**
     * Clear all session-only approvals (called on wallet lock).
     */
    clearSessionOnlyApprovals() {
      for (const origin of sessionOnlyApprovals) {
        approvedDappOrigins.delete(origin);
      }
      sessionOnlyApprovals.clear();
    },

    /**
     * Get all approvals for inspection.
     * @returns {DappApproval[]}
     */
    getAllApprovals() {
      return Array.from(approvedDappOrigins.values());
    },

    /**
     * Simulate loading approvals from storage (migration logic).
     * @param {Array<string|DappApproval>} data
     */
    loadFromStorage(data) {
      approvedDappOrigins.clear();
      sessionOnlyApprovals.clear();

      for (const item of data) {
        // Skip null/undefined items
        if (item == null) continue;

        if (typeof item === 'string') {
          // Old format: just origin string - migrate with current timestamp
          approvedDappOrigins.set(item, {
            origin: item,
            approvedAt: Date.now(),
            sessionOnly: false
          });
        } else if (typeof item === 'object' && item.origin) {
          // New format: DappApproval object
          // Skip expired approvals during load
          if (Date.now() - item.approvedAt <= DAPP_APPROVAL_EXPIRY_MS) {
            approvedDappOrigins.set(item.origin, item);
          }
        }
      }
    },

    /**
     * Get persistable approvals (excludes session-only).
     * @returns {DappApproval[]}
     */
    getPersistableApprovals() {
      const persistable = [];
      for (const approval of approvedDappOrigins.values()) {
        if (!approval.sessionOnly) {
          persistable.push(approval);
        }
      }
      return persistable;
    }
  };
}

// ============================================================================
// Approval Expiration Tests
// ============================================================================

test('isDappApproved returns true for recently approved origin', () => {
  const manager = createApprovalManager();
  manager.approveDapp('https://example.com');

  assert.equal(manager.isDappApproved('https://example.com'), true);
});

test('isDappApproved returns false for non-approved origin', () => {
  const manager = createApprovalManager();

  assert.equal(manager.isDappApproved('https://unknown.com'), false);
});

test('isDappApproved returns false for expired approvals (after 24 hours)', () => {
  const manager = createApprovalManager();

  // Approve 25 hours ago
  const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
  manager.approveDappAt('https://expired.com', twentyFiveHoursAgo);

  assert.equal(manager.isDappApproved('https://expired.com'), false);
});

test('isDappApproved returns true for approval just under 24 hours', () => {
  const manager = createApprovalManager();

  // Approve 23 hours ago
  const twentyThreeHoursAgo = Date.now() - (23 * 60 * 60 * 1000);
  manager.approveDappAt('https://still-valid.com', twentyThreeHoursAgo);

  assert.equal(manager.isDappApproved('https://still-valid.com'), true);
});

test('isDappApproved removes expired approval from map', () => {
  const manager = createApprovalManager();

  const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
  manager.approveDappAt('https://expired.com', twentyFiveHoursAgo);

  // First call should return false and remove
  manager.isDappApproved('https://expired.com');

  // Verify it's been removed
  assert.equal(manager.getAllApprovals().length, 0);
});

// ============================================================================
// Session-Only Approval Tests
// ============================================================================

test('approveDapp with sessionOnly=true creates session approval', () => {
  const manager = createApprovalManager();
  manager.approveDapp('https://session-only.com', true);

  assert.equal(manager.isDappApproved('https://session-only.com'), true);

  const approvals = manager.getAllApprovals();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].sessionOnly, true);
});

test('clearSessionOnlyApprovals removes only session approvals', () => {
  const manager = createApprovalManager();

  manager.approveDapp('https://persistent.com', false);
  manager.approveDapp('https://session1.com', true);
  manager.approveDapp('https://session2.com', true);

  manager.clearSessionOnlyApprovals();

  assert.equal(manager.isDappApproved('https://persistent.com'), true);
  assert.equal(manager.isDappApproved('https://session1.com'), false);
  assert.equal(manager.isDappApproved('https://session2.com'), false);
});

test('session-only approvals are not included in persistable list', () => {
  const manager = createApprovalManager();

  manager.approveDapp('https://persistent.com', false);
  manager.approveDapp('https://session.com', true);

  const persistable = manager.getPersistableApprovals();

  assert.equal(persistable.length, 1);
  assert.equal(persistable[0].origin, 'https://persistent.com');
});

test('isDappApproved returns false for session approval after clear', () => {
  const manager = createApprovalManager();
  manager.approveDapp('https://session.com', true);

  assert.equal(manager.isDappApproved('https://session.com'), true);

  manager.clearSessionOnlyApprovals();

  assert.equal(manager.isDappApproved('https://session.com'), false);
});

// ============================================================================
// Revocation Tests
// ============================================================================

test('revokeDappApproval removes persistent approval', () => {
  const manager = createApprovalManager();
  manager.approveDapp('https://revoke-me.com', false);

  assert.equal(manager.isDappApproved('https://revoke-me.com'), true);

  manager.revokeDappApproval('https://revoke-me.com');

  assert.equal(manager.isDappApproved('https://revoke-me.com'), false);
});

test('revokeDappApproval removes session-only approval', () => {
  const manager = createApprovalManager();
  manager.approveDapp('https://session-revoke.com', true);

  manager.revokeDappApproval('https://session-revoke.com');

  assert.equal(manager.isDappApproved('https://session-revoke.com'), false);
});

test('revokeDappApproval is idempotent for non-existent origin', () => {
  const manager = createApprovalManager();

  // Should not throw
  manager.revokeDappApproval('https://never-approved.com');

  assert.equal(manager.isDappApproved('https://never-approved.com'), false);
});

// ============================================================================
// Storage Migration Tests
// ============================================================================

test('loadFromStorage migrates old format (string[]) to new format', () => {
  const manager = createApprovalManager();

  // Old format: just array of origin strings
  const oldFormat = [
    'https://old-dapp1.com',
    'https://old-dapp2.com'
  ];

  manager.loadFromStorage(oldFormat);

  assert.equal(manager.isDappApproved('https://old-dapp1.com'), true);
  assert.equal(manager.isDappApproved('https://old-dapp2.com'), true);

  const approvals = manager.getAllApprovals();
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0].sessionOnly, false);
});

test('loadFromStorage handles new format (DappApproval[])', () => {
  const manager = createApprovalManager();

  const newFormat = [
    { origin: 'https://new-dapp.com', approvedAt: Date.now(), sessionOnly: false }
  ];

  manager.loadFromStorage(newFormat);

  assert.equal(manager.isDappApproved('https://new-dapp.com'), true);
});

test('loadFromStorage skips expired approvals during load', () => {
  const manager = createApprovalManager();

  const expiredApproval = {
    origin: 'https://expired-dapp.com',
    approvedAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
    sessionOnly: false
  };

  const validApproval = {
    origin: 'https://valid-dapp.com',
    approvedAt: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
    sessionOnly: false
  };

  manager.loadFromStorage([expiredApproval, validApproval]);

  assert.equal(manager.isDappApproved('https://expired-dapp.com'), false);
  assert.equal(manager.isDappApproved('https://valid-dapp.com'), true);
  assert.equal(manager.getAllApprovals().length, 1);
});

test('loadFromStorage handles mixed old and new formats', () => {
  const manager = createApprovalManager();

  const mixedFormat = [
    'https://old-format.com', // old format
    { origin: 'https://new-format.com', approvedAt: Date.now(), sessionOnly: false }
  ];

  manager.loadFromStorage(mixedFormat);

  assert.equal(manager.isDappApproved('https://old-format.com'), true);
  assert.equal(manager.isDappApproved('https://new-format.com'), true);
});

test('loadFromStorage handles empty array', () => {
  const manager = createApprovalManager();

  manager.loadFromStorage([]);

  assert.equal(manager.getAllApprovals().length, 0);
});

test('loadFromStorage handles invalid items gracefully', () => {
  const manager = createApprovalManager();

  const invalidData = [
    null,
    undefined,
    123,
    { notAnOrigin: 'missing origin field' },
    'https://valid.com'
  ];

  // Should not throw
  manager.loadFromStorage(invalidData);

  // Only the valid string should be loaded
  assert.equal(manager.isDappApproved('https://valid.com'), true);
  assert.equal(manager.getAllApprovals().length, 1);
});

// ============================================================================
// Multiple Approvals Tests
// ============================================================================

test('multiple dApps can be approved simultaneously', () => {
  const manager = createApprovalManager();

  manager.approveDapp('https://dapp1.com');
  manager.approveDapp('https://dapp2.com');
  manager.approveDapp('https://dapp3.com');

  assert.equal(manager.isDappApproved('https://dapp1.com'), true);
  assert.equal(manager.isDappApproved('https://dapp2.com'), true);
  assert.equal(manager.isDappApproved('https://dapp3.com'), true);
  assert.equal(manager.getAllApprovals().length, 3);
});

test('re-approving same origin updates timestamp', () => {
  const manager = createApprovalManager();

  // Approve 23 hours ago
  const oldTime = Date.now() - (23 * 60 * 60 * 1000);
  manager.approveDappAt('https://refresh.com', oldTime);

  // Re-approve now
  manager.approveDapp('https://refresh.com');

  const approvals = manager.getAllApprovals();
  const approval = approvals.find(a => a.origin === 'https://refresh.com');

  // New timestamp should be recent
  assert.ok(Date.now() - approval.approvedAt < 1000);
});

test('approving persistent then session creates session approval', () => {
  const manager = createApprovalManager();

  manager.approveDapp('https://upgrade.com', false);
  manager.approveDapp('https://upgrade.com', true);

  const approvals = manager.getAllApprovals();
  const approval = approvals.find(a => a.origin === 'https://upgrade.com');

  assert.equal(approval.sessionOnly, true);
});
