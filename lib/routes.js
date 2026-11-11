/**
 * HTTP routes behind the right-side panel: `/dsh-nanokvm/*`.
 *
 * The panel is a normal page of the same origin, so plain `fetch` is enough —
 * the same shape the pve-vm panel uses. Frames arrive as JPEG from the box's own
 * MJPEG stream, so nothing is re-encoded here.
 *
 * Security: a screen and a power button are sensitive. The fence answers only
 * for a loopback `Host`, requires a matching `Origin` when one is present,
 * refuses `sec-fetch-site: cross-site`, and demands an `application/json` body
 * on POST — the same order of checks DSH applies to its own `/api`.
 */
import { NanoKvmError } from './device.js';

/** Base path of the panel routes. */
export const PANEL_BASE = '/dsh-nanokvm';

/** Error codes to HTTP statuses. */
const STATUS_BY_CODE = { UNAUTHORIZED: 502, UNREACHABLE: 502, TIMEOUT: 504, NO_SCREEN: 502 };

/** Answer with JSON. */
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Turn a failure into a response. */
function fail(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const code = error instanceof NanoKvmError ? error.code : undefined;
  const status = typeof code === 'number' && code >= 400 ? code : (STATUS_BY_CODE[code] ?? 500);
  sendJson(res, status, { error: error?.message ?? String(error), ...(code === null || code === undefined ? {} : { code }) });
}

/**
 * The fence's verdict: the reason for refusal, or undefined.
 * @param {import('node:http').IncomingMessage} req the request.
 * @returns {string|undefined} the reason for refusal.
 */
function fenceViolation(req) {
  const host = req.headers.host ?? '';
  const hostname = /^\[.*\](?::\d+)?$/.test(host) ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (!loopback) return 'host is not a loopback authority';
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== 'null') {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return 'unparseable Origin header';
    }
    if (originHost !== host) return 'Origin does not match Host';
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'sec-fetch-site: cross-site';
  if (req.method === 'POST') {
    const contentType = req.headers['content-type'] ?? '';
    if (!/^\s*application\/json\s*(;|$)/.test(contentType)) return 'POST requires an application/json body';
  }
  return undefined;
}

/** Run the fence; true means the request was already refused and answered. */
function fenceRejected(req, res) {
  const violation = fenceViolation(req);
  if (violation === undefined) return false;
  sendJson(res, 403, { error: `forbidden: ${violation}` });
  return true;
}

/** Read the JSON body of a small request. */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new NanoKvmError('request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new NanoKvmError('request body is not JSON');
  }
}

/** Best effort: an unavailable field becomes null instead of failing the page. */
async function soft(promise) {
  try {
    return await promise;
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

/** The state and actions the panel needs. */
export class PanelView {
  /**
   * @param {{pool: object, settings: () => object, store: object}} options the device pool and the device store.
   */
  constructor({ pool, settings, store }) {
    this.pool = pool;
    this.settings = settings;
    this.store = store;
  }

  /**
   * Everything the panel shows for one device.
   *
   * A box that is off, unreachable or has a wrong password must not make the
   * whole page useless: the device list is always answered, and the failure is
   * reported next to it, so the picker keeps working and the user can switch to
   * another box or open the settings.
   *
   * @param {string} [requested] the requested device.
   * @returns {Promise<object>} the state.
   */
  async state(requested) {
    const settings = this.settings();
    const devices = this.store.summary();
    const base = {
      devices,
      defaultDevice: settings.defaultDevice,
      view: settings.view,
      injectInput: settings.injectInput,
    };
    let target;
    try {
      target = this.pool.resolve(requested);
    } catch (error) {
      return { ...base, device: null, error: error?.message ?? String(error) };
    }
    try {
      const client = this.pool.target(target.name).client;
      const [info, gpio, hdmi, version, hidMode] = await Promise.all([
        client.info(),
        soft(client.gpio()),
        soft(client.hdmi()),
        soft(client.version()),
        soft(client.hidMode()),
      ]);
      return {
        ...base,
        device: target.name,
        info,
        gpio,
        hdmi,
        version,
        hidMode,
        screen: client.screen,
      };
    } catch (error) {
      return { ...base, device: target.name, error: error?.message ?? String(error) };
    }
  }

  /**
   * One device-list action from the settings card.
   * @param {string} action `save`, `remove`, `default` or `test`.
   * @param {Record<string, unknown>} body the request body.
   * @returns {Promise<object>} the new list, or the test result.
   */
  async device(action, body) {
    const entry = body?.device ?? {};
    switch (action) {
      case 'save': {
        const saved = await this.store.save(entry, { password: body.password, makeDefault: body.makeDefault });
        return { ...saved, devices: this.store.summary(), defaultDevice: this.store.defaultDevice() };
      }
      case 'remove': {
        const removed = await this.store.remove(entry.name ?? body.name);
        return { ...removed, devices: this.store.summary(), defaultDevice: this.store.defaultDevice() };
      }
      case 'default': {
        const chosen = await this.store.setDefault(entry.name ?? body.name);
        return { ...chosen, devices: this.store.summary(), defaultDevice: this.store.defaultDevice() };
      }
      case 'test':
        return { test: await this.store.test(entry, typeof body.password === 'string' ? body.password : undefined) };
      default:
        throw new NanoKvmError(`unknown device action "${action}" — try save, remove, default or test`);
    }
  }

  /**
   * One JPEG frame of the device's screen.
   * @param {string} [requested] the requested device.
   * @param {{timeoutMs?: number}} [options] how long to wait for a frame.
   * @returns {Promise<{jpeg: Buffer, meta: object}>} the frame and its size.
   */
  async frame(requested, options = {}) {
    const target = this.pool.target(requested);
    const shot = await target.client.screenshot({ timeoutMs: options.timeoutMs });
    return {
      jpeg: shot.jpeg,
      meta: { device: target.name, width: shot.width, height: shot.height, capturedAt: shot.capturedAt, bytes: shot.jpeg.length },
    };
  }

  /**
   * Run one panel action.
   * @param {string} action the action name.
   * @param {Record<string, unknown>} body the request body.
   * @returns {Promise<object>} a small result for the page.
   */
  async act(action, body) {
    const target = this.pool.target(body.device);
    const client = target.client;
    switch (action) {
      case 'power': {
        const mode = String(body.mode ?? 'press');
        if (!['on', 'off', 'press'].includes(mode)) throw new NanoKvmError(`unknown power mode "${mode}" — use on, off or press`);
        return { device: target.name, power: await client.power(mode) };
      }
      case 'reset':
        return { device: target.name, reset: await client.reset() };
      case 'paste':
        return { device: target.name, paste: await client.paste(String(body.text ?? ''), String(body.language ?? '')) };
      case 'key':
        return { device: target.name, key: await client.key({ keys: Array.isArray(body.keys) ? body.keys : [String(body.keys ?? 'enter')], modifiers: body.modifiers }) };
      case 'mouse':
        return {
          device: target.name,
          mouse: await client.mouse({
            x: Number(body.x ?? 0),
            y: Number(body.y ?? 0),
            width: body.width === undefined ? undefined : Number(body.width),
            height: body.height === undefined ? undefined : Number(body.height),
            button: body.button ?? undefined,
            clicks: body.clicks === undefined ? undefined : Number(body.clicks),
            wheel: body.wheel === undefined ? undefined : Number(body.wheel),
          }),
        };
      case 'hdmi': {
        const mode = String(body.mode ?? 'state');
        if (mode === 'reset') return { device: target.name, hdmi: await client.call('POST', '/api/vm/hdmi/reset') };
        if (mode === 'enable') return { device: target.name, hdmi: await client.call('POST', '/api/vm/hdmi/enable') };
        if (mode === 'disable') return { device: target.name, hdmi: await client.call('POST', '/api/vm/hdmi/disable') };
        if (mode === 'timeout') return { device: target.name, hdmi: await client.call('POST', '/api/vm/hdmi/timeout', { minutes: Number(body.minutes ?? 0) }) };
        return { device: target.name, hdmi: await client.hdmi() };
      }
      case 'oled': {
        if (body.sleep === undefined) return { device: target.name, oled: await client.oled() };
        return { device: target.name, oled: await client.call('POST', '/api/vm/oled', { sleep: Boolean(body.sleep) }) };
      }
      case 'mount':
        return { device: target.name, mount: await client.mount({ type: body.type ?? 'image', rel: String(body.rel ?? ''), cdrom: Boolean(body.cdrom), force: Boolean(body.force) }) };
      case 'eject':
        return { device: target.name, eject: await client.eject(Boolean(body.force)) };
      case 'media':
        return { device: target.name, media: await client.media(), state: await client.mediaState() };
      default:
        throw new NanoKvmError(`unknown action "${action}" — try power, reset, paste, key, mouse, hdmi, oled, mount, eject, media`);
    }
  }
}

/**
 * Register the panel routes on the web server.
 * @param {object} webServer the `webServer` service.
 * @param {{view: PanelView}} deps the panel view.
 * @returns {() => void} disposer removing the routes.
 */
export function registerPanelRoutes(webServer, deps) {
  const view = deps.view;
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: `${PANEL_BASE}/state`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        if (fenceRejected(req, res)) return;
        const url = new URL(req.url ?? '/', 'http://localhost');
        try {
          sendJson(res, 200, await view.state(url.searchParams.get('device') ?? undefined));
        } catch (error) {
          fail(res, error);
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: `${PANEL_BASE}/frame`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        if (fenceRejected(req, res)) return;
        const url = new URL(req.url ?? '/', 'http://localhost');
        const rawTimeout = url.searchParams.get('timeout');
        try {
          const { jpeg, meta } = await view.frame(url.searchParams.get('device') ?? undefined, {
            timeoutMs: rawTimeout === null ? undefined : Number(rawTimeout),
          });
          res.writeHead(200, {
            'content-type': 'image/jpeg',
            'content-length': String(jpeg.length),
            'cache-control': 'no-store, max-age=0',
            'x-nanokvm-device': encodeURIComponent(meta.device),
            'x-nanokvm-resolution': `${meta.width}x${meta.height}`,
            'x-nanokvm-captured-at': String(meta.capturedAt),
          });
          res.end(jpeg);
        } catch (error) {
          fail(res, error);
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: `${PANEL_BASE}/device`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        if (fenceRejected(req, res)) return;
        const url = new URL(req.url ?? '/', 'http://localhost');
        const action = url.searchParams.get('action') ?? 'save';
        try {
          const body = await readJsonBody(req);
          sendJson(res, 200, await view.device(action, body));
        } catch (error) {
          fail(res, error);
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: `${PANEL_BASE}/action`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        if (fenceRejected(req, res)) return;
        const url = new URL(req.url ?? '/', 'http://localhost');
        const action = url.searchParams.get('action') ?? '';
        try {
          const body = await readJsonBody(req);
          sendJson(res, 200, await view.act(action, body));
        } catch (error) {
          fail(res, error);
        }
      },
    }),
  ];
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
