# Contributing

Use Node 24 and `npm ci`. Run `npm run build`, `npm test`, and `npm run test:e2e` before submitting a change. Keep protocol changes documented in `docs/PROTOCOL.md`; update the native clients when changing shared contracts.

The cloud task already provides an isolated checkout. Work in the existing repository; create a worktree only when explicitly requested. Never commit `.omnisync/`, native credential stores, APK signing keys, certificates, local toolchains, or user data.

Feature claims belong in `docs/FEATURE_STATUS.md`. Distinguish source implementation, successful compilation, integration tests, and physical-device validation. Unimplemented native features should not appear as enabled product controls.

Use `npm run format` for JavaScript, TypeScript, CSS, JSON, and maintained Markdown. Product vision documents are retained as supplied. The checked-in CI runs platform builds when the repository is pushed; creating the workflow is not evidence that those remote builds passed.
