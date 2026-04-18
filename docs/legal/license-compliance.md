# License Compliance

This project is licensed under MIT. See the root [LICENSE](../../LICENSE).

This guide tracks distribution obligations for third-party dependencies,
especially LGPL-licensed transitive packages.

## Attribution Locations

Mobile app:

- File: `mobile-wallet/app/licenses.tsx`
- Access path: Profile tab, then About or Licenses depending on the current UI

Chrome extension:

- File: `extension/public/licenses.html`
- Access path: Settings, then Open Source Licenses

Project documentation:

- [Third-party licenses](./third-party-licenses.md)

## LGPL Component

Component: `rpc-websockets` v9.3.2

- License: LGPL-3.0-only
- Author: Elpheria j.d.o.o.
- Repository: `https://github.com/elpheria/rpc-websockets`
- Used by: `@solana/web3.js` as a transitive dependency

## Compliance Position

- Attribution is provided in platform license screens and docs.
- The package is used as an npm dependency.
- The project does not distribute a modified copy of `rpc-websockets`.
- Users can replace the package through standard npm dependency management.

Verify dependency licenses with:

```bash
npx license-checker --summary
npx license-checker --production --json

cd mobile-wallet
npx license-checker --summary
npx license-checker --production --json
```

## Distribution Notes

- Do not remove platform license screens.
- Keep third-party attribution current when dependency versions change.
- Re-run license checks before app store, web store, or commercial
  distribution.
