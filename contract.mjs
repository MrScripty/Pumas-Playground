// Consumer subset of the public v1 DTOs (Pumas v0.8); Pumas remains the admission authority.
// Requests are closed and validated before dispatch. Responses are decoded tolerantly:
// unknown fields, capabilities, enum values and extra list entries are ignored, never fatal.
export const LIMITS = Object.freeze({ requestBytes: 16 * 1024 * 1024,
  responseBytes: 32 * 1024 * 1024, fileBytes: 8 * 1024 * 1024,
  imagePixels: 1024 * 1024, images: 4, defaultMaxTokens: 256, errorMessageChars: 1024 });
export const MODALITIES = Object.freeze([
  ['chat_generation', 'Chat'], ['text_generation', 'Text'],
  ['text_embedding', 'Embeddings'], ['multimodal_embedding', 'Multimodal embeddings'],
  ['decision', 'Decision'], ['audio_transcription', 'Transcription'],
  ['audio_generation', 'Audio generation'], ['image_generation', 'Image generation'],
  ['image_to_text', 'Image to text'], ['image_editing', 'Image editing'],
  ['generation_3d', '3D generation'], ['audio_classification', 'Audio classification'],
]);
export const ADAPTERS = new Set(['chat_generation', 'text_generation', 'text_embedding',
  'multimodal_embedding', 'decision', 'audio_transcription', 'image_generation', 'image_to_text']);
const OUTPUTS = Object.freeze({ chat_generation: 'text', text_generation: 'text', text_embedding: 'embeddings_float32',
  multimodal_embedding: 'embeddings_float32', decision: 'decisions', audio_transcription: 'text',
  image_generation: 'png_base64', image_to_text: 'text' });
const OPTION_KINDS = Object.freeze({ chat_generation: 'text_generation', text_generation: 'text_generation',
  image_to_text: 'text_generation', text_embedding: 'embeddings', multimodal_embedding: 'embeddings',
  decision: 'decision', audio_transcription: 'audio', image_generation: 'image_generation' });
const U32 = 4294967295;
export class PlaygroundError extends Error {
  constructor(code, message, outcome = 'not_admitted') {
    super(message); this.code = code; this.outcome = outcome;
  }
}
export function assert(condition, message, code = 'invalid_request') {
  if (!condition) throw new PlaygroundError(code, message);
}
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function closed(value, required, optional = []) {
  assert(object(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => [...required, ...optional].includes(key)), 'Invalid or unexpected fields.');
}
function text(value, max = 65536, min = 0) {
  assert(typeof value === 'string' && value.length >= min && value.length <= max, 'Text length is outside the supported bound.');
}
function number(value, min, max, integer = true) {
  assert(typeof value === 'number' && Number.isFinite(value) && (!integer || Number.isInteger(value)) &&
    value >= min && value <= max, `Expected ${integer ? 'integer' : 'number'} in [${min}, ${max}].`);
}
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function identity(value, name = 'model') {
  text(value, 256, 1);
  assert(value.trim() === value && !/[\x00-\x20\x7f]/.test(name === 'profile' ? value : value.replaceAll(' ', '')) &&
    new TextEncoder().encode(value).length <= 256, `Invalid ${name} identity.`);
  return value;
}
function bytes(base64) {
  assert(typeof base64 === 'string' && base64.length <= Math.ceil(LIMITS.fileBytes / 3) * 4 &&
    base64.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(base64), 'Expected bounded standard base64.');
  let decoded;
  try { decoded = atob(base64); } catch { throw new PlaygroundError('invalid_request', 'Invalid base64 padding or encoding.'); }
  assert(decoded.length <= LIMITS.fileBytes, 'Decoded file exceeds the byte bound.', 'request_limit');
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
// `kind` is absent on decision images; every other image part is tagged.
function image(input, tagged = true) {
  closed(input, tagged ? ['kind', 'encoding', 'data_base64'] : ['encoding', 'data_base64']);
  assert((!tagged || input.kind === 'image') && ['png', 'jpeg'].includes(input.encoding), 'Expected PNG or JPEG image.');
  const data = bytes(input.data_base64);
  assert(data.length > 0 && (input.encoding === 'png'
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => data[i] === b)
    : data[0] === 255 && data[1] === 216 && data[2] === 255), 'Image signature does not match encoding.');
}
function parts(list, label) {
  assert(Array.isArray(list) && list.length >= 1 && list.length <= 32, `Expected 1–32 ${label} parts.`);
  let images = 0;
  for (const part of list) {
    assert(object(part), `Expected tagged ${label} parts.`);
    if (part.kind === 'text') { closed(part, ['kind', 'text']); text(part.text); } else { image(part); images++; }
  }
  return images;
}
function options(value, capability) {
  if (value.options === undefined) {
    assert(capability !== 'image_generation', 'image_generation requires options with width and height.');
    return;
  }
  const opts = value.options;
  assert(object(opts) && opts.kind === OPTION_KINDS[capability], `Expected ${OPTION_KINDS[capability]} options.`);
  if (opts.kind === 'text_generation') {
    closed(opts, ['kind'], ['max_tokens', 'temperature', 'top_p']);
    if (opts.max_tokens !== undefined) number(opts.max_tokens, 1, U32);
    if (opts.temperature !== undefined) number(opts.temperature, 0, 2, false);
    if (opts.top_p !== undefined) number(opts.top_p, 0, 1, false);
  } else if (opts.kind === 'embeddings') {
    closed(opts, ['kind'], ['dimensions']);
    if (opts.dimensions !== undefined) number(opts.dimensions, 1, 8192);
  } else if (opts.kind === 'image_generation') {
    closed(opts, ['kind', 'width', 'height'], ['seed']);
    number(opts.width, 1, 2048); number(opts.height, 1, 2048);
    assert(opts.width * opts.height <= LIMITS.imagePixels, 'Playground image limit is 1,048,576 pixels.');
    if (opts.seed !== undefined) number(opts.seed, 0, U32);
  } else if (opts.kind === 'audio') {
    closed(opts, ['kind'], ['max_output_tokens', 'language']);
    if (opts.max_output_tokens !== undefined) number(opts.max_output_tokens, 1, U32);
    if (opts.language !== undefined) assert(['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'vi', 'zh', 'ar', 'ja', 'ko'].includes(opts.language), 'Unsupported language.');
  } else closed(opts, ['kind']);
}
function decisionQuestion(id, question) {
  assert(/^[A-Za-z0-9_.:-]{1,128}$/.test(id), 'Decision question ids are 1–128 of A-Za-z0-9_.:-.');
  closed(question, ['type', 'instructions'], ['criteria']);
  assert(['choice', 'score', 'noul'].includes(question.type), 'Decision question type is choice, score or noul.');
  assert(question.instructions !== null && question.instructions !== undefined, 'Decision questions need instructions.');
  const { criteria } = question;
  if (question.type === 'choice') {
    assert(object(criteria) && Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 64 &&
      Object.values(criteria).every(v => v === null || typeof v === 'string'), 'Choice criteria map 2–64 options to a description or null.');
  } else if (question.type === 'score') {
    assert(Array.isArray(criteria) && criteria.length >= 2 && criteria.length <= 64 &&
      criteria.every(v => typeof v === 'string'), 'Score criteria list 2–64 level descriptions, lowest first.');
  } else if (criteria !== undefined) {
    closed(criteria, [], ['true', 'false']);
    assert(Object.values(criteria).every(v => typeof v === 'string'), 'Noul criteria describe true and false.');
  }
}
// The playground adapter selected for a request: explicit, or inferred like Pumas
// resolves an unnamed operation from input kind and output.
export function adapterFor(request) {
  if (request.capability !== undefined) return request.capability;
  const kind = request.input?.kind, output = request.output;
  if (output === 'decisions' || kind === 'decision') return 'decision';
  if (output === 'png_base64') return 'image_generation';
  if (output === 'embeddings_float32') return ['image', 'content_batch'].includes(kind) ? 'multimodal_embedding' : 'text_embedding';
  if (kind === 'audio') return 'audio_transcription';
  if (['image', 'image_messages'].includes(kind)) return 'image_to_text';
  if (kind === 'messages') return 'chat_generation';
  return 'text_generation';
}
export function validateRequest(value) {
  closed(value, ['contract_version', 'request_id', 'model', 'input', 'output'], ['profile', 'capability', 'semantic_task', 'options', 'stream']);
  assert(value.contract_version === 1 && (value.stream === undefined || value.stream === false), 'This harness supports finite contract v1 operations only.');
  assert(typeof value.request_id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.request_id), 'Invalid request ID.');
  identity(value.model); if (value.profile !== undefined) identity(value.profile, 'profile');
  if (value.semantic_task !== undefined) assert(typeof value.semantic_task === 'string' && /^[a-z0-9_]{1,64}$/.test(value.semantic_task), 'Invalid semantic_task.');
  const capability = adapterFor(value);
  assert(ADAPTERS.has(capability), 'No reviewed public adapter for this capability.', 'unsupported_adapter');
  const { input } = value;
  assert(object(input), 'Expected a tagged input.');
  if (capability === 'chat_generation' && input.kind === 'messages') {
    closed(input, ['kind', 'messages']);
    assert(Array.isArray(input.messages) && input.messages.length > 0 && input.messages.length <= 32, 'Expected 1–32 text messages.');
    for (const message of input.messages) {
      closed(message, ['role', 'content']);
      assert(['system', 'user', 'assistant'].includes(message.role), 'Unsupported message role.');
      text(message.content);
    }
  } else if (['chat_generation', 'text_generation', 'image_generation'].includes(capability)) {
    closed(input, ['kind', 'text']); assert(input.kind === 'text', `Expected ${capability === 'chat_generation' ? 'messages or ' : ''}text input.`);
    text(input.text, capability === 'image_generation' ? 4000 : 65536, 1);
  } else if (capability === 'text_embedding') {
    const texts = input.kind === 'text' ? [input.text] : input.texts;
    closed(input, ['kind', input.kind === 'text' ? 'text' : 'texts']);
    assert(['text', 'text_batch'].includes(input.kind) && Array.isArray(texts) && texts.length >= 1 && texts.length <= 128, 'Expected 1–128 texts.');
    texts.forEach(item => text(item));
    assert(texts.reduce((n, item) => n + item.length, 0) <= 65536, 'Embedding input exceeds 65,536 characters.');
  } else if (capability === 'multimodal_embedding') {
    if (input.kind === 'image') image(input);
    else {
      closed(input, ['kind', 'items']);
      assert(input.kind === 'content_batch' && Array.isArray(input.items) && input.items.length >= 1 && input.items.length <= 128, 'Expected an image or a content_batch of 1–128 items.');
      let images = 0;
      for (const item of input.items) { closed(item, ['parts']); images += parts(item.parts, 'content'); }
      assert(images <= LIMITS.images, `At most ${LIMITS.images} images per request.`, 'request_limit');
    }
  } else if (capability === 'image_to_text') {
    if (input.kind === 'image') image(input);
    else {
      closed(input, ['kind', 'messages']);
      assert(input.kind === 'image_messages' && Array.isArray(input.messages) && input.messages.length >= 1 && input.messages.length <= 32, 'Expected an image or 1–32 image messages.');
      let images = 0;
      for (const message of input.messages) {
        closed(message, ['role', 'content']);
        assert(['system', 'user', 'assistant'].includes(message.role), 'Unsupported message role.');
        images += parts(message.content, 'message');
      }
      assert(images >= 1 && images <= LIMITS.images, `Expected 1–${LIMITS.images} images.`, images ? 'request_limit' : 'invalid_request');
    }
  } else if (capability === 'decision') {
    closed(input, ['kind', 'state', 'questions'], ['images']);
    assert(input.kind === 'decision', 'Expected decision input.');
    assert(input.state !== null && input.state !== undefined && (typeof input.state !== 'string' || input.state.length >= 1), 'Decision state is a nonempty string or a JSON value.');
    assert(object(input.questions) && Object.keys(input.questions).length >= 1 && Object.keys(input.questions).length <= 64, 'Expected 1–64 decision questions.');
    for (const [id, question] of Object.entries(input.questions)) decisionQuestion(id, question);
    if (input.images !== undefined) {
      assert(Array.isArray(input.images) && input.images.length <= LIMITS.images, `At most ${LIMITS.images} decision images.`, 'request_limit');
      input.images.forEach(item => image(item, false));
    }
  } else if (capability === 'audio_transcription') {
    closed(input, ['kind', 'encoding', 'sample_rate_hz', 'channels', 'sample_count', 'data_base64']);
    assert(input.kind === 'audio' && ['pcm_s16le', 'pcm_f32le'].includes(input.encoding), 'Expected raw little-endian PCM. WAV/MP3 containers must be converted explicitly.');
    number(input.sample_rate_hz, 8000, 192000); number(input.channels, 1, 2);
    number(input.sample_count, 1, input.sample_rate_hz * 30);
    const data = bytes(input.data_base64);
    const sampleBytes = input.encoding === 'pcm_s16le' ? 2 : 4;
    assert(data.length === input.sample_count * input.channels * sampleBytes, 'PCM byte length and declared frames do not match.');
    if (sampleBytes === 4) {
      const view = new DataView(data.buffer);
      for (let i = 0; i < data.length; i += 4) number(view.getFloat32(i, true), -1, 1, false);
    }
  }
  options(value, capability);
  assert(value.output === OUTPUTS[capability], 'Output does not match the selected capability.');
  assert(new TextEncoder().encode(JSON.stringify(value)).length <= LIMITS.requestBytes, 'Request exceeds playground byte limit.', 'request_limit');
  return value;
}
// Descriptor decoding. A descriptor for a capability this playground drives must carry
// every consumed field; any other descriptor only needs a name and is shown as unsupported.
function decodeDescriptor(item) {
  assert(object(item) && typeof item.capability === 'string' && item.capability.length <= 128, 'Malformed capability descriptor.', 'invalid_response');
  const strings = list => Array.isArray(list) && list.every(x => typeof x === 'string');
  const wellFormed = typeof item.semantic_task === 'string' && strings(item.input_formats) && strings(item.output_formats) &&
    object(item.availability) && typeof item.availability.state === 'string' &&
    (item.availability.state === 'available' || typeof item.availability.reason === 'string' || item.availability.reason === undefined) &&
    Array.isArray(item.option_bounds);
  assert(wellFormed || !ADAPTERS.has(item.capability), 'Malformed capability descriptor.', 'invalid_response');
  if (!wellFormed) return { capability: item.capability, semantic_task: null, input_formats: [], output_formats: [], streaming: false,
    availability: { state: 'unavailable', reason: 'malformed_descriptor' }, option_bounds: [] };
  // Unknown availability states are additive; only an explicit `available` admits work.
  const availability = item.availability.state === 'available' ? { state: 'available' } :
    { state: 'unavailable', reason: item.availability.reason ?? item.availability.state };
  const option_bounds = item.option_bounds.filter(bound => object(bound) && typeof bound.option === 'string' &&
    Number.isFinite(bound.minimum) && Number.isFinite(bound.maximum) && bound.minimum <= bound.maximum)
    .map(({ option, minimum, maximum }) => ({ option, minimum, maximum }));
  assert(option_bounds.length === item.option_bounds.length || !ADAPTERS.has(item.capability), 'Invalid option bounds.', 'invalid_response');
  return { capability: item.capability, semantic_task: item.semantic_task, input_formats: item.input_formats,
    output_formats: item.output_formats, streaming: item.streaming === true, availability, option_bounds };
}
function decodeDescriptors(list) {
  assert(Array.isArray(list) && list.length <= 256, 'Invalid capability list.', 'invalid_response');
  const seen = new Map();
  // The first descriptor per name wins; later duplicates are extra entries and are ignored.
  for (const item of list) if (!seen.has(item?.capability)) { const descriptor = decodeDescriptor(item); seen.set(descriptor.capability, descriptor); }
  return [...seen.values()];
}
function contextTokens(value) {
  if (value === undefined || value === null) return null;
  number(value, 1, U32); return value;
}
export function decodeCapabilities(value, model, profile) {
  try { return decodeCapabilityValue(value, model, profile); }
  catch (error) {
    if (error.code === 'unsupported_contract') throw error;
    throw new PlaygroundError('invalid_response', `Invalid capabilities: ${error.message}`);
  }
}
function decodeCapabilityValue(value, model, profile) {
  assert(object(value) && Array.isArray(value.supported_contract_versions) && value.supported_contract_versions.includes(1), 'Contract v1 capabilities unavailable.', 'unsupported_contract');
  assert(value.model === model && (!profile || value.profile === profile), 'Capability identity mismatch.', 'invalid_response');
  identity(value.profile, 'profile');
  for (const key of ['max_request_bytes', 'max_response_bytes']) number(value[key], 1, Number.MAX_SAFE_INTEGER);
  // Project only consumed fields; additive fields remain visible in redacted receipts.
  return { supported_contract_versions: value.supported_contract_versions.filter(Number.isInteger), model: value.model, profile: value.profile,
    max_request_bytes: value.max_request_bytes, max_response_bytes: value.max_response_bytes,
    context_tokens: contextTokens(value.context_tokens), capabilities: decodeDescriptors(value.capabilities) };
}
// `GET /v1/served-models`: one entry per served (model, profile). Entries this playground
// cannot address are skipped and counted rather than failing discovery.
export function decodeServedModels(value) {
  try {
    assert(object(value) && Array.isArray(value.supported_contract_versions) && value.supported_contract_versions.includes(1),
      'Pumas does not serve typed contract v1 models.', 'unsupported_contract');
    for (const key of ['max_request_bytes', 'max_response_bytes']) number(value[key], 1, Number.MAX_SAFE_INTEGER);
    assert(Array.isArray(value.models) && value.models.length <= 1024, 'Invalid served model list.', 'invalid_response');
  } catch (error) {
    if (error.code === 'unsupported_contract') throw error;
    throw new PlaygroundError('invalid_response', `Invalid served models: ${error.message}`);
  }
  const models = [], keys = new Set(); let skipped = 0;
  for (const entry of value.models) {
    try {
      assert(object(entry) && typeof entry.profile_required === 'boolean', 'Malformed served model.');
      identity(entry.model); identity(entry.profile, 'profile');
      const key = JSON.stringify([entry.model, entry.profile]);
      assert(!keys.has(key), 'Duplicate served model.'); keys.add(key);
      const label = (field, fallback) => typeof entry[field] === 'string' && entry[field].length <= 256 ? entry[field] : fallback;
      models.push({ model: entry.model, profile: entry.profile, profile_required: entry.profile_required,
        model_id: label('model_id', null), provider: label('provider', 'unknown'), load_state: label('load_state', 'unknown'),
        context_tokens: contextTokens(entry.context_tokens), capabilities: decodeDescriptors(entry.capabilities ?? []) });
    } catch { skipped++; }
  }
  return { max_request_bytes: value.max_request_bytes, max_response_bytes: value.max_response_bytes, models, skipped };
}
export function capabilityRows(discovery) {
  const known = new Map(MODALITIES);
  for (const item of discovery?.capabilities ?? []) if (!known.has(item.capability)) known.set(item.capability, item.capability);
  return [...known].map(([capability, label]) => {
    const descriptor = discovery?.capabilities.find(item => item.capability === capability);
    const available = descriptor?.availability.state === 'available';
    const support = !discovery ? 'untested' : descriptor && !ADAPTERS.has(capability) ? 'unsupported' :
      available ? 'supported' : 'unavailable';
    const reason = !discovery ? 'Inspect a served model.' : !descriptor ? 'Not advertised by this runtime.' :
      support === 'unsupported' ? `Not supported by this playground. Runtime state: ${available ? 'available' : descriptor.availability.reason}.` :
        !available ? descriptor.availability.reason : 'Runtime advertises availability; inference is untested.';
    return { capability, label, support, execution: 'untested', reason, descriptor };
  });
}
function inputFormat(request, capability) {
  const { input } = request;
  if (input.kind === 'messages' || (input.kind === 'text' && capability === 'chat_generation')) return 'messages_text';
  if (input.kind === 'image_messages') return 'messages_image';
  if (input.kind === 'image') return `${input.encoding}_base64`;
  if (input.kind === 'audio') return input.encoding;
  return input.kind;
}
function measured(request) {
  const { input } = request, values = {};
  if (input.kind === 'text_batch') values.input_count = input.texts.length;
  if (input.kind === 'content_batch') values.input_count = input.items.length;
  if (input.kind === 'text') values.input_characters = input.text.length;
  // Runtime character bounds are per input (ONNX tokenizer, image prompt).
  if (input.kind === 'text_batch') values.input_characters = Math.max(...input.texts.map(item => item.length));
  const images = input.kind === 'image' ? 1 : input.kind === 'decision' ? input.images?.length ?? 0 :
    (input.items ?? input.messages ?? []).flatMap(entry => Array.isArray(entry.parts ?? entry.content) ? entry.parts ?? entry.content : [])
      .filter(part => part.kind === 'image').length;
  if (images) values.image_count = images;
  return values;
}
// Mirrors Pumas admission against the freshly observed descriptors; returns the descriptor.
export function admit(request, capabilities) {
  validateRequest(request);
  assert(request.model === capabilities.model && (request.profile === undefined || request.profile === capabilities.profile), 'Selected serving identity changed.');
  let descriptor;
  if (request.capability !== undefined) {
    descriptor = capabilities.capabilities.find(item => item.capability === request.capability);
  } else {
    const matches = capabilities.capabilities.filter(item => item.availability.state === 'available' && ADAPTERS.has(item.capability) &&
      item.input_formats.includes(inputFormat(request, item.capability)) && item.output_formats.includes(request.output) &&
      (request.semantic_task === undefined || item.semantic_task === request.semantic_task));
    assert(matches.length <= 1, `More than one capability accepts this input and output (${matches.map(m => m.capability).join(', ')}); supply capability.`, 'ambiguous_operation');
    descriptor = matches[0] ?? capabilities.capabilities.find(item => item.capability === adapterFor(request));
  }
  assert(descriptor?.availability.state === 'available', descriptor?.availability.reason ?? 'Capability not advertised.', 'capability_unavailable');
  assert(ADAPTERS.has(descriptor.capability), 'No reviewed public adapter for this capability.', 'unsupported_adapter');
  assert(request.semantic_task === undefined || request.semantic_task === descriptor.semantic_task, 'semantic_task does not match the selected capability.');
  assert(descriptor.input_formats.includes(inputFormat(request, descriptor.capability)) && descriptor.output_formats.includes(request.output),
    'Advertised input/output format is incompatible.', 'unsupported_contract');
  const values = { ...measured(request), ...(request.options ?? {}) };
  for (const bound of descriptor.option_bounds) {
    const value = values[bound.option];
    if (typeof value === 'number') {
      try { number(value, bound.minimum, bound.maximum, false); }
      catch { throw new PlaygroundError(['input_count', 'input_characters', 'image_count'].includes(bound.option) ? 'request_limit' : 'invalid_request',
        `${bound.option} must be in [${bound.minimum}, ${bound.maximum}] for this served model.`); }
    }
  }
  assert(new TextEncoder().encode(JSON.stringify(request)).length <= capabilities.max_request_bytes, 'Runtime request byte limit exceeded.', 'request_limit');
  return descriptor;
}
// Typed error envelope: {contract_version, request_id (may be null), error:{code, outcome, message}}.
// Unknown codes are preserved; `outcome` is authoritative, and anything but `not_admitted` is unknown.
export function decodeError(value) {
  if (!object(value) || !object(value.error)) return null;
  const { code, outcome, message } = value.error;
  return { code: typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'unrecognized_error',
    outcome: outcome === 'not_admitted' ? 'not_admitted' : 'unknown',
    message: typeof message === 'string' && message.length ? message.slice(0, LIMITS.errorMessageChars) : 'Pumas reported an error without a message.' };
}
function embeddingCount(input) {
  return input.kind === 'text_batch' ? input.texts.length : input.kind === 'content_batch' ? input.items.length : 1;
}
function decodeDecisions(result, request) {
  const questions = request.input.questions;
  assert(object(result.answers) && Object.keys(result.answers).length === Object.keys(questions).length, 'Decision answers do not match the questions.', 'invalid_response');
  const probabilities = value => object(value) && Object.values(value).every(probability);
  const answers = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = result.answers[id];
    assert(object(answer) && answer.type === question.type, `Decision answer ${id} does not match its question.`, 'invalid_response');
    if (question.type === 'choice') {
      assert(typeof answer.choice === 'string' && probabilities(answer.probabilities) && probability(answer.confidence), `Invalid choice answer ${id}.`, 'invalid_response');
      answers[id] = { type: 'choice', choice: answer.choice, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
    } else if (question.type === 'score') {
      assert(typeof answer.score === 'number' && Number.isFinite(answer.score) && object(answer.legend) &&
        Object.values(answer.legend).every(v => typeof v === 'string') && probabilities(answer.probabilities) && probability(answer.confidence), `Invalid score answer ${id}.`, 'invalid_response');
      answers[id] = { type: 'score', score: answer.score, legend: { ...answer.legend }, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
    } else {
      assert(probability(answer.noul), `Invalid noul answer ${id}.`, 'invalid_response');
      answers[id] = { type: 'noul', noul: answer.noul };
    }
  }
  const tokens = Number.isInteger(result.input_tokens) && result.input_tokens >= 0 ? result.input_tokens : null;
  return { kind: 'decisions', answers, input_tokens: tokens };
}
export function decodeResult(value, request) {
  assert(object(value) && value.contract_version === 1, 'Response version mismatch.', 'invalid_response');
  if (object(value.error)) {
    assert(value.request_id === request.request_id || value.request_id === null, 'Response correlation mismatch.', 'invalid_response');
    return { state: 'error', error: decodeError(value) };
  }
  assert(value.request_id === request.request_id, 'Response correlation mismatch.', 'invalid_response');
  const result = value.result;
  assert(object(result), 'Missing typed result.', 'invalid_response');
  let projected;
  if (request.output === 'text') {
    // Finish reasons may grow additively; any named reason completes a text result.
    assert(result.kind === 'text' && typeof result.text === 'string' && typeof result.finish_reason === 'string' &&
      /^[a-z0-9_]{1,64}$/.test(result.finish_reason), 'Invalid text result.', 'invalid_response');
    projected = { kind: 'text', text: result.text, finish_reason: result.finish_reason };
  } else if (request.output === 'embeddings_float32') {
    const count = embeddingCount(request.input), dimensions = request.options?.dimensions;
    assert(result.kind === 'embeddings' && Array.isArray(result.vectors) && result.vectors.length === count &&
      result.vectors.every(v => Array.isArray(v) && v.length > 0 && v.length <= 8192 &&
        v.length === result.vectors[0].length && (!dimensions || v.length === dimensions) &&
        v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 3.4028234663852886e38)), 'Incoherent embedding result.', 'invalid_response');
    projected = { kind: 'embeddings', vectors: result.vectors };
  } else if (request.output === 'decisions') {
    assert(result.kind === 'decisions', 'Invalid decision result.', 'invalid_response');
    projected = decodeDecisions(result, request);
  } else {
    assert(result.kind === 'image', 'Invalid image result.', 'invalid_response');
    image({ kind: 'image', encoding: 'png', data_base64: result.png_base64 }); number(result.seed, 0, U32);
    projected = { kind: 'image', png_base64: result.png_base64, seed: result.seed };
  }
  return { state: 'succeeded', result: projected };
}
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
export const DECISION_EXAMPLE = Object.freeze({
  kind: 'decision',
  state: { ticket: 'The app crashes on login since yesterday\'s update. I want a refund for this month.' },
  questions: {
    team: { type: 'choice', instructions: 'Which team should handle this ticket?',
      criteria: { billing: 'Payments, invoices and refunds', engineering: 'Bugs, crashes and errors', account: 'Sign-in and access' } },
    urgency: { type: 'score', instructions: 'How urgent is this ticket?',
      criteria: ['Not urgent', 'Can wait a few days', 'Should be handled today', 'Critical, handle now'] },
    refund: { type: 'noul', instructions: 'Does the customer ask for a refund?',
      criteria: { true: 'A refund is requested', false: 'No refund is requested' } },
  },
});
// `serving` is a served-models entry: {model, profile, profile_required}. Profile is sent only
// when the alias is ambiguous; max_tokens defaults inside the descriptor's served bound.
export function template(capability, serving, requestId, descriptor = null) {
  const bound = descriptor?.option_bounds.find(item => item.option === 'max_tokens');
  const maxTokens = Math.max(1, Math.floor(Math.min(LIMITS.defaultMaxTokens, bound?.maximum ?? LIMITS.defaultMaxTokens)));
  const request = { contract_version: 1, request_id: requestId, model: serving.model,
    ...(serving.profile_required ? { profile: serving.profile } : {}), capability,
    input: { kind: 'text', text: 'Describe a quiet forest in one sentence.' }, output: OUTPUTS[capability] ?? 'text',
    options: { kind: 'text_generation', max_tokens: maxTokens }, stream: false };
  if (capability === 'chat_generation') request.input = { kind: 'messages', messages: [{ role: 'user', content: request.input.text }] };
  if (capability === 'text_embedding') request.options = { kind: 'embeddings' };
  if (capability === 'multimodal_embedding') {
    request.input = { kind: 'content_batch', items: [{ parts: [{ kind: 'text', text: 'a photo of a cat' }] }, { parts: [{ kind: 'text', text: 'a photo of a dog' }] }] };
    request.options = { kind: 'embeddings' };
  }
  if (capability === 'decision') { request.input = structuredClone(DECISION_EXAMPLE); request.options = { kind: 'decision' }; }
  if (capability === 'image_generation') request.options = { kind: 'image_generation', width: 512, height: 512, seed: 42 };
  if (capability === 'audio_transcription') { request.input = { kind: 'audio', encoding: 'pcm_s16le', sample_rate_hz: 16000, channels: 1, sample_count: 0, data_base64: '' }; request.options = { kind: 'audio', max_output_tokens: maxTokens }; }
  if (capability === 'image_to_text') request.input = { kind: 'image_messages', messages: [{ role: 'user', content: [{ kind: 'text', text: 'Describe this image.' }, { kind: 'image', encoding: 'png', data_base64: '' }] }] };
  return request;
}
