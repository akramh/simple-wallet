# Documentation

This directory is the canonical documentation location for Simple Crypto
Wallet. Root and platform README files are intentionally short entrypoints that
link back here.

## Start Here

- [Getting started](./getting-started.md): install, run, and build commands
- [Architecture](./architecture.md): shared core, adapters, and platform flows
- [API reference](./api-reference.md): SDK and service APIs
- [Development workflow](./development.md): project conventions and build notes
- [Testing](./testing.md): root, extension, mobile, and e2e test loops
- [Security](./security.md): wallet-specific guardrails and invariants
- [External APIs and environment variables](./external-apis-and-env.md): network
  APIs, keys, CSP/allowlist cleanup candidates

## Platform Guides

- [CLI](./platforms/cli.md)
- [Chrome extension](./platforms/extension.md)
- [Mobile app](./platforms/mobile.md)

## Legal

- [License compliance](./legal/license-compliance.md)
- [Third-party licenses](./legal/third-party-licenses.md)

## Documentation Rules

- Keep detailed docs in this directory.
- Keep root `README.md` focused on orientation and links.
- Keep platform README files short unless a platform tool specifically needs
  local instructions.
- Remove plan/status docs once the implementation has shipped; preserve useful
  current content in the relevant canonical guide.
- When code changes alter commands, storage, crypto, network behavior, signing,
  or platform flows, update the matching doc in the same change.
