import { LIMITS, PlaygroundError, assert, object, identity, validateRequest, decodeCapabilities,
  decodeServedModels, decodeError, capabilityRows, admit, decodeResult } from './contract.mjs';
import { redact } from './transport.mjs';

function fenceToken(value) { return typeof value === 'string' && /^[\x21-\x2b\x2d-\x7e]{1,256}$/.test(value); }

// Owns one caller's observation/run. No model loading, installers or private plugin calls.
export class PumasClient {
  constructor(transport) { this.transport = transport; this.description = null; }
  // Successful JSON body, or the Pumas typed error (with its message) as a PlaygroundError.
  observed(exchange) {
    if (exchange.error) throw new PlaygroundError(exchange.error.code, exchange.error.message, exchange.error.outcome);
    if (exchange.status >= 200 && exchange.status < 300) return exchange.value;
    const typed = decodeError(exchange.value);
    if (typed) throw new PlaygroundError(typed.code, redact(typed.message, [this.transport.token]), typed.outcome);
    throw new PlaygroundError('upstream_http_error', `Pumas returned HTTP ${exchange.status}. Inspect the receipt.`);
  }
  async discover(signal, receipts) {
    this.description = null;
    const infoExchange = await this.transport.exchange('/.well-known/pumas', { signal });
    receipts.push(infoExchange.receipt);
    assert(infoExchange.status !== 404 && infoExchange.receipt.http_status !== 404,
      'Public Pumas discovery is absent (HTTP 404). Use a runtime with discovery and typed contract v1; no legacy inference fallback is attempted.', 'unsupported_contract');
    const info = this.observed(infoExchange);
    assert(object(info) && info.advertisement_schema_version === 1 && fenceToken(info.service_generation) &&
      object(info.instance) && fenceToken(info.instance.generation) && info.endpoint === this.transport.endpoint &&
      object(info.build_info) && typeof info.build_info.component === 'string' && typeof info.build_info.package_version === 'string' && Array.isArray(info.build_info.schemas) &&
      info.build_info.schemas.some(s => object(s) && s.name === 'pumas.http-admission-fence' && s.version === 1),
    'Compatible public discovery and admission fence required; inspect runtime version.', 'unsupported_contract');
    this.description = { fence: { instance: info.instance.generation, service: info.service_generation },
      build: redact(info.build_info, [this.transport.token]) };
    const servedExchange = await this.transport.exchange('/v1/served-models', { signal, fence: this.description.fence });
    receipts.push(servedExchange.receipt);
    assert(servedExchange.status !== 404 || decodeError(servedExchange.value),
      'Pumas does not list served models (GET /v1/served-models is absent). Use Pumas v0.8 or later.', 'unsupported_contract');
    const served = decodeServedModels(this.observed(servedExchange));
    const pluginsExchange = await this.transport.exchange('/rpc', { body: { jsonrpc: '2.0', id: 'playground-plugins', method: 'get_plugins', params: {} }, signal, fence: this.description.fence });
    receipts.push(pluginsExchange.receipt);
    const pluginValue = pluginsExchange.value;
    let plugins = null;
    if (pluginsExchange.status === 200 && object(pluginValue) && pluginValue.id === 'playground-plugins' &&
      pluginValue.result?.success === true && Array.isArray(pluginValue.result.plugins) &&
      pluginValue.result.plugins.every(p => object(p) && typeof p.id === 'string' && typeof p.displayName === 'string')) {
      plugins = pluginValue.result.plugins.map(p => ({ id: p.id, name: p.displayName, installation: p.installationType }));
    }
    // One picker entry per served (model, profile); descriptors are re-read on inspection.
    const models = served.models.map(({ capabilities, ...entry }) => ({ ...entry,
      capability_names: capabilities.filter(c => c.availability.state === 'available').map(c => c.capability) }));
    return { endpoint: this.transport.endpoint, ...this.description, models, skipped_models: served.skipped,
      plugins, plugin_status: plugins ? 'observed_manifest_only' : 'unavailable', rows: capabilityRows(null) };
  }
  checkFence(fence) {
    assert(this.description && object(fence) && fence.instance === this.description.fence.instance &&
      fence.service === this.description.fence.service, 'Refresh discovery; the selected runtime observation is missing or changed.', 'stale_discovery');
  }
  async inspect(model, profile, fence, signal, receipts) {
    this.checkFence(fence); identity(model);
    assert(profile === undefined || typeof profile === 'string', 'Profile must be a string, or empty to resolve an unambiguous model.');
    if (profile) identity(profile, 'profile');
    const query = new URLSearchParams({ model, ...(profile ? { profile } : {}) });
    const exchange = await this.transport.exchange(`/v1/capabilities?${query}`, { signal, fence });
    receipts.push(exchange.receipt);
    const capabilities = decodeCapabilities(this.observed(exchange), model, profile);
    return { capabilities, rows: capabilityRows(capabilities) };
  }
  async run(request, fence, signal, receipts) {
    validateRequest(request); this.checkFence(fence);
    const { capabilities } = await this.inspect(request.model, request.profile, fence, signal, receipts);
    const descriptor = admit(request, capabilities);
    signal.throwIfAborted();
    const exchange = await this.transport.exchange('/v1/model-operations', { body: request, fence, signal,
      generation: descriptor.capability !== 'text_embedding', maxBytes: Math.min(LIMITS.responseBytes, capabilities.max_response_bytes) });
    receipts.push(exchange.receipt);
    if (exchange.error) return { state: 'error', capability: descriptor.capability, error: exchange.error };
    try {
      const result = decodeResult(exchange.value, request);
      assert(result.state === 'error' ? exchange.status >= 400 : exchange.status >= 200 && exchange.status < 300,
        'HTTP status contradicts the typed outcome.', 'invalid_response');
      exchange.receipt.outcome = result.state === 'succeeded' ? 'completed' : result.error.outcome;
      if (result.error) { result.error.message = redact(result.error.message, [this.transport.token]); exchange.receipt.error = result.error; }
      if (result.result?.kind === 'text') result.result.text = redact(result.result.text, [this.transport.token]);
      return { ...result, capability: descriptor.capability };
    } catch (error) {
      exchange.receipt.outcome = 'unknown';
      return { state: 'error', capability: descriptor.capability, error: { code: 'invalid_response', message: error.message, outcome: 'unknown' } };
    }
  }
}
