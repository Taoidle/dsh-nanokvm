/**
 * The device list, written from the panel's own routes instead of through the
 * settings form.
 *
 * Why the route and not `form.set('devices', …)`: the form sends the whole array
 * back, including every password it was given on the way in. A secret that is
 * re-sent by a browser round trip is a secret that can silently be erased by a
 * later edit of a different card — which is exactly what happened when a second
 * and third box were added and the first two logins started failing. Here the
 * page sends ONE device and an optional NEW password; the host merges it into the
 * stored list, so an untouched password is never part of the exchange at all.
 */
import { NanoKvmError, NanoKvmDevice } from './device.js';
import { normalizeDevices } from './config.js';

/** The device fields a page may change. */
const EDITABLE = ['name', 'baseUrl', 'username', 'insecureTls', 'description'];

/**
 * Keep only the persisted device fields.
 * @param {Record<string, unknown>} entry a submitted device.
 * @returns {Record<string, unknown>} the fields worth storing.
 */
function pick(entry) {
  const kept = {};
  for (const field of EDITABLE) {
    if (entry?.[field] !== undefined) kept[field] = entry[field];
  }
  return kept;
}

/**
 * Create the store.
 *
 * `section()` must return the plain settings as the profile currently holds
 * them. Writes go through the live configuration editor when DSH offers one, so
 * the plugin keeps running and the settings card updates without a restart.
 *
 * @param {object} ctx the plugin context.
 * @param {{entryId: string, section: () => Record<string, unknown>}} options the entry id and a raw reader.
 * @returns {object} the store.
 */
export function createDeviceStore(ctx, { entryId, section }) {
  /** @type {Array<object>|null} */
  let devices = null;
  /** @type {string|null} */
  let defaultDevice = null;

  const read = () => section() ?? {};

  const currentDevices = () => (devices === null ? normalizeDevices(read()) : devices);
  const currentDefault = () => {
    if (defaultDevice !== null) return defaultDevice;
    const list = currentDevices();
    const requested = String(read().defaultDevice ?? '').trim();
    const match =
      list.find((device) => device.name === requested) ??
      list.find((device) => device.name.toLowerCase() === requested.toLowerCase());
    return match?.name ?? list[0]?.name ?? '';
  };

  const editor = () => {
    try {
      return ctx.get('configEditor');
    } catch {
      return undefined;
    }
  };
  const configService = () => {
    try {
      return ctx.get('settings');
    } catch {
      return undefined;
    }
  };

  /** Persist one device list. */
  const persist = async (next, wantedDefault) => {
    const normalized = normalizeDevices({ devices: next });
    const wanted = String(wantedDefault ?? '').trim();
    const chosen = normalized.some((device) => device.name === wanted) ? wanted : (normalized[0]?.name ?? '');
    const entry = ctx.fiber?.entry;
    const edit = editor();
    if (entry && typeof edit?.edit === 'function') {
      // Volatile settings are applied in place, so the running plugin switches
      // to the new list without a restart.
      await edit.edit(entry, (current) => ({ ...current, devices: normalized, defaultDevice: chosen }));
    } else {
      const service = configService();
      if (typeof service?.update !== 'function') {
        throw new NanoKvmError('this DSH build offers no way to write the plugin settings, so the device list cannot be saved');
      }
      let record;
      try {
        record = service.describe?.().find((item) => item.ns === entryId);
      } catch {
        record = undefined;
      }
      await service.update(entryId, { devices: normalized, defaultDevice: chosen }, record?.revision);
    }
    devices = normalized;
    defaultDevice = chosen;
    return normalized;
  };

  return {
    entryId,
    /** The plain settings with the live overlay applied. */
    section() {
      const raw = read();
      return {
        ...raw,
        devices: devices === null ? raw.devices : devices,
        defaultDevice: defaultDevice === null ? raw.defaultDevice : defaultDevice,
      };
    },
    devices: currentDevices,
    defaultDevice: currentDefault,
    /** The panel's short list: no secrets leave the host. */
    summary() {
      const list = currentDevices();
      const chosen = currentDefault();
      return list.map((device) => ({
        name: device.name,
        baseUrl: device.baseUrl,
        username: device.username,
        description: device.description,
        hasPassword: typeof device.password === 'string' && device.password !== '',
        default: device.name === chosen,
      }));
    },
    /**
     * Add or update one device.
     * @param {Record<string, unknown>} entry the submitted fields.
     * @param {{password?: unknown, makeDefault?: unknown}} [options] a NEW password, and whether to make it the default.
     */
    async save(entry, options = {}) {
      const name = String(entry?.name ?? '').trim();
      const baseUrl = String(entry?.baseUrl ?? '').trim();
      if (name === '' || baseUrl === '') throw new NanoKvmError('a device needs a name and an address');
      const list = currentDevices();
      const index = list.findIndex((device) => device.name.toLowerCase() === name.toLowerCase());
      const password = typeof options.password === 'string' ? options.password : undefined;
      if (index < 0 && (password === undefined || password === '')) {
        throw new NanoKvmError('a new device needs its web password — a box with an empty password refuses the login');
      }
      const merged = { ...(index < 0 ? {} : list[index]), ...pick(entry) };
      // An untouched password stays whatever the profile already holds.
      if (password !== undefined) merged.password = password;
      const next = list.slice();
      if (index < 0) next.push(merged);
      else next[index] = merged;
      // Adding a box must not steal the default from the one already chosen.
      const wantedDefault = options.makeDefault === true ? name : (currentDefault() === '' ? name : currentDefault());
      await persist(next, wantedDefault);
      return { name, added: index < 0 };
    },
    /** Remove one device by name. */
    async remove(name) {
      const wanted = String(name ?? '').trim();
      const list = currentDevices().filter((device) => device.name !== wanted);
      if (list.length === currentDevices().length) throw new NanoKvmError(`no device named "${wanted}"`);
      await persist(list, wanted === currentDefault() ? (list[0]?.name ?? '') : currentDefault());
      return { name: wanted };
    },
    /** Make one device the default. */
    async setDefault(name) {
      const wanted = String(name ?? '').trim();
      if (!currentDevices().some((device) => device.name === wanted)) throw new NanoKvmError(`no device named "${wanted}"`);
      await persist(currentDevices(), wanted);
      return { default: wanted };
    },
    /**
     * Try a login with the submitted fields (and a password when one was typed),
     * so the settings card can say "wrong password" before anything is stored.
     * @param {Record<string, unknown>} entry the submitted fields.
     * @param {string} [password] a new password, when the field was filled in.
     */
    async test(entry, password) {
      const name = String(entry?.name ?? '').trim();
      const list = currentDevices();
      const known = list.find((device) => device.name.toLowerCase() === name.toLowerCase());
      const candidate = {
        ...(known ?? {}),
        ...pick(entry),
        password: typeof password === 'string' && password !== '' ? password : (known?.password ?? ''),
      };
      const client = new NanoKvmDevice({ device: normalizeDevices({ devices: [candidate] })[0], timeoutMs: 8000 });
      try {
        const info = await client.info();
        return { name: candidate.name, application: info?.application ?? '', address: info?.ips?.[0]?.addr ?? '' };
      } finally {
        client.close();
      }
    },
  };
}
