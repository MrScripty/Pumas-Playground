// Test-only loopback protocol simulator. Never used by the playground launcher.
import http from 'node:http';
import { template } from '../contract.mjs';
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S0AAAAASUVORK5CYII=';
export const FENCE = { instance: 'fixture-owner', service: 'fixture-service' };
const TEXT_BOUNDS = [{ option: 'max_tokens', minimum: 1, maximum: 4096 }, { option: 'temperature', minimum: 0, maximum: 2 }, { option: 'top_p', minimum: 0, maximum: 1 }];
// Includes additive fields and an unknown capability, which consumers must ignore.
export function descriptors() {
  return [
    ['chat_generation', 'chat_generation', ['messages_text'], 'text', TEXT_BOUNDS],
    ['text_generation', 'text_generation', ['text'], 'text', TEXT_BOUNDS],
    ['text_embedding', 'text_embedding', ['text', 'text_batch'], 'embeddings_float32', []],
    ['image_generation', 'text_to_image', ['text'], 'png_base64', [{ option: 'input_characters', minimum: 1, maximum: 4000 }]],
    ['image_to_text', 'image_to_text', ['png_base64', 'jpeg_base64', 'messages_image'], 'text', TEXT_BOUNDS],
    ['audio_transcription', 'speech_to_text', ['pcm_s16le', 'pcm_f32le'], 'text', [{ option: 'max_output_tokens', minimum: 1, maximum: 512 }]],
    ['audio_classification', 'audio_classification', ['pcm_s16le'], 'labels', []],
    ['multimodal_embedding', 'multimodal_embedding', ['png_base64', 'jpeg_base64', 'content_batch'], 'embeddings_float32', [{ option: 'image_count', minimum: 1, maximum: 4 }]],
    ['decision', 'decision', ['decision'], 'decisions', [{ option: 'image_count', minimum: 0, maximum: 4 }]],
    ['video_generation', 'text_to_video', ['text'], 'mp4_base64', [{ option: 'frames', minimum: 1, maximum: 64 }]],
  ].map(([capability, semantic_task, input_formats, output, option_bounds]) => ({ capability, semantic_task, input_formats,
    output_formats: [output], streaming: ['chat_generation', 'text_generation'].includes(capability),
    availability: capability === 'audio_classification' ? { state: 'unavailable', reason: 'unsupported_adapter' } :
      capability === 'video_generation' ? { state: 'warming_up', eta_seconds: 3 } : { state: 'available' },
    option_bounds: option_bounds.map(bound => ({ ...bound })), provider_hint: 'additive field' }));
}
export function capabilities(model = 'fixture/model', profile = 'fixture-profile') {
  return { supported_contract_versions: [1, 2], model, profile, max_request_bytes: 33554432,
    max_response_bytes: 33554432, max_stream_event_bytes: 262144, context_tokens: 4096, generation_hint: 'additive', capabilities: descriptors() };
}
export const SERVING = Object.freeze({ model: 'fixture/model', profile: 'fixture-profile', profile_required: false });
// A valid template request for one adapter, with attachments filled in.
export function request(capability = 'text_generation', serving = SERVING) {
  const descriptor = capabilities().capabilities.find(item => item.capability === capability);
  const value = template(capability, serving, 'test:1', descriptor);
  if (capability === 'audio_transcription') Object.assign(value.input, { sample_count: 2, data_base64: 'AAAAAA==' });
  if (capability === 'image_to_text') value.input.messages[0].content[1].data_base64 = PNG;
  return value;
}
export function servedModels(mode = 'success') {
  const entry = (model, profile, profile_required, capabilities) => ({ model, profile, model_id: `library/${model}`, provider: 'llama_cpp',
    load_state: 'loaded', context_tokens: 4096, profile_required, capabilities, served_since: 'additive field' });
  const shared = descriptors().filter(d => d.capability === 'text_generation');
  return { supported_contract_versions: [1], max_request_bytes: 33554432, max_response_bytes: 33554432, max_stream_event_bytes: 262144,
    models: mode === 'empty' ? [] : [entry('fixture/model', 'fixture-profile', false, descriptors()),
      entry('fixture/shared', 'shared-a', true, shared), entry('fixture/shared', 'shared-b', true, shared),
      { model: ' not addressable ', profile: 'x', profile_required: false, capabilities: [] }] };
}
function operationError(request_id, code, outcome, message, status) { return [{ contract_version: 1, request_id, error: { code, outcome, message } }, status]; }
function decisionAnswers(questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    if (q.type === 'choice') {
      const options = Object.keys(q.criteria);
      const probabilities = Object.fromEntries(options.map((option, i) => [option, i === 0 ? 0.7 : 0.3 / (options.length - 1)]));
      return [id, { type: 'choice', choice: options[0], probabilities, confidence: 0.7, provider_private: 'ignored' }];
    }
    if (q.type === 'score') {
      const legend = Object.fromEntries(q.criteria.map((text, i) => [String(i), text]));
      const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 2 ? 0.6 : 0.4 / (q.criteria.length - 1)]));
      return [id, { type: 'score', score: 1.9, legend, probabilities, confidence: 0.6 }];
    }
    return [id, { type: 'noul', noul: 0.92 }];
  }));
}
export async function startFixture() {
  const state = { mode: 'success', operations: [], requests: [], disconnects: 0, pending: new Set() };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    state.requests.push({ path: req.url, headers: req.headers, body });
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/.well-known/pumas') return json({ advertisement_schema_version: 1, endpoint: state.endpoint,
      instance: { generation: FENCE.instance }, service_generation: FENCE.service,
      build_info: { component: 'SIMULATED contract fixture — not inference', package_version: 'test-only', schemas: [{ name: 'pumas.http-admission-fence', version: 1 }] } });
    if (req.headers['pumas-instance-generation'] !== FENCE.instance || req.headers['pumas-service-generation'] !== FENCE.service || state.mode === 'stale') return json({ error: 'stale fixture fence' }, 412);
    if (req.url === '/v1/served-models') {
      if (state.mode === 'no-served-models') return json({ error: 'fixture route not found' }, 404);
      return json(servedModels(state.mode));
    }
    if (req.url === '/rpc') return json({ jsonrpc: '2.0', id: body.id, result: { success: true, plugins: [{ id: 'torch', displayName: 'Simulated Torch manifest', installationType: 'python-venv' }] } });
    if (req.url.startsWith('/v1/capabilities?')) {
      const query = new URL(req.url, state.endpoint).searchParams;
      const model = query.get('model'), profile = query.get('profile');
      if (model === 'fixture/shared' && !profile) return json(...operationError(null, 'ambiguous_model', 'not_admitted', 'model fixture/shared is served by profiles shared-a, shared-b; supply profile', 409));
      if (!['fixture/model', 'fixture/shared'].includes(model)) return json(...operationError(null, 'model_not_found', 'not_admitted', `no served model named ${model}`, 404));
      const value = capabilities(model, profile ?? 'fixture-profile');
      if (model === 'fixture/shared') value.capabilities = value.capabilities.filter(d => d.capability === 'text_generation');
      if (state.mode === 'unavailable') value.capabilities.forEach(c => { c.availability = { state: 'unavailable', reason: 'runtime_unavailable' }; });
      if (state.mode === 'malformed-capabilities') value.capabilities[0].availability = {};
      return json(value);
    }
    if (req.url === '/v1/model-operations') {
      state.operations.push(body);
      if (state.mode === 'hang') { state.pending.add(res); res.once('close', () => { state.disconnects++; state.pending.delete(res); }); return; }
      if (state.mode === 'disconnect') { req.socket.destroy(); return; }
      if (state.mode === 'redirect') { res.writeHead(307, { location: '/v1/model-operations' }); res.end(); return; }
      if (state.mode === 'oversize') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('x'.repeat(4096)); return; }
      if (state.mode === 'not-json') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Bearer fixture-secret'); return; }
      if (state.mode === 'provider-error') return json(...operationError(body.request_id, 'provider_failure', 'unknown', 'llama.cpp reported: context window exceeded (4096 tokens). Bearer test-private-token', 502));
      if (state.mode === 'not-admitted') return json(...operationError(body.request_id, 'capability_unavailable', 'not_admitted', 'text_generation is unavailable: runtime_unavailable: the serving runtime is not ready for this model', 503));
      if (state.mode === 'null-id-error') return json(...operationError(null, 'invalid_request', 'not_admitted', 'request does not match the contract: unknown field `optoins`', 400));
      if (state.mode === 'future-error') return json(...operationError(body.request_id, 'quota_exhausted', 'not_admitted_later', 'a future error code', 429));
      const result = body.output === 'png_base64' ? { kind: 'image', png_base64: state.mode === 'invalid-image' ? 'iVBORw0KGgo=' : PNG, seed: 42 } :
        body.output === 'embeddings_float32' ? { kind: 'embeddings', vectors: (body.input.texts ?? body.input.items ?? [body.input.text]).map((_, i) => i % 2 ? [0.6, 0.8] : [1, 0]) } :
          body.output === 'decisions' ? { kind: 'decisions', answers: decisionAnswers(body.input.questions), input_tokens: 87 } :
            { kind: 'text', text: 'SIMULATED adapter response. No model inference occurred.', finish_reason: state.mode === 'future-finish' ? 'tool_calls' : 'stop', usage: { additive: true } };
      return json({ contract_version: 1, request_id: state.mode === 'wrong-id' ? 'wrong-id' : body.request_id, result, timing: { additive: true } });
    }
    json({ error: 'fixture route not found' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state.endpoint = `http://127.0.0.1:${server.address().port}`;
  return { state, server, async close() { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; } };
}
