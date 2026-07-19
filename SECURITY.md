# Security Policy

Simple Wallet is wallet software that handles mnemonics, private keys, and signed
transactions. We take security issues seriously and appreciate responsible
disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through **GitHub's private vulnerability reporting**:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (GitHub → Security Advisories).
3. Provide a clear description, affected platform(s) (CLI / extension / mobile),
   reproduction steps, and impact.

If private reporting is unavailable to you, open a minimal public issue asking a
maintainer to open a private channel — **without** including exploit details.

We aim to acknowledge reports within a few business days and will coordinate a
fix and disclosure timeline with you.

## What to report

Examples of issues we especially want to hear about:

- Exposure or plaintext persistence of mnemonics or private keys.
- Weaknesses in encryption/key-derivation parameters or their use.
- Lock/unlock state not clearing sensitive in-memory data.
- The dApp-connection / signing path (extension provider) being abused by a
  malicious page.
- Leakage of API keys or user addresses to unexpected hosts.

## Scope

- The shared core (`src/`), the CLI, the Chrome extension (`extension/`), and the
  mobile app (`mobile-wallet/`).
- **Out of scope:** vulnerabilities in third-party dependencies or external
  providers (Alchemy, Etherscan, mempool.space, etc.) — report those upstream —
  and issues requiring a physically compromised device.

## For contributors

The engineering security model, invariants, and the guardrails to check before
touching secrets/storage/crypto/signing are documented in
[docs/security.md](./docs/security.md). Review it before working in those areas.

## Supported versions

This project is under active development; security fixes target the latest
`main`. There is no long-term support branch at this time.
