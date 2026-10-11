# Standalone extraction verification — 2026-10-11

The fresh-history export comes from Pumas Library feature commit
`bd982b67bb34e57088b5db466b3761809b6a03f6`. No Rust core, runtime package, model
weights, private configuration, credential files or Git history was copied.
The adapters and all 14 deterministic test cases are byte-identical to that
source. The MIT notice and historical real-execution receipts are also unchanged.

Local verification from this repository passed on Linux with Node 24.19.0:

- `npm test`: 14 passed, zero failed; simulated inference only.
- `node server.mjs --help` and `node --check test/real-onnx-smoke.mjs`: passed.
- Optional browser smoke: Chromium 151.0.7922.173 with Playwright 1.57.0 passed
  keyboard discovery, inputs/results, attachments, receipts, cancellation,
  empty models and 390px layout. Its inference is explicitly simulated.
- Real ONNX API and browser smoke from standalone commit
  `8489ec1cac69baf2d6d7d6e89ec902f001ca979c`: passed using the external Pumas
  source/binary and pinned ONNX Runtime 1.24.2 already qualified in the original
  work. All 256 values were 0.0625, the model unloaded and Pumas exited with code 0.
  [New receipt](standalone/real-untrained-onnx.json) and
  [new screenshot](standalone/real-untrained-onnx-browser.png) identify both
  repository revisions. This remains an untrained graph, not semantic-model
  qualification. No additional runtime or model download was needed.

The workflow schedules the same deterministic tests on Ubuntu and Windows with
Node 24.15.0; remote CI is unverified until a repository exists and the workflow
actually runs. It installs no npm packages, models or inference runtime.

The original [real ONNX success](real-untrained-onnx.json),
[browser screenshot](real-untrained-onnx-browser.png), and
[mixed-length batch failure](real-untrained-onnx-batch-failure.json) remain
historical observations of the external public Pumas runtime. The optional real
smoke now requires `PUMAS_SOURCE_DIR` for public fixture tooling, in addition to
the explicitly selected binary and pinned CPU runtime directory.
