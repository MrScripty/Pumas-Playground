# Contributing

Use the Node version in `.node-version`. There are no npm dependencies or build
steps. Run `npm test` before committing; use conventional commit subjects.

This project follows the [MrScripty Coding Standards](https://github.com/MrScripty/Coding-Standards)
(reviewed at `188beda1fa477d21d576c233dd8c7f4c4c267d23`). Start with
`CORE-STANDARDS.md` and `STANDARDS-ROUTER.md`, then read guidance for the changed
boundary. Preserve unrelated work and review the staged diff.

Ownership is deliberately small:

- `contract.mjs` owns the reviewed finite request subset and result validation.
- `transport.mjs` owns loopback transport, cancellation, bounds and redaction.
- `client.mjs` owns public discovery, capability admission and generation fences.
- `server.mjs` owns the local UI listener and one-invocation lifecycle.
- `public/` owns presentation and browser state.
- `test/` owns deterministic substitutes and opt-in real-runtime verification.

Pumas owns inference, plugin readiness, models, native resources and model
lifecycle. Extend this repository through supported public APIs; do not copy or
rewrite Pumas core. New modalities require an inspected public contract and an
adapter. Keep supported, unavailable, untested and unknown outcomes distinct.
Never fabricate inference output or retry an operation after an unknown outcome.

The default CI gate proves adapter and HTTP behavior with controlled simulations;
it does not qualify real models. UI changes also need representative browser
verification. Real inference checks are opt-in, require authorized local runtime
inputs, and must record what actually ran, errors and cleanup. Do not add automatic
model downloads, paid services or real inference to normal CI. Do not publish
private prompts, credentials or unreviewed binary payloads in evidence.
