/**
 * One NanoKVM box, spoken to the way its own web UI speaks to it.
 *
 * The session is a cookie (`nano-kvm-token`) issued by /api/auth/login from an
 * AES-wrapped password — see lib/http.js. Every call is a JSON envelope
 * `{code, msg, data}`; `code !== 0` is an error with the box's own wording.
 *
 * Input goes over the HID websocket (/api/ws), whose frames are
 * `[event, ...report]`: 0 heartbeat, 1 keyboard (8-byte boot report), 2 mouse
 * (4-byte relative or 6-byte absolute). The screen is the MJPEG stream.
 */
import { NanoKvmHttpError, encryptPassword, request, stream } from './http.js';
import { connect as connectHid } from './ws.js';
import { jpegSize, takeJpeg } from './jpeg.js';

/** A failure with the box's own code when it gave one. */
export class NanoKvmError extends Error {
  constructor(message, { code = null, status = 0 } = {}) {
    super(message);
    this.name = 'NanoKvmError';
    this.code = code;
    this.status = status;
  }
}

/** HID modifier bits for the first report byte. */
export const MODIFIER_BITS = {
  ctrl: 0x01,
  control: 0x01,
  lctrl: 0x01,
  shift: 0x02,
  lshift: 0x02,
  alt: 0x04,
  lalt: 0x04,
  gui: 0x08,
  win: 0x08,
  meta: 0x08,
  cmd: 0x08,
  lgui: 0x08,
  rctrl: 0x10,
  rshift: 0x20,
  ralt: 0x40,
  rgui: 0x80,
};

/**
 * HID usage ids of the keys worth naming. Letters and digits are generated from
 * the ranges they occupy, not typed out one by one.
 * @type {Record<string, number>}
 */
export const HID_KEYS = {
  enter: 0x28,
  return: 0x28,
  esc: 0x29,
  escape: 0x29,
  backspace: 0x2a,
  tab: 0x2b,
  space: 0x2c,
  minus: 0x2d,
  equal: 0x2e,
  leftbracket: 0x2f,
  rightbracket: 0x30,
  backslash: 0x31,
  semicolon: 0x33,
  quote: 0x34,
  grave: 0x35,
  comma: 0x36,
  period: 0x37,
  slash: 0x38,
  capslock: 0x39,
  insert: 0x49,
  home: 0x4a,
  pageup: 0x4b,
  delete: 0x4c,
  del: 0x4c,
  end: 0x4d,
  pagedown: 0x4e,
  right: 0x4f,
  left: 0x50,
  down: 0x51,
  up: 0x52,
  printscreen: 0x46,
  scrolllock: 0x47,
  pause: 0x48,
  power: 0x66,
  menu: 0x65,
};
for (let index = 0; index < 26; index += 1) HID_KEYS[String.fromCharCode(97 + index)] = 0x04 + index;
for (let index = 1; index <= 9; index += 1) HID_KEYS[String(index)] = 0x1e + (index - 1);
HID_KEYS['0'] = 0x27;
for (let index = 1; index <= 12; index += 1) HID_KEYS[`f${index}`] = 0x3a + (index - 1);

/**
 * Resolve a key name to its HID usage id.
 * @param {string} name the key, e.g. `enter`, `a`, `f5`.
 * @returns {number} the usage id.
 * @throws {NanoKvmError} when the key is unknown.
 */
export function hidKey(name) {
  const key = String(name ?? '').toLowerCase();
  const code = HID_KEYS[key];
  if (code === undefined) {
    throw new NanoKvmError(
      `unknown key "${name}" — use a letter, a digit, f1–f12, or one of: ${Object.keys(HID_KEYS).slice(0, 24).join(', ')}…`,
    );
  }
  return code;
}

/**
 * Build the modifier byte from names.
 * @param {string[]|string} names modifier names.
 * @returns {number} the modifier byte.
 */
export function modifierByte(names) {
  const list = Array.isArray(names) ? names : names === undefined || names === null || names === '' ? [] : String(names).split('+');
  let bits = 0;
  for (const raw of list) {
    const name = String(raw).trim().toLowerCase();
    if (name === '') continue;
    const bit = MODIFIER_BITS[name];
    if (bit === undefined) throw new NanoKvmError(`unknown modifier "${raw}" — use ctrl, shift, alt, gui (or rctrl, rshift, ralt, rgui)`);
    bits |= bit;
  }
  return bits;
}

/**
 * The 8-byte keyboard boot report.
 * @param {number} modifiers the modifier byte.
 * @param {number[]} keys usage ids (at most 6).
 * @returns {Buffer} the report.
 */
export function keyboardReport(modifiers, keys) {
  const report = Buffer.alloc(8);
  report[0] = modifiers & 0xff;
  const used = keys.slice(0, 6);
  for (const [index, code] of used.entries()) report[2 + index] = code & 0xff;
  return report;
}

/**
 * The 6-byte absolute mouse report: buttons, x (0–32767), y, wheel.
 * @param {{x: number, y: number, buttons?: number, wheel?: number}} point the point, already in the 0–32767 space.
 * @returns {Buffer} the report.
 */
export function absoluteMouseReport(point) {
  const report = Buffer.alloc(6);
  report[0] = (point.buttons ?? 0) & 0xff;
  report.writeUInt16LE(Math.min(32767, Math.max(0, Math.round(point.x))), 1);
  report.writeUInt16LE(Math.min(32767, Math.max(0, Math.round(point.y))), 3);
  report[5] = (point.wheel ?? 0) & 0xff;
  return report;
}

/** Mouse button bits as the box's HID reports use them. */
export const MOUSE_BUTTONS = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };

/** Events of the HID websocket. */
const HID_EVENT = { heartbeat: 0, keyboard: 1, mouse: 2 };

/** How many pixels of the target screen the absolute mouse reports span. */
const ABSOLUTE_RANGE = 32767;

/** A client for one box. */
export class NanoKvmDevice {
  /**
   * @param {{device: object, timeoutMs?: number, log?: object}} options the device settings.
   */
  constructor({ device, timeoutMs = 15000, log = null }) {
    this.device = device;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.token = null;
    this.cookie = null;
    this.socket = null;
    this.socketPromise = null;
    this.heartbeat = null;
    this.screen = null;
  }

  /** @returns {string} the device name. */
  get name() {
    return this.device.name;
  }

  /** @returns {string} the ws:// base of this device. */
  get #wsBase() {
    return this.device.baseUrl.replace(/^http/i, 'ws');
  }

  /**
   * Open a session: fetch the token, remember the cookie.
   * @returns {Promise<void>} resolves once the box accepted the login.
   */
  async login() {
    const reply = await request(this.device, {
      method: 'POST',
      path: '/api/auth/login',
      body: { username: this.device.username, password: encryptPassword(this.device.password) },
      timeoutMs: this.timeoutMs,
    });
    if (reply.status !== 200) {
      throw new NanoKvmError(`login refused with HTTP ${reply.status}`, { status: reply.status });
    }
    const payload = reply.json ?? {};
    if (payload.code !== 0) {
      throw new NanoKvmError(payload.msg ?? 'login failed', { code: payload.code ?? null, status: reply.status });
    }
    // Newer firmware hands the token back in the body; older ones also set the
    // cookie. Either way the cookie header is what every later call sends.
    const token = payload?.data?.token;
    if (typeof token !== 'string' || token === '') throw new NanoKvmError('login returned no token');
    this.token = token;
    this.cookie = `nano-kvm-token=${token}`;
  }

  /**
   * Call one endpoint with the session cookie, logging in on demand.
   * @param {string} method HTTP method.
   * @param {string} path the path, starting with /api.
   * @param {unknown} [body] JSON body.
   * @param {{retry?: boolean}} [options] whether a 401 may trigger one re-login.
   * @returns {Promise<any>} the `data` of the envelope.
   */
  async call(method, path, body, options = {}) {
    if (this.cookie === null) await this.login();
    const reply = await request(this.device, {
      method,
      path,
      body,
      headers: this.cookie === null ? {} : { cookie: this.cookie },
      timeoutMs: this.timeoutMs,
    });
    if (reply.status === 401 && options.retry !== false) {
      await this.login();
      return this.call(method, path, body, { retry: false });
    }
    const payload = reply.json ?? null;
    if (payload === null) {
      if (reply.status >= 400) throw new NanoKvmError(`${path} answered HTTP ${reply.status}: ${reply.text.slice(0, 200)}`, { status: reply.status });
      return reply.body;
    }
    if (payload.code !== 0) {
      throw new NanoKvmError(payload.msg ?? `${path} failed`, { code: payload.code ?? null, status: reply.status });
    }
    return payload.data;
  }

  /** @returns {Promise<object>} /api/vm/info (ips, mdns, image, application, deviceKey). */
  info() {
    return this.call('GET', '/api/vm/info');
  }

  /** @returns {Promise<object>} /api/vm/hardware. */
  hardware() {
    return this.call('GET', '/api/vm/hardware');
  }

  /** @returns {Promise<object>} /api/application/version (current, latest). */
  version() {
    return this.call('GET', '/api/application/version');
  }

  /** @returns {Promise<{pwr: boolean, hdd: boolean}>} the power and disk LED states. */
  gpio() {
    return this.call('GET', '/api/vm/gpio');
  }

  /** @returns {Promise<object>} /api/vm/hdmi (enabled, idleTimeout). */
  hdmi() {
    return this.call('GET', '/api/vm/hdmi');
  }

  /** @returns {Promise<object>} /api/vm/oled. */
  oled() {
    return this.call('GET', '/api/vm/oled');
  }

  /** @returns {Promise<object>} /api/hid/mode. */
  hidMode() {
    return this.call('GET', '/api/hid/mode');
  }

  /**
   * Press the power or reset pin.
   * @param {'power'|'reset'} type which pin.
   * @param {number} [durationMs] press length, 800 ms by the box's default.
   * @returns {Promise<unknown>} the box's reply.
   */
  pulse(type, durationMs = 800) {
    return this.call('POST', '/api/vm/gpio', { type, duration: Math.max(1, Math.round(durationMs)) });
  }

  /**
   * Turn the target on or off by watching the power LED, or press the button
   * without asking. A short press is the same button a finger uses, so a running
   * machine may either power off or suspend depending on its own settings — the
   * LED is the judge of the result.
   * @param {'on'|'off'|'press'} action what to do.
   * @param {{durationMs?: number}} [options] press length.
   * @returns {Promise<{action: string, before: boolean, after: boolean, pressed: boolean}>} what happened.
   */
  async power(action, options = {}) {
    const before = Boolean((await this.gpio())?.pwr);
    const wanted = action === 'on' ? true : action === 'off' ? false : null;
    if (wanted !== null && before === wanted) return { action, before, after: before, pressed: false };
    await this.pulse('power', options.durationMs ?? 800);
    let after = before;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      after = Boolean((await this.gpio())?.pwr);
      if (wanted === null || after === wanted) break;
    }
    return { action, before, after, pressed: true };
  }

  /**
   * Reset the target: a reset pulse, then let the LED settle.
   * @returns {Promise<{before: boolean, after: boolean}>} the LED before and after.
   */
  async reset() {
    const before = Boolean((await this.gpio())?.pwr);
    await this.pulse('reset', 500);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { before, after: Boolean((await this.gpio())?.pwr) };
  }

  /**
   * Type text on the target through the box's paste path (US layout by default).
   * @param {string} text what to type.
   * @param {string} [language] the layout the box should map with.
   * @returns {Promise<unknown>} the box's reply.
   */
  paste(text, language = '') {
    return this.call('POST', '/api/hid/paste', { content: text, langue: language });
  }

  /** @returns {Promise<unknown>} the box's media list. */
  media() {
    return this.call('GET', '/api/storage/media');
  }

  /**
   * The media state; the endpoint is missing on some firmware versions, where
   * the list is the only source of truth.
   * @returns {Promise<object|null>} the state, or null when the box does not serve it.
   */
  async mediaState() {
    try {
      return await this.call('GET', '/api/storage/media/state');
    } catch (error) {
      if (error instanceof NanoKvmError && (error.status === 404 || error.code === 404)) return null;
      throw error;
    }
  }

  /**
   * Mount one image on the emulated USB disk.
   * @param {{type: 'image'|'partition', rel: string, cdrom?: boolean, force?: boolean}} medium the medium.
   * @returns {Promise<unknown>} the box's reply.
   */
  mount({ type, rel, cdrom = false, force = false }) {
    return this.call('POST', '/api/storage/media/mount', { type, rel, cdrom, force });
  }

  /**
   * Release the mounted medium.
   * @param {boolean} [force] force the release.
   * @returns {Promise<unknown>} the box's reply.
   */
  eject(force = false) {
    return this.call('POST', '/api/storage/media/eject', { force });
  }

  /** @returns {Promise<unknown>} the version list of the images under /data. */
  images() {
    return this.call('GET', '/api/storage/image');
  }

  /** @returns {Promise<unknown>} the currently mounted image. */
  mountedImage() {
    return this.call('GET', '/api/storage/image/mounted');
  }

  /**
   * The screen size the box reports for pointer input.
   * @returns {Promise<{width: number, height: number}|null>} the size, or null.
   */
  async resolution() {
    try {
      const data = await this.call('GET', '/api/vm/input-resolution');
      const width = Number(data?.width ?? data?.Width ?? 0);
      const height = Number(data?.height ?? data?.Height ?? 0);
      if (width > 0 && height > 0) return { width, height };
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Grab one frame from the MJPEG stream.
   * @param {{timeoutMs?: number}} [options] how long to wait for a frame.
   * @returns {Promise<{jpeg: Buffer, width: number, height: number, capturedAt: number}>} the frame.
   */
  async screenshot(options = {}) {
    if (this.cookie === null) await this.login();
    const timeoutMs = Math.max(500, options.timeoutMs ?? 4000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let collected = Buffer.alloc(0);
    let frame = null;
    try {
      await stream(this.device, {
        path: '/api/stream/mjpeg',
        headers: { cookie: this.cookie, accept: 'multipart/x-mixed-replace' },
        timeoutMs: timeoutMs + 500,
        signal: controller.signal,
        onChunk: (chunk) => {
          collected = collected.length === 0 ? chunk : Buffer.concat([collected, chunk]);
          const found = takeJpeg(collected);
          if (found === null) return collected.length > 12 * 1024 * 1024;
          frame = found.jpeg;
          return true;
        },
      });
    } catch (error) {
      if (frame === null) {
        const reason = error?.name === 'AbortError' || /abort/i.test(String(error?.message)) ? `no frame within ${timeoutMs} ms` : String(error?.message ?? error);
        throw new NanoKvmError(`the screen is not coming: ${reason} — the target's HDMI may be off (powered down or asleep)`, {
          status: error?.status ?? 0,
        });
      }
    } finally {
      clearTimeout(timer);
    }
    if (frame === null) throw new NanoKvmError('the screen is not coming: the stream ended without a frame');
    const size = jpegSize(frame) ?? this.screen;
    if (size !== null) this.screen = size;
    return { jpeg: frame, width: size?.width ?? 0, height: size?.height ?? 0, capturedAt: Date.now() };
  }

  /**
   * The HID channel, opened on first use and reused.
   * @returns {Promise<import('./ws.js').HidSocket>} the socket.
   */
  async #hid() {
    if (this.socket !== null && this.socket.alive) return this.socket;
    if (this.socketPromise !== null) return this.socketPromise;
    this.socketPromise = (async () => {
      if (this.cookie === null) await this.login();
      const socket = await connectHid(`${this.#wsBase}/api/ws`, {
        headers: { cookie: this.cookie },
        timeoutMs: this.timeoutMs,
        insecureTls: this.device.insecureTls,
      });
      socket.onclose = () => {
        if (this.heartbeat !== null) clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.socket = null;
      };
      socket.onerror = () => {
        if (this.heartbeat !== null) clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.socket = null;
      };
      // The box drops a session that stops sending heartbeats.
      this.heartbeat = setInterval(() => {
        try {
          if (socket.alive) socket.sendBinary(Buffer.from([HID_EVENT.heartbeat]));
        } catch {
          // The close handler resets the state.
        }
      }, 10000);
      this.socket = socket;
      return socket;
    })();
    try {
      return await this.socketPromise;
    } finally {
      this.socketPromise = null;
    }
  }

  /**
   * Press a key (or a chord) and release it.
   * @param {{keys: string[], modifiers?: string|string[], delayMs?: number}} spec the chord.
   * @returns {Promise<{modifiers: number, keys: number[]}>} what was sent.
   */
  async key({ keys, modifiers, delayMs = 40 }) {
    const codes = [];
    const modifierNames = Array.isArray(modifiers) ? [...modifiers] : modifiers === undefined || modifiers === '' ? [] : String(modifiers).split('+');
    for (const name of keys ?? []) {
      const normalized = String(name).trim().toLowerCase();
      if (MODIFIER_BITS[normalized] !== undefined) {
        modifierNames.push(normalized);
        continue;
      }
      codes.push(hidKey(normalized));
    }
    if (codes.length === 0 && modifierNames.length === 0) throw new NanoKvmError('no key or modifier given');
    if (codes.length > 6) throw new NanoKvmError(`at most 6 keys can be held at once, got ${codes.length}`);
    const bits = modifierByte(modifierNames);
    const socket = await this.#hid();
    socket.sendBinary(Buffer.concat([Buffer.from([HID_EVENT.keyboard]), keyboardReport(bits, codes)]));
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, delayMs)));
    socket.sendBinary(Buffer.concat([Buffer.from([HID_EVENT.keyboard]), keyboardReport(0, [])]));
    return { modifiers: bits, keys: codes };
  }

  /**
   * Move the pointer to a pixel of the target screen, optionally click and scroll.
   * Absolute reports span 0–32767 regardless of the real resolution, so the
   * pixel is mapped with the screen size from the last frame.
   * @param {{x: number, y: number, width?: number, height?: number, button?: 'left'|'right'|'middle', clicks?: number, wheel?: number, settleMs?: number}} spec where and what.
   * @returns {Promise<{x: number, y: number, width: number, height: number, button: string|null}>} what was sent.
   */
  async mouse(spec) {
    const size = spec.width && spec.height ? { width: spec.width, height: spec.height } : this.screen ?? (await this.resolution());
    if (size === null || !(size.width > 0) || !(size.height > 0)) {
      throw new NanoKvmError('the screen size is unknown — take a screenshot first, or pass width and height');
    }
    const x = Math.round((Math.min(size.width, Math.max(0, spec.x)) / size.width) * ABSOLUTE_RANGE);
    const y = Math.round((Math.min(size.height, Math.max(0, spec.y)) / size.height) * ABSOLUTE_RANGE);
    const socket = await this.#hid();
    const send = (buttons) =>
      socket.sendBinary(
        Buffer.concat([Buffer.from([HID_EVENT.mouse]), absoluteMouseReport({ x, y, buttons, wheel: spec.wheel ?? 0 })]),
      );
    send(0);
    const buttonName = spec.button ?? null;
    const clicks = buttonName === null ? 0 : Math.max(1, spec.clicks ?? 1);
    if (buttonName !== null) {
      const bit = MOUSE_BUTTONS[buttonName];
      if (bit === undefined) throw new NanoKvmError(`unknown mouse button "${buttonName}" — use left, right or middle`);
      for (let index = 0; index < clicks; index += 1) {
        send(bit);
        await new Promise((resolve) => setTimeout(resolve, 30));
        send(0);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, spec.settleMs ?? 80)));
    return { x: spec.x, y: spec.y, width: size.width, height: size.height, button: buttonName };
  }

  /** Close the HID channel and forget the session. */
  close() {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    try {
      this.socket?.close();
    } catch {
      // Already gone.
    }
    this.socket = null;
    this.socketPromise = null;
    this.token = null;
    this.cookie = null;
  }
}

/**
 * Turn a transport failure into the message a user can act on.
 * @param {Error} error the thrown error.
 * @param {string} device the device name.
 * @returns {Error} the same error, annotated.
 */
export function annotateDeviceError(error, device) {
  if (error instanceof NanoKvmHttpError) {
    return new NanoKvmError(`${device}: ${error.message}`, { status: error.status, code: error.code });
  }
  if (error instanceof NanoKvmError) {
    if (!error.message.startsWith(device)) error.message = `${device}: ${error.message}`;
    return error;
  }
  return new NanoKvmError(`${device}: ${error?.message ?? error}`);
}
