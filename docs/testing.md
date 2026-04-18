# Testing

## Root Tests

The root suite uses Node's built-in test runner. Tests import compiled output
from `dist/`, so the test script builds first:

```bash
npm test
```

Run one root test file:

```bash
npm run build
node --test tests/wallet.test.js
```

Run a specific test name:

```bash
node --test --test-name-pattern="<regex>" tests/wallet.test.js
```

Build first when running `node --test` directly.

## Mobile Tests

Run from `mobile-wallet/`:

```bash
npm test
npm test -- __tests__/walletStore.test.ts
npm test -- -t "<name pattern>"
```

Mobile tests use Jest with the Expo preset and
`@testing-library/react-native`.

## E2E Tests

Detox iOS smoke tests run from `mobile-wallet/`:

```bash
npm run e2e:ios:build
npm run e2e:ios:test
```

Keep e2e coverage small and stable. Prefer focused unit or integration tests
for business logic and adapters.

## Test Policy

- Bug fixes require a regression test that fails before the fix and passes
  after.
- New features require at least a happy-path test and a failure or edge-case
  test.
- Add invariant tests when state or security behavior matters, such as lock
  clearing session state or network switching resetting caches.
- Tests must not make live RPC or explorer calls. Use fixtures and mocks.
- Avoid time flake with fake timers or controlled timestamps.

The network egress guard lives at `tests/security/network-egress.test.ts`.
