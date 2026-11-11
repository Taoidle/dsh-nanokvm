/**
 * Plugin configuration.
 *
 * The settings service builds the "NanoKVM" card from the exported `Config`
 * schema; the id of the plugin entry in the patch layer (`nanokvm`) is also the
 * namespace the client half writes through. Every top-level field is
 * `.volatile()` — otherwise the service refuses a write ("Config field … is not
 * volatile") and `apply` would receive plain values instead of live refs.
 *
 * One device is one NanoKVM box: an address, a web login, and nothing shared
 * with its neighbours. Everything else (timeouts, whether the panel follows the
 * agent) is a property of this plugin, not of a box, so it stays global.
 */
import z from '@deepseek-ai/schemastery';

/** The web login of one NanoKVM. */
const DeviceSchema = z.object({
  name: z.string().default('').description('Short name used by the tools and the panel.'),
  baseUrl: z.string().default('').description('http://192.168.2.57 — a bare address is taken as http.'),
  username: z.string().default('admin').description('Web UI account.'),
  password: z.string().default('').role('secret').description('Web UI password (sent encrypted, as the web UI does).'),
  insecureTls: z.boolean().default(false).description('Skip the TLS check for a self-signed https device.'),
  description: z.string().default('').description('Free note: which machine this box is plugged into.'),
});

export const Config = z.object({
  devices: z
    .array(DeviceSchema)
    .default([])
    .description('NanoKVM boxes. The first one is the default when a tool call omits "device".')
    .volatile(),
  defaultDevice: z
    .string()
    .default('')
    .description('Name of the default box; empty takes the first entry.')
    .volatile(),
  requestTimeoutMs: z
    .number()
    .default(15000)
    .description('How long one HTTP call to a box may take.')
    .volatile(),
  injectInput: z
    .boolean()
    .default(true)
    .description('Allow keyboard and mouse injection. Off keeps the tools read-only.')
    .volatile(),
  viewAutoOpen: z
    .boolean()
    .default(false)
    .description('Reveal the NanoKVM tab when the agent captures a frame or presses power.')
    .volatile(),
  viewFps: z
    .number()
    .default(1)
    .description('Panel refresh rate, frames per second (1–4).')
    .volatile(),
});

/** Keys `snapshot` reads the live settings by. */
export const CONFIG_KEYS = [
  'devices',
  'defaultDevice',
  'requestTimeoutMs',
  'injectInput',
  'viewAutoOpen',
  'viewFps',
];

/**
 * Unwrap the live config object into plain values.
 * @param {Record<string, unknown>} config the config object given to `apply`.
 * @returns {Record<string, unknown>} plain values.
 */
export function snapshot(config) {
  const out = {};
  for (const key of CONFIG_KEYS) {
    const value = config?.[key];
    out[key] = value && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value;
  }
  return out;
}

/**
 * Accept `192.168.2.57`, `192.168.2.57:8080`, `http://host`, `https://host/`.
 * A bare address means http, the way the box ships.
 * @param {string} raw the configured address.
 * @returns {string} a normalised base url without a trailing slash, or ''.
 */
export function normalizeBaseUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    url.search = '';
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return '';
  }
}

/**
 * Give every entry a unique, non-empty name. Two boxes called the same thing
 * would be indistinguishable in a tool call, so the second becomes `name-2`.
 * @param {Array<{name?: string}>} entries the configured entries.
 * @returns {Array<string>} one name per entry.
 */
export function deviceNames(entries) {
  const used = new Set();
  const names = [];
  for (const [index, entry] of entries.entries()) {
    const wanted = typeof entry?.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : `kvm-${index + 1}`;
    let name = wanted;
    let suffix = 2;
    while (used.has(name)) {
      name = `${wanted}-${suffix}`;
      suffix += 1;
    }
    used.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Normalise the device list: drop entries without an address, fill the login
 * defaults and de-duplicate the names.
 * @param {Record<string, unknown>} section the plain settings.
 * @returns {Array<object>} the devices, ready for a client.
 */
export function normalizeDevices(section) {
  const entries = Array.isArray(section?.devices) ? section.devices : [];
  const kept = [];
  for (const entry of entries) {
    const baseUrl = normalizeBaseUrl(entry?.baseUrl);
    if (baseUrl === '') continue;
    kept.push({ ...entry, baseUrl });
  }
  const names = deviceNames(kept);
  return kept.map((entry, index) => ({
    name: names[index],
    baseUrl: entry.baseUrl,
    username: typeof entry.username === 'string' && entry.username !== '' ? entry.username : 'admin',
    password: typeof entry.password === 'string' ? entry.password : '',
    insecureTls: entry.insecureTls === true,
    description: typeof entry.description === 'string' ? entry.description : '',
  }));
}

/**
 * Resolve the live settings.
 * @param {Record<string, unknown>} section plain settings (`snapshot`).
 * @returns {object} settings with the device list and the resolved default.
 */
export function resolveSettings(section) {
  const devices = normalizeDevices(section);
  const requested = typeof section?.defaultDevice === 'string' ? section.defaultDevice.trim() : '';
  const match =
    devices.find((device) => device.name === requested) ??
    devices.find((device) => device.name.toLowerCase() === requested.toLowerCase());
  return {
    devices,
    defaultDevice: match?.name ?? devices[0]?.name ?? '',
    requestTimeoutMs: Math.max(1000, Number(section?.requestTimeoutMs ?? 15000)),
    injectInput: section?.injectInput !== false,
    view: {
      autoOpen: section?.viewAutoOpen === true,
      fps: Math.min(4, Math.max(1, Number(section?.viewFps ?? 1))),
    },
  };
}

/**
 * The settings of one device.
 * @param {object} settings the resolved settings.
 * @param {string} [name] the requested device name; empty means the default.
 * @returns {object} one device entry.
 * @throws {Error} when no device is configured or the name is unknown.
 */
export function deviceSettings(settings, name) {
  if (settings.devices.length === 0) {
    throw new Error('no NanoKVM device is configured — add one in the plugin settings');
  }
  const wanted = typeof name === 'string' ? name.trim() : '';
  if (wanted === '') {
    const fallback = settings.devices.find((device) => device.name === settings.defaultDevice) ?? settings.devices[0];
    return fallback;
  }
  const exact = settings.devices.find((device) => device.name === wanted);
  if (exact) return exact;
  const loose = settings.devices.find((device) => device.name.toLowerCase() === wanted.toLowerCase());
  if (loose) return loose;
  throw new Error(
    `no NanoKVM device named "${wanted}" — configured: ${settings.devices.map((device) => device.name).join(', ')}`,
  );
}
