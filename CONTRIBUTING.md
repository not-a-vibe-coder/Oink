# Contributing to Oink

During Phases 1–5, the most useful contributions are public crypto test vectors and adversarial reviews of the wallet/authentication specification. New product features are not currently in scope.

Custodial features, EVM support, and anything requiring an X account are out of scope.

## Setup

Install Bun, clone the repository, run `bun install` at the root and in `backend/`, then copy each `.env.example` to `.env`. Configure a fresh Postgres database before running `bun run migrate` in `backend/`.

## Workflow

Fork the repository, use a focused branch, and open one concern per pull request. Write imperative, present-tense commit messages with no AI co-author trailer.

Crypto changes need an issue before a pull request. Never silently change a KDF parameter, cipher, or challenge protocol.

For bugs, include what happened, what you expected, and reproducible steps. Never paste a real secret phrase, private key, password, or authenticator code into an issue.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.
