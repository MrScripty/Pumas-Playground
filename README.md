# Pumas Playground

A local developer workbench for observing a running Pumas gateway and trying one
finite model operation at a time. This standalone repository consumes the supported HTTP API of
[Pumas Library](https://github.com/MrScripty/Pumas-Library), an external runtime.
No Pumas core, plugin implementation or runtime binary is bundled. It neither installs nor starts inference providers, acquires
models, serves/unserves models, nor addresses private plugin endpoints.

## Run

Clone this repository and use its Node 24 toolchain (`.node-version`). No package installation,
frontend build, model weights or API subscription is needed for the playground.

```bash
git clone https://github.com/MrScripty/Pumas-Playground.git
cd Pumas-Playground
node server.mjs --backend http://127.0.0.1:8080
# Open http://127.0.0.1:8787 in a browser.
```

Choose the **public gateway** address of an already running, authorized Pumas
instance. The default UI port can be changed with `--port 8788`. The backend must
be a numeric loopback HTTP base URL, including `http://[::1]:8080` where available.
There is no remote endpoint mode. Optional `PUMAS_PLAYGROUND_TOKEN` supplies a
Bearer header from the server environment; it is never sent to the browser or
included in receipts. Current local Pumas HTTP does not require this header.

1. Select **Discover runtime** to observe build identity, served aliases and
   enabled plugin manifests. An empty model list is distinct from failed discovery.
2. Select a model, optionally give its exact profile to disambiguate it, then
   **Inspect capabilities**. Inspection returns the exact profile used by requests.
3. Choose an available capability, edit its public JSON request and **Run request**.
   Every click gets a new correlation ID. IDs provide no replay/idempotency promise.
4. Inspect the response and redacted HTTP receipts. Download receipts explicitly
   if needed. Generated PNGs can be downloaded separately.

Unsupported discovery returns an error and keeps inference disabled. This tool
requires the public discovery/fencing and typed v1 operation surfaces in published
Pumas source; the v0.7.0 release alone is not sufficient. It does not guess support
from a model name, file format, plugin installation, or legacy `/v1/models`
capability hints.

## Capability and coverage meanings

Each card has two dimensions: **supported / unavailable / untested** describes the
latest runtime observation and reviewed adapter; **untested / succeeded / error /
unknown** describes requests in this browser session and exact runtime generation,
model and profile. A supported card is not a real-model qualification claim.
Inspection is refreshed before every run; Pumas still owns final live admission.

| Modality | Playground adapter | Runtime requirement |
| --- | --- | --- |
| Chat / text | Finite typed messages or text; text output | `chat_generation` / `text_generation` available |
| Embeddings | Text or text batch; finite float vectors | `text_embedding` available |
| Transcription | Raw PCM16LE or PCM32FLE attachment; text output | `audio_transcription` available for the exact qualified audio owner |
| Image generation | Prompt, explicit dimensions, optional seed; PNG preview/download | `image_generation` available |
| Image to text | One PNG/JPEG plus prompt; text output | `image_to_text` available |
| Audio generation, image editing, 3D | Visible unavailable cards; no invented endpoint | No reviewed public contract at the inspected revision |
| Audio classification / future capabilities | Display descriptor and unavailability; no dispatch | Requires an implemented and reviewed adapter |

For transcription, set encoding, channels and sample rate **before** attaching a
raw `.pcm`/`.raw` file. The tool computes frames from bytes and checks the declared
length and float range. It does not decode WAV/MP3 or silently resample/relabel
audio. Pumas owns its documented conversion. For vision, the browser attaches
PNG/JPEG bytes; Pumas owns full input decoding and runtime pixel limits. Browser
PNG decoding must succeed before an image result is presented as successful.

Streaming availability and option bounds are visible in discovery receipts, but
this first harness intentionally sends only `stream: false`. Audio runtime
qualification can remain unavailable even when its descriptor or loader exists.
No test-only availability override is exposed by the launcher.

## Boundary and lifecycle

`contract.mjs` owns the bounded consumer subset, templates and decoded result
checks. `client.mjs` owns public discovery and finite operation sequencing.
`transport.mjs` owns loopback HTTP, byte bounds and receipt redaction.
`server.mjs` owns the local listener and one active invocation. `public/` owns the
browser session and native form controls. Node's HTTP/URL/JSON implementations
handle transport and serialization; there is no custom HTTP or SSE parser and no
new package dependency. A framework/build pipeline adds no needed capability for
this bounded form and JSON inspector; it can be introduced independently later.

Public producer authority was inspected at
[`ad31e391`](https://github.com/MrScripty/Pumas-Library/tree/ad31e391dcd94c204b3fcd748cc98d27b3281e65):

- [Typed operation contract](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/docs/contracts/model-operations-v1.md),
  [DTOs](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/rust/crates/pumas-rpc/src/handlers/model_operations/types.rs) and
  [live descriptors/admission](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/rust/crates/pumas-rpc/src/handlers/model_operations.rs).
- [Public HTTP identity](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/rust/crates/pumas-core/src/discovery/http.rs),
  [generation fences](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/rust/crates/pumas-rpc/src/discovery.rs) and
  [generation lifetime](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/docs/contracts/generation-lifetime.md).
- [Source plugin manifests](https://github.com/MrScripty/Pumas-Library/blob/ad31e391dcd94c204b3fcd748cc98d27b3281e65/launcher-data/plugins/README.md) are inventory,
  not semantic readiness. Published audio source has evolved beyond portions of
  the narrative contract; the tool uses live descriptors instead of assuming
  every audio loader is executable.

Discovery and response DTOs accept additive fields while validating the consumed
v1 fields; unknown capabilities cannot dispatch. Requests are a closed, deliberately
smaller subset of the canonical DTOs, reserialized after validation. Full provider
semantics, image decoding, native/device custody and final admission stay in Pumas.
Future fixes can be adopted by restarting the selected backend and explicitly
refreshing discovery. The tool pins both instance and service generation headers;
stale identities are errors, never a silent rebind or inference retry.

The UI listener binds only `127.0.0.1`, checks exact Host/Origin plus browser fetch
metadata, uses a per-launch session header, and serves a fixed asset allowlist with
a restrictive CSP. This does not authenticate other native processes running as
the same local user. No CORS proxy, arbitrary RPC method, endpoint, file path,
runtime lifecycle mutation or external asset loader is exposed.

Limits: 16 listener connections, one active API invocation, no work queue,
16 MiB request, 32 MiB response, 8 MiB input file, 512 generated text tokens,
1,048,576 generated image pixels, and 30 seconds input audio. Live descriptor
bounds may be stricter. Embeddings and discovery have a 30-second observation
budget; connecting has a 10-second budget. **Generation has no total, header,
read or idle timeout.** An explicit cancel, browser disconnect or server shutdown
closes owned upstream transport. Transport loss after dispatch is **unknown**,
including embeddings. This is not proof that provider threads or GPU work stopped.
The playground cannot impose a hard GPU/RAM/compute limit or release backend
custody. There are no retries, redirects, implicit alternative endpoints or paid
inference services.

Receipts include timestamps, correlation, route, request, HTTP status, response
bytes, elapsed time and outcome. They never collect response or authorization
headers. Redaction removes known configured secrets, credential-named fields,
Bearer/HF/OpenAI token patterns and URL credentials/query strings. Binary content
is replaced with encoded length; strings/arrays/depth are bounded in receipts.
This is a diagnostic projection, not a byte-exact recording or general secret
detector. Arbitrary private prose can remain: review before sharing. The browser
holds only the latest receipt and response, uses no localStorage, and exports only
on demand; the server writes no request history. Embedding output may be long;
the receipt projection is capped while the on-screen result retains its vectors.

## Verify

Deterministic tests use test-only loopback fixtures and no model packages:

```bash
node --test --test-timeout=15000 test/*.test.mjs
```

Representative browser verification uses an explicitly installed Playwright
1.57.0 and Chromium. It installs neither:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node test/browser-smoke.mjs
```

The browser test produces labeled simulator screenshots in `evidence/`. There
is no simulator option in the ordinary launcher. To observe an existing authorized
Pumas binary with an isolated empty root and registry (no inference):

```bash
PUMAS_RPC_BINARY=/absolute/path/to/pumas-rpc \
node test/real-observation-smoke.mjs
```

Supplying the two browser environment variables also captures that real runtime's
UI observation. This check launches and stops only its own disposable instance.

For a real Linux x86_64 CPU embedding smoke, build current public Pumas with normal
registry fetching and explicitly stage its pinned ONNX Runtime. A CMake executable
must be on PATH for the native build. The stage command downloads an approximately
8 MB native runtime archive; neither command acquires pretrained model weights.

```bash
# Use a separate Pumas Library checkout; inspected public revision: ad31e391.
export PUMAS_SOURCE_DIR=/absolute/path/to/Pumas-Library
cargo build --manifest-path "$PUMAS_SOURCE_DIR/rust/Cargo.toml" -p pumas-rpc --locked
python3 "$PUMAS_SOURCE_DIR/scripts/release/onnx_runtime_stage.py" \
  --target linux-x86_64 --download --output-dir /tmp/playground-ort-runtime
PUMAS_RPC_BINARY="$PUMAS_SOURCE_DIR/rust/target/debug/pumas-rpc" \
PUMAS_ORT_DIR=/tmp/playground-ort-runtime \
node test/real-onnx-smoke.mjs
```

Adjust the binary path if `CARGO_TARGET_DIR` is set. This opt-in smoke verifies the
runtime library hashes, reads fixture tooling from `PUMAS_SOURCE_DIR`, creates Pumas' existing 505-byte
**untrained** ONNX graph,
and uses public setup RPCs in a fresh temporary library, registry and XDG state.
It imports, serves, calls the playground API, checks the actual 256-dimensional
embedding against the graph's numerical oracle, unserves, and checks clean process
shutdown. This lifecycle setup is confined to the test; the normal UI cannot
perform it. Add the same two browser environment variables to also exercise the
real UI and capture `evidence/real-untrained-onnx-browser.png`. Set
`PUMAS_EVIDENCE_DIR` to keep a new observation in a separate directory.

The graph tiles token values and has no learned semantic weights. It qualifies the
CPU execution path, not embedding quality or a pretrained model. The smoke never
downloads models or substitutes responses. Set `PUMAS_SMOKE_MIXED_BATCH=1` to probe
`["hello world", "world"]`; the inspected public runtime returns `provider_failure`
with unknown outcome for this case, so that probe currently exits nonzero and
writes a separate failure receipt. The successful single-input evidence is retained.

See [verification evidence](evidence/verification.md) for actual measured coverage,
screenshots, compatibility gaps, and the unpublished-fix dependency.

## Development and CI

`npm test` runs all 14 deterministic adapter and loopback transport tests without
installing npm packages, native providers, browsers or models. GitHub Actions runs
that same check on Ubuntu and Windows with the pinned Node version, a five-minute
job limit and read-only repository permissions. CI never launches real inference.
The optional browser and real-runtime checks above require explicitly selected
local tools and remain separate from the default test command.

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for ownership and verification. This
repository was extracted with fresh history from the public Pumas feature branch;
[NOTICE.md](NOTICE.md) records provenance, the unchanged MIT notice and evidence
boundaries. [Standalone verification](evidence/standalone.md) records checks of
the extracted repository. No Pumas core changes are needed to launch the playground.
