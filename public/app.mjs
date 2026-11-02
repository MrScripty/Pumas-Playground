import { LIMITS, capabilityRows, template, validateRequest, cosine } from '/contract.mjs';

const $ = id => document.getElementById(id);
const session = document.querySelector('meta[name="playground-session"]').content;
let discovery = null, serving = null, capabilities = null, selected = null, active = null, receiptData = null, imageUrl = null;
const evidence = new Map();
const ATTACHMENTS = {
  image_to_text: ['image/png,image/jpeg', false, 'PNG or JPEG, up to 8 MiB. Replaces the image part of the first message. Pumas validates dimensions and content.'],
  multimodal_embedding: ['image/png,image/jpeg', true, `PNG or JPEG, up to 8 MiB each and ${LIMITS.images} per request. Each image becomes its own content_batch item next to the text items.`],
  decision: ['image/png,image/jpeg', true, `Optional PNG or JPEG images for decision models with a loaded projector (up to ${LIMITS.images}). They are added to input.images.`],
  audio_transcription: ['.pcm,.raw', false, 'Raw PCM only, up to 30 seconds / 8 MiB. Set encoding, channels and sample rate in JSON before attaching; frames are computed from byte length. No relabeling or conversion.'],
};
const OUTCOMES = { not_admitted: 'Pumas did not admit the operation; no provider effect occurred.',
  unknown: 'The provider may have received the operation and its result cannot be established. It is not retried.' };
function key(capability) { return JSON.stringify([discovery?.fence, serving?.model, serving?.profile, capability]); }
function message(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const percent = value => `${(value * 100).toFixed(1)}%`;
function controls() {
  $('discover').disabled = !!active; $('inspect').disabled = !!active || !serving || !discovery;
  $('model').disabled = !!active || !discovery?.models.length;
  $('run').disabled = !!active || !selected; $('cancel').disabled = !active;
  $('request').disabled = !!active || !selected; $('file').disabled = !!active;
  renderCapabilities();
}
function renderCapabilities() {
  $('capabilities').replaceChildren();
  for (const row of capabilityRows(capabilities)) {
    const card = element('div', undefined, `capability ${row.support}${selected === row.capability ? ' active' : ''}`);
    const button = element('button', row.label);
    button.disabled = !!active || row.support !== 'supported'; button.setAttribute('aria-pressed', String(selected === row.capability));
    button.addEventListener('click', () => choose(row.capability));
    const state = element('div', `${row.support.toUpperCase()} · RUN: ${evidence.get(key(row.capability)) ?? 'UNTESTED'}`, `badge ${row.support}`);
    const reason = element('p', evidence.get(key(row.capability)) === 'SUCCEEDED' && row.support === 'supported'
      ? 'A terminal result was validated in this session.' : row.reason);
    card.append(button, state, reason); $('capabilities').append(card);
  }
}
function describeServing(entry) {
  if (!entry) return 'No served model selected.';
  return [`Profile ${entry.profile}${entry.profile_required ? ' (required: alias served by several profiles)' : ' (sent only if required)'}`,
    `${entry.provider} · ${entry.load_state}${entry.context_tokens ? ` · ${entry.context_tokens.toLocaleString()} context tokens` : ''}`,
    entry.capability_names.length ? `Available: ${entry.capability_names.join(', ')}` : 'No available capabilities advertised.'].join('\n');
}
function boundsText(descriptor) {
  const bounds = descriptor?.option_bounds ?? [];
  return bounds.length ? `Served bounds: ${bounds.map(b => `${b.option} ${b.minimum}–${b.maximum}`).join(' · ')}. Pumas checks them again on admission.`
    : 'This descriptor reports no option bounds; Pumas and the provider still enforce their own.';
}
function clearSelection() {
  capabilities = null; selected = null; $('request').value = ''; $('selected').textContent = 'Choose a supported capability';
  $('attachment').hidden = true; $('bounds').textContent = ''; controls();
}
function choose(capability) {
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
  $('output').textContent = 'No response for this request yet.'; $('result-state').textContent = 'UNTESTED'; $('result-state').className = 'badge';
  const descriptor = capabilities.capabilities.find(item => item.capability === capability);
  selected = capability; $('selected').textContent = capability; $('file').value = '';
  $('request').value = JSON.stringify(template(capability, serving, crypto.randomUUID(), descriptor), null, 2);
  const attachment = ATTACHMENTS[capability];
  $('attachment').hidden = !attachment;
  if (attachment) { [$('file').accept, $('file').multiple, $('file-help').textContent] = attachment; }
  $('bounds').textContent = boundsText(descriptor);
  controls();
}
async function api(path, input) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-playground-session': session }, body: JSON.stringify(input) });
  return response.json();
}
function showReceipts(value) {
  receiptData = { format: 'pumas-playground-receipt-v1', captured_at: new Date().toISOString(),
    endpoint: discovery?.endpoint, build: discovery?.build, fence: discovery?.fence,
    evidence: 'Actual HTTP exchanges; inference success is only a validated terminal result.',
    error_message: value.error?.message ?? null, error: value.error, receipts: value.receipts ?? [] };
  $('receipts').textContent = JSON.stringify(receiptData, null, 2); $('export').disabled = false;
}
function errorStatus(error) { return `${error.message ?? 'No message was reported.'} (${error.code}, outcome ${error.outcome})`; }
async function invoke(path, input, consume) {
  if (active) return;
  let observedResponse;
  const id = crypto.randomUUID(); active = { id }; controls();
  message(path === '/api/run' ? 'Request running. A silent generation may still be working.' : 'Reading runtime observations…');
  try {
    const value = await api(path, { id, ...input });
    observedResponse = value;
    showReceipts(value);
    if (value.error) {
      message(errorStatus(value.error), true);
      if (path === '/api/discover') { $('runtime').textContent = 'Runtime unavailable or incompatible'; $('plugins').textContent = 'Plugin inventory unavailable; discovery failed.'; }
      if (path === '/api/run') { evidence.set(key(selected), value.error.outcome === 'unknown' ? 'UNKNOWN' : 'ERROR'); await showResult(value); }
    } else { await consume(value); }
  } catch (error) {
    const value = { receipts: observedResponse?.receipts ?? [], error: { code: error.code === 'invalid_image' ? 'invalid_image' : 'playground_transport_lost', outcome: path === '/api/run' ? 'unknown' : 'not_admitted', message:
      error.code === 'invalid_image' ? 'The returned PNG could not be decoded. Inspect the receipt; no automatic retry.' : 'Playground connection lost. No automatic retry.' } };
    showReceipts(value); message(value.error.message, true);
    if (path === '/api/run') { evidence.set(key(selected), 'UNKNOWN'); await showResult(value); }
  } finally { active = null; controls(); }
}
function rawDetails(value, label = 'Raw result JSON') {
  const details = element('details'); const pre = element('pre', JSON.stringify(value, null, 2)); pre.id = 'raw-result';
  details.append(element('summary', label), pre); return details;
}
function probabilityRows(entries, describe = name => name) {
  const table = element('table', undefined, 'probabilities');
  for (const [name, p] of entries) {
    const row = element('tr'); const meter = element('meter'); Object.assign(meter, { min: 0, max: 1, value: p });
    meter.setAttribute('aria-label', `${describe(name)} probability`);
    const bar = element('td'); bar.append(meter);
    row.append(element('th', describe(name)), bar, element('td', percent(p), 'number')); table.append(row);
  }
  return table;
}
function renderDecisions(result, request) {
  const nodes = [];
  for (const [id, answer] of Object.entries(result.answers)) {
    const section = element('section', undefined, 'answer');
    const instructions = request?.input?.questions?.[id]?.instructions;
    section.append(element('h3', `${id} · ${answer.type}`));
    if (typeof instructions === 'string') section.append(element('p', instructions, 'muted'));
    if (answer.type === 'choice') {
      section.append(element('p', `Choice: ${answer.choice} · confidence ${percent(answer.confidence)}`, 'headline'));
      section.append(probabilityRows(Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])));
    } else if (answer.type === 'score') {
      const levels = Object.keys(answer.legend).map(Number).filter(Number.isFinite);
      const nearest = answer.legend[String(Math.round(answer.score))];
      section.append(element('p', `Score ${answer.score.toFixed(2)}${levels.length ? ` on ${Math.min(...levels)}–${Math.max(...levels)}` : ''}${nearest ? ` (nearest: ${nearest})` : ''} · confidence ${percent(answer.confidence)}`, 'headline'));
      section.append(probabilityRows(Object.entries(answer.probabilities).sort((a, b) => Number(a[0]) - Number(b[0])),
        level => answer.legend[level] ? `${level}: ${answer.legend[level]}` : level));
    } else {
      section.append(element('p', `True with probability ${percent(answer.noul)}`, 'headline'));
      section.append(probabilityRows([['true', answer.noul], ['false', 1 - answer.noul]]));
    }
    nodes.push(section);
  }
  nodes.push(element('p', `${result.input_tokens ?? 'Unreported'} input tokens. Probabilities are scaled by the model's stored temperatures; they are not calibrated for your data.`, 'muted'));
  return nodes;
}
function embeddingLabels(request, count) {
  const input = request?.input;
  if (input?.kind === 'text_batch') return input.texts;
  if (input?.kind === 'text') return [input.text];
  if (input?.kind === 'content_batch') return input.items.map((item, i) => item.parts.map(part => part.kind === 'text' ? part.text : 'image').join(' + ') || `item ${i + 1}`);
  return Array.from({ length: count }, (_, i) => (input?.kind === 'image' ? 'image' : `item ${i + 1}`));
}
function renderEmbeddings(result, request) {
  const { vectors } = result, labels = embeddingLabels(request, vectors.length).map(label => label.length > 48 ? `${label.slice(0, 47)}…` : label);
  const nodes = [element('p', `${vectors.length} vector${vectors.length === 1 ? '' : 's'} × ${vectors[0].length} dimensions`, 'headline')];
  if (vectors.length >= 2 && vectors.length <= 16) {
    const table = element('table', undefined, 'similarity'); const caption = element('caption', 'Cosine similarity'); table.append(caption);
    const head = element('tr'); head.append(element('th'), ...labels.map((_, i) => element('th', `#${i + 1}`)));
    table.append(head);
    vectors.forEach((a, i) => {
      const row = element('tr'); row.append(element('th', `#${i + 1} ${labels[i]}`));
      vectors.forEach(b => row.append(element('td', cosine(a, b).toFixed(3), 'number'))); table.append(row);
    });
    nodes.push(table);
  }
  const preview = element('ol', undefined, 'vectors');
  vectors.slice(0, 16).forEach((v, i) => preview.append(element('li', `${labels[i]}: [${v.slice(0, 6).map(n => n.toFixed(4)).join(', ')}${v.length > 6 ? ', …' : ''}]`)));
  nodes.push(preview);
  return nodes;
}
async function showResult(value, request) {
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
  $('output').replaceChildren();
  $('result-state').textContent = value.state === 'succeeded' ? 'SUCCEEDED' : 'ERROR / UNKNOWN';
  $('result-state').className = `badge ${value.state === 'succeeded' ? 'succeeded' : 'error'}`;
  if (value.error) {
    const alert = element('p', value.error.message ?? 'No message was reported.', 'error-message'); alert.setAttribute('role', 'alert');
    $('output').append(alert, element('p', `${value.error.code} · outcome ${value.error.outcome}. ${OUTCOMES[value.error.outcome] ?? ''}`, 'muted'),
      rawDetails(value.error, 'Error JSON'));
    return;
  }
  const { result } = value;
  if (result.kind === 'image') {
    const bytes = Uint8Array.from(atob(result.png_base64), c => c.charCodeAt(0));
    imageUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const image = document.createElement('img'); image.src = imageUrl; image.alt = 'Image returned by the selected Pumas model';
    try { await image.decode(); } catch { const error = new Error('Invalid PNG'); error.code = 'invalid_image'; throw error; }
    const link = element('a', `Download PNG · seed ${result.seed}`); link.href = imageUrl; link.download = 'pumas-result.png';
    $('output').append(image, link);
  } else if (result.kind === 'text') $('output').textContent = result.text;
  else if (result.kind === 'embeddings') $('output').append(...renderEmbeddings(result, request), rawDetails(result));
  else if (result.kind === 'decisions') $('output').append(...renderDecisions(result, request), rawDetails(result));
  else $('output').append(rawDetails(result));
}
$('discover').addEventListener('click', () => {
  discovery = null; serving = null; clearSelection(); $('model').replaceChildren(new Option('Discover models first', ''));
  $('serving').textContent = 'No served model selected.';
  $('runtime').textContent = 'No current runtime observation'; $('plugins').textContent = 'Plugin discovery pending.';
  invoke('/api/discover', {}, value => {
    discovery = value;
    $('runtime').textContent = `${value.endpoint}\n${value.build.component} ${value.build.package_version}\nService ${value.fence.service}`;
    $('plugins').textContent = value.plugins ? `Plugin manifests: ${value.plugins.map(p => p.name).join(' · ') || 'none'}. Availability is checked per model.` : 'Plugin inventory unavailable; see diagnostics.';
    $('model').replaceChildren(...(value.models.length ? value.models.map((m, i) => new Option(`${m.model} · ${m.profile}`, String(i))) : [new Option('No served models', '')]));
    serving = value.models[0] ?? null; $('serving').textContent = describeServing(serving);
    const skipped = value.skipped_models ? ` ${value.skipped_models} served entr${value.skipped_models === 1 ? 'y was' : 'ies were'} not addressable and skipped.` : '';
    message(value.models.length ? `Connected. Select a served model and inspect its current capabilities.${skipped}` : `Connected, but no models are served. Serve a local model in Pumas and refresh.${skipped}`);
  });
});
$('model').addEventListener('change', () => {
  serving = discovery?.models[Number($('model').value)] ?? null; $('serving').textContent = describeServing(serving); clearSelection();
});
$('inspect').addEventListener('click', () => {
  const entry = serving; clearSelection();
  invoke('/api/inspect', { model: entry.model, profile: entry.profile, fence: discovery.fence }, value => {
    capabilities = value.capabilities;
    message('Capabilities observed. Supported means advertised; inference remains untested until a request succeeds.');
    const first = capabilityRows(capabilities).find(row => row.support === 'supported'); if (first) choose(first.capability);
  });
});
$('run').addEventListener('click', () => {
  try {
    const request = JSON.parse($('request').value);
    const profile = request.profile ?? (serving.profile_required ? null : serving.profile);
    if (request.model !== serving.model || profile !== serving.profile || (request.capability ?? selected) !== selected) {
      throw new Error(serving.profile_required && request.profile === undefined ? `Profile is required: ${serving.model} is served by several profiles.`
        : 'Inspect and select the requested model, profile and capability first.');
    }
    request.request_id = crypto.randomUUID(); validateRequest(request); $('request').value = JSON.stringify(request, null, 2);
    $('output').textContent = 'Waiting for the actual runtime result…'; $('result-state').textContent = 'RUNNING';
    invoke('/api/run', { request, fence: discovery.fence }, async value => {
      await showResult(value, request); evidence.set(key(selected), 'SUCCEEDED'); message('Received and validated a correlated terminal result.');
    });
  } catch (error) { message(error.message, true); }
});
$('cancel').addEventListener('click', async () => {
  if (!active) return;
  $('cancel').disabled = true;
  try { const value = await api('/api/cancel', { id: active.id }); message(value.message ?? value.error?.message ?? 'Cancellation requested.', !!value.error); }
  catch { message('Cancellation could not be confirmed. The current request may still be running.', true); }
});
async function base64(file) {
  if (file.size > LIMITS.fileBytes) throw new Error(`${file.name} exceeds 8 MiB.`);
  const data = new Uint8Array(await file.arrayBuffer());
  let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return { data, encoded: btoa(binary) };
}
$('file').addEventListener('change', async () => {
  const files = [...$('file').files]; if (!files.length) return;
  const invocation = key(selected), original = $('request').value;
  try {
    const read = [];
    for (const file of files) read.push({ file, ...(await base64(file)) });
    if (invocation !== key(selected) || original !== $('request').value || active) throw new Error('Selection changed while reading the file. Attach it again.');
    const request = JSON.parse(original);
    const image = ({ file, encoded }) => ({ encoding: file.type === 'image/jpeg' ? 'jpeg' : 'png', data_base64: encoded });
    if (selected === 'image_to_text') {
      const content = request.input.messages[0].content, index = content.findIndex(part => part.kind === 'image');
      content[index < 0 ? content.length : index] = { kind: 'image', ...image(read[0]) };
    } else if (selected === 'multimodal_embedding') {
      if (request.input.kind === 'image') Object.assign(request.input, image(read[0]));
      else request.input.items.push(...read.map(entry => ({ parts: [{ kind: 'image', ...image(entry) }] })));
    } else if (selected === 'decision') {
      request.input.images = [...(request.input.images ?? []), ...read.map(image)];
    } else {
      const [{ file, data, encoded }] = read;
      if (/\.(wav|mp3|ogg|flac)$/i.test(file.name)) throw new Error('Expected raw PCM; convert containers explicitly first.');
      request.input.data_base64 = encoded;
      request.input.sample_count = data.length / (request.input.channels * (request.input.encoding === 'pcm_f32le' ? 4 : 2));
    }
    validateRequest(request); $('request').value = JSON.stringify(request, null, 2);
    message(`Attached ${read.reduce((n, entry) => n + entry.data.length, 0)} bytes from ${read.length} file${read.length === 1 ? '' : 's'}. Review the request before running.`);
  } catch (error) { message(error.message, true); } finally { $('file').value = ''; }
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receiptData, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pumas-playground-receipt.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => { if (imageUrl) URL.revokeObjectURL(imageUrl); });
controls();
