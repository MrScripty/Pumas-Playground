import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, validateRequest, decodeResult, decodeCapabilities, decodeServedModels, decodeError, capabilityRows,
  admit, adapterFor, template, cosine } from '../contract.mjs';
import { backendUrl, redact } from '../transport.mjs';
import { capabilities, servedModels, request, SERVING, PNG } from './fixture.mjs';

const ok = (result, id = 'test:1') => ({ contract_version: 1, request_id: id, result });
test('public v1 request subsets match documented shapes for eight adapters', () => {
  for (const name of ADAPTERS) {
    const value = request(name); assert.equal(validateRequest(value), value);
    assert.equal(admit(value, capabilities()).capability, name);
  }
  const audio = request('audio_transcription');
  assert.deepEqual(audio.input, { kind: 'audio', encoding: 'pcm_s16le', sample_rate_hz: 16000, channels: 1, sample_count: 2, data_base64: 'AAAAAA==' });
  assert.equal(request('image_generation').options.width, 512);
  assert.equal(request('decision').output, 'decisions');
  assert.equal(request('multimodal_embedding').input.kind, 'content_batch');
});
test('profile is sent only when required; max_tokens defaults come from the served descriptor', () => {
  assert.equal(Object.hasOwn(request(), 'profile'), false);
  assert.equal(request('text_generation', { model: 'fixture/shared', profile: 'shared-a', profile_required: true }).profile, 'shared-a');
  assert.equal(request().options.max_tokens, 256);
  const small = { option_bounds: [{ option: 'max_tokens', minimum: 1, maximum: 64 }] };
  assert.equal(template('chat_generation', SERVING, 'x', small).options.max_tokens, 64);
  // No hardcoded 512 cap: the served context bound is authoritative.
  const long = request(); long.options.max_tokens = 4000; validateRequest(long); admit(long, capabilities());
  long.options.max_tokens = 4097; assert.throws(() => admit(long, capabilities()), /max_tokens must be in \[1, 4096\]/);
});
test('one request grammar: capability, semantic_task, options, profile and stream are optional', () => {
  const minimal = { contract_version: 1, request_id: 'test:1', model: 'fixture/model', input: { kind: 'text_batch', texts: ['a', 'b'] }, output: 'embeddings_float32' };
  validateRequest(minimal); assert.equal(admit(minimal, capabilities()).capability, 'text_embedding');
  const image = { contract_version: 1, request_id: 'test:1', model: 'fixture/model', input: { kind: 'image', encoding: 'png', data_base64: PNG }, output: 'embeddings_float32' };
  assert.equal(adapterFor(image), 'multimodal_embedding'); assert.equal(admit(image, capabilities()).capability, 'multimodal_embedding');
  const decision = { ...minimal, input: structuredClone(request('decision').input), output: 'decisions' };
  assert.equal(admit(decision, capabilities()).capability, 'decision');
  const tagged = { ...minimal, semantic_task: 'text_embedding' }; admit(tagged, capabilities());
  assert.throws(() => admit({ ...minimal, semantic_task: 'text_to_image' }, capabilities()), /capability/);
  // `text` → `text` is accepted by chat and text generation alike: Pumas would answer 409.
  const ambiguous = { contract_version: 1, request_id: 'test:1', model: 'fixture/model', input: { kind: 'text', text: 'hi' }, output: 'text' };
  assert.throws(() => admit(ambiguous, capabilities()), e => e.code === 'ambiguous_operation' && /chat_generation, text_generation/.test(e.message));
  const chatText = request('chat_generation'); chatText.input = { kind: 'text', text: 'hi' }; admit(chatText, capabilities());
  assert.throws(() => validateRequest({ ...request('image_generation'), options: undefined }), /width and height/);
});
test('closed requests reject invalid variants, unsafe resource requests and input metadata', () => {
  const cases = [
    r => { r.extra = true; }, r => { r.stream = true; }, r => { r.options.max_tokens = 0; },
    r => { r.options.temperature = NaN; }, r => { r.request_id = 'bad id'; }, r => { r.options.unknown = 1; },
    r => { r.profile = ''; }, r => { r.capability = 'generation_3d'; }, r => { r.input.kind = 'audio'; },
    r => { r.output = 'png_base64'; }, r => { r.model = ' model '; }, r => { r.options.kind = 'embeddings'; },
  ];
  for (const change of cases) { const value = request(); change(value); assert.throws(() => validateRequest(value)); }
  const audio = request('audio_transcription'); audio.input.sample_count = 3;
  assert.throws(() => validateRequest(audio), /frames/);
  const floats = request('audio_transcription'); Object.assign(floats.input, { encoding: 'pcm_f32le', sample_count: 1, data_base64: 'AADAfw==' });
  assert.throws(() => validateRequest(floats), /number/);
  const image = request('image_generation'); image.options.width = 2048;
  image.options.height = 2048; assert.throws(() => validateRequest(image), /pixel/);
  const vision = request('image_to_text'); vision.input.messages[0].content[1].data_base64 = 'AAAA';
  assert.throws(() => validateRequest(vision), /signature/);
});
test('multimodal embedding accepts images and mixed content batches within image bounds', () => {
  const value = request('multimodal_embedding');
  value.input.items.push({ parts: [{ kind: 'text', text: 'caption' }, { kind: 'image', encoding: 'png', data_base64: PNG }] });
  validateRequest(value); admit(value, capabilities());
  for (let i = 0; i < 4; i++) value.input.items.push({ parts: [{ kind: 'image', encoding: 'png', data_base64: PNG }] });
  assert.throws(() => validateRequest(value), e => e.code === 'request_limit');
  const bad = request('multimodal_embedding'); bad.input.items[0].parts[0] = { kind: 'image', encoding: 'jpeg', data_base64: PNG };
  assert.throws(() => validateRequest(bad), /signature/);
  const empty = request('multimodal_embedding'); empty.input.items = [{ parts: [] }];
  assert.throws(() => validateRequest(empty), /parts/);
  const embedded = decodeResult(ok({ kind: 'embeddings', vectors: [[1, 0], [0.6, 0.8]] }), request('multimodal_embedding'));
  assert.equal(embedded.result.vectors.length, 2);
  assert.throws(() => decodeResult(ok({ kind: 'embeddings', vectors: [[1, 0]] }), request('multimodal_embedding')), /embedding/);
  assert.equal(cosine([1, 0], [0.6, 0.8]).toFixed(2), '0.60'); assert.equal(cosine([0, 0], [1, 1]), 0);
});
test('decision requests validate typed questions and results project typed answers', () => {
  const value = request('decision'); validateRequest(value);
  value.input.state = 'A plain string state'; validateRequest(value);
  value.input.images = [{ encoding: 'png', data_base64: PNG }]; validateRequest(value); admit(value, capabilities());
  const cases = [
    r => { r.input.questions = {}; }, r => { r.input.questions.team.type = 'rank'; },
    r => { r.input.questions.team.criteria = { only: null }; }, r => { r.input.questions.urgency.criteria = 'low,high'; },
    r => { r.input.questions['bad id'] = r.input.questions.team; }, r => { r.input.questions.refund.extra = 1; },
    r => { r.input.images = [{ kind: 'image', encoding: 'png', data_base64: PNG }]; }, r => { r.input.state = null; },
    r => { r.options = { kind: 'decision', temperature: 1 }; },
  ];
  for (const change of cases) { const bad = request('decision'); change(bad); assert.throws(() => validateRequest(bad)); }
  const answers = {
    team: { type: 'choice', choice: 'engineering', probabilities: { billing: 0.2, engineering: 0.7, account: 0.1 }, confidence: 0.7, extra: 'ignored' },
    urgency: { type: 'score', score: 2.4, legend: { 0: 'Not urgent', 1: 'a', 2: 'b', 3: 'c' }, probabilities: { 0: 0.1, 1: 0.1, 2: 0.1, 3: 0.7 }, confidence: 0.7 },
    refund: { type: 'noul', noul: 0.93 },
  };
  const decoded = decodeResult(ok({ kind: 'decisions', answers, input_tokens: 120, timing_ms: 4 }), request('decision'));
  assert.equal(decoded.state, 'succeeded'); assert.equal(decoded.result.input_tokens, 120);
  assert.deepEqual(Object.keys(decoded.result.answers.team), ['type', 'choice', 'probabilities', 'confidence']);
  assert.equal(decoded.result.answers.refund.noul, 0.93);
  for (const change of [a => { delete a.refund; }, a => { a.refund.type = 'choice'; }, a => { a.team.probabilities.billing = 1.5; }, a => { a.urgency.score = 'high'; }, a => { a.refund.noul = -0.1; }]) {
    const bad = structuredClone(answers); change(bad);
    assert.throws(() => decodeResult(ok({ kind: 'decisions', answers: bad }), request('decision')), e => e.code === 'invalid_response');
  }
});
test('8 MiB attachments validate without regex stack overflow; padding and decoded byte overflow fail', () => {
  const value = request('image_to_text');
  const data = Buffer.alloc(8 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  value.input.messages[0].content[1].data_base64 = data.toString('base64');
  assert.equal(validateRequest(value), value);
  value.input.messages[0].content[1].data_base64 = Buffer.concat([data, Buffer.from([0])]).toString('base64');
  assert.throws(() => validateRequest(value), e => e.code === 'request_limit');
  value.input.messages[0].content[1].data_base64 = 'AA=A';
  assert.throws(() => validateRequest(value), /padding/);
});
test('capability support never implies inference coverage; unknown capabilities render as unsupported cards', () => {
  const cap = decodeCapabilities(capabilities(), 'fixture/model', 'fixture-profile');
  const rows = capabilityRows(cap);
  for (const name of ADAPTERS) assert.equal(rows.find(r => r.capability === name).support, 'supported');
  assert.ok(rows.every(r => r.execution === 'untested'));
  for (const name of ['audio_generation', 'image_editing', 'generation_3d']) assert.equal(rows.find(r => r.capability === name).support, 'unavailable');
  assert.equal(rows.find(r => r.capability === 'audio_classification').support, 'unsupported');
  const future = rows.find(r => r.capability === 'video_generation');
  assert.equal(future.support, 'unsupported'); assert.match(future.reason, /Not supported by this playground/);
  assert.ok(capabilityRows(null).every(r => r.support === 'untested'));
  const raw = capabilities(); raw.capabilities[1].option_bounds = [{ option: 'max_tokens', minimum: 1, maximum: 32 }];
  const capped = request(); capped.options.max_tokens = 33;
  assert.throws(() => admit(capped, raw), /32/);
  raw.capabilities[1].availability = { state: 'unavailable', reason: 'runtime_unavailable' };
  assert.throws(() => admit(request(), raw), e => e.code === 'capability_unavailable');
  const futureRequest = { ...request(), capability: 'video_generation' };
  assert.throws(() => validateRequest(futureRequest), e => e.code === 'unsupported_adapter');
});
test('discovery decoding ignores additive fields, unknown descriptors, enum values and extra entries', () => {
  const raw = capabilities();
  raw.capabilities.push({ capability: 'hologram', shape: 'not a descriptor' }, { ...raw.capabilities[0], option_bounds: 'duplicate ignored' });
  raw.capabilities[1].availability = { state: 'available', since: 'now' };
  raw.capabilities[1].option_bounds.push({ option: 'reasoning_effort', minimum: 0, maximum: 3 });
  const decoded = decodeCapabilities(raw, 'fixture/model', 'fixture-profile');
  assert.equal(decoded.context_tokens, 4096); assert.equal(Object.hasOwn(decoded, 'generation_hint'), false);
  assert.equal(decoded.capabilities.filter(c => c.capability === 'chat_generation').length, 1);
  assert.equal(decoded.capabilities.find(c => c.capability === 'hologram').availability.state, 'unavailable');
  assert.deepEqual(decoded.capabilities.find(c => c.capability === 'video_generation').availability, { state: 'unavailable', reason: 'warming_up' });
  const served = decodeServedModels(servedModels());
  assert.equal(served.models.length, 3); assert.equal(served.skipped, 1);
  assert.deepEqual(served.models.map(m => [m.model, m.profile, m.profile_required]),
    [['fixture/model', 'fixture-profile', false], ['fixture/shared', 'shared-a', true], ['fixture/shared', 'shared-b', true]]);
  assert.equal(served.models[0].provider, 'llama_cpp'); assert.equal(served.models[0].context_tokens, 4096);
  assert.equal(Object.hasOwn(served.models[0], 'served_since'), false);
  assert.deepEqual(decodeServedModels(servedModels('empty')).models, []);
  assert.throws(() => decodeServedModels({ ...servedModels(), supported_contract_versions: [2] }), e => e.code === 'unsupported_contract');
  assert.throws(() => decodeServedModels({ ...servedModels(), models: 'none' }), e => e.code === 'invalid_response');
});
test('malformed discovery and incoherent results are not successful inference', () => {
  const cap = capabilities(); cap.capabilities[0].availability = {};
  assert.throws(() => decodeCapabilities(cap, 'fixture/model'), /descriptor/);
  const badLimit = capabilities(); badLimit.max_request_bytes = '33554432';
  assert.throws(() => decodeCapabilities(badLimit, 'fixture/model'), e => e.code === 'invalid_response');
  const value = ok({ kind: 'text', text: 'controlled', finish_reason: 'stop' });
  assert.equal(decodeResult(value, request()).state, 'succeeded');
  assert.deepEqual(decodeResult({ ...value, usage: {}, result: { ...value.result, provider_private: 'never projected' } }, request()).result, value.result);
  assert.equal(decodeResult({ ...value, result: { ...value.result, finish_reason: 'tool_calls' } }, request()).result.finish_reason, 'tool_calls');
  assert.throws(() => decodeResult({ ...value, request_id: 'different' }, request()), /correlation/);
  assert.throws(() => decodeResult({ ...value, result: { ...value.result, finish_reason: 7 } }, request()), /text result/);
  assert.throws(() => decodeResult(ok({ kind: 'mystery' }), request('image_generation')), /image result/);
  const embedding = request('text_embedding');
  assert.throws(() => decodeResult(ok({ kind: 'embeddings', vectors: [[Infinity]] }), embedding), /embedding/);
});
test('typed errors keep message and authoritative outcome; null request_id and unknown codes are tolerated', () => {
  const error = (request_id, body) => ({ contract_version: 1, request_id, error: body });
  assert.deepEqual(decodeResult(error('test:1', { code: 'provider_failure', outcome: 'unknown', message: 'llama.cpp: out of memory' }), request()),
    { state: 'error', error: { code: 'provider_failure', outcome: 'unknown', message: 'llama.cpp: out of memory' } });
  assert.deepEqual(decodeResult(error(null, { code: 'invalid_request', outcome: 'not_admitted', message: 'unknown field `optoins`' }), request()).error,
    { code: 'invalid_request', outcome: 'not_admitted', message: 'unknown field `optoins`' });
  assert.deepEqual(decodeResult(error('test:1', { code: 'quota_exhausted', outcome: 'not_admitted', message: 'later', hint: 'additive' }), request()).error,
    { code: 'quota_exhausted', outcome: 'not_admitted', message: 'later' });
  // An unrecognized outcome cannot be proven harmless, so it is reported as unknown.
  assert.equal(decodeError(error('x', { code: 'provider_failure', outcome: 'maybe' })).outcome, 'unknown');
  assert.match(decodeError(error('x', { code: 'provider_failure', outcome: 'unknown' })).message, /without a message/);
  assert.equal(decodeError(error('x', { code: 'BAD CODE', outcome: 'not_admitted', message: 'm'.repeat(5000) })).message.length, 1024);
  assert.equal(decodeError({ error: 'stale fixture fence' }), null);
  assert.throws(() => decodeResult(error('other', { code: 'invalid_request', outcome: 'not_admitted', message: 'x' }), request()), /correlation/);
});
test('endpoint containment and receipts redact selected secrets and binary data', () => {
  assert.equal(backendUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const url of ['https://127.0.0.1', 'http://localhost', 'http://example.com', 'http://127.0.0.1@evil.example', 'http://127.0.0.1/?token=secret', 'http://127.0.0.1/path']) assert.throws(() => backendUrl(url));
  const safe = JSON.stringify(redact({ api_key: 'private', text: 'Bearer abc123 hf_abcdefgh1234 literal-secret https://u:p@local/a?token=no', data_base64: PNG, max_tokens: 32, input_tokens: 87 }, ['literal-secret']));
  for (const forbidden of ['private', 'abc123', 'abcdefgh1234', 'literal-secret', 'u:p', 'token=no', PNG]) assert.ok(!safe.includes(forbidden));
  assert.ok(safe.includes('"max_tokens":32')); assert.ok(safe.includes('"input_tokens":87'));
});
