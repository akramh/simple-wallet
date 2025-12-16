# Cursor agent rules: documentation + tests

These rules apply to all changes in this repo, and are meant to keep the mobile app aligned with the commenting and testing standards used in the wallet core, CLI, and Chrome extension.

## Documentation (code comments)

- For any change in `src/`, `extension/`, or `mobile-wallet/services|store|hooks|config`:
  - Add/maintain a top-of-file docblock using the existing repo style:
    - Use either `@fileoverview` (core style) or `@file` + `@description` (CLI/extension style).
    - Include `@responsibilities` and `@security` when the file touches session state, storage, crypto, network/rpc, or explorer APIs.
  - Any new or changed exported `class`, `function`, `type`, or `interface` must have TSDoc:
    - Include `@param`, `@returns`, `@throws`, and `@async` when applicable.
    - Document invariants and units (e.g., timestamps ms vs seconds, amount units, network key formats).
  - Large logic files should use section dividers matching the repo standard:
    - `// ============================================================================`
  - Do not add comments that duplicate the code’s “what”; prefer documenting “why”, invariants, and security constraints.

## Tests (required after functional changes)

- Any functional change must include or update tests.
- Choose the runner based on what you’re testing:
  - **Pure logic (no React Native / no Expo)**: use Node’s built-in runner (`node:test`) in the repo style.
  - **React Native / Expo modules / UI**: use Jest with Expo preset + `@testing-library/react-native`.
  - **User-flow validation**: add/maintain Detox E2E smoke tests (small and stable).
- For any bug fix:
  - Add a regression test that fails before the fix and passes after.
- For any new feature:
  - Add at least:
    - one happy-path test
    - one failure/edge-case test
    - one invariant test (e.g., lock clears state; network switch resets caches) when relevant
- Tests must be deterministic:
  - Do not rely on live RPC/explorer calls; use fixtures/mocks.
  - Avoid time-based flake: mock timers (`jest.useFakeTimers`) where appropriate.

## Quality gates before finishing a change

- Ensure lint/typecheck still pass for the touched area.
- Run the relevant test suites for the touched code:
  - Core SDK: `npm test` (root) when shared logic is touched.
  - Mobile unit/integration: `npm test` (mobile-wallet) when mobile code is touched.
  - E2E smoke: run Detox suite when user-facing flows are changed.
