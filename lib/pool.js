/**
 * One client per configured device, rebuilt when its settings change.
 *
 * A client holds a session cookie and a HID socket, so it must not outlive the
 * settings that produced it: the pool compares a signature of the connection
 * fields and closes the old client before handing out a new one. Devices are
 * only constructed on first use — listing names costs nothing and does not
 * touch the network.
 */
import { NanoKvmDevice, NanoKvmError } from './device.js';

/**
 * The fields a client's state depends on.
 * @param {object} device one device entry.
 * @returns {string} a stable signature.
 */
function signatureOf(device) {
  return [device.baseUrl, device.username, device.password, device.insecureTls ? '1' : '0'].join('\u0000');
}

/** A pool of device clients. */
export class DevicePool {
  /**
   * @param {{settings: () => object, log?: object}} options the settings getter.
   */
  constructor({ settings, log = null }) {
    this.settings = settings;
    this.log = log;
    this.entries = new Map();
  }

  /**
   * The configured device names, in configuration order.
   * @returns {string[]} the names.
   */
  names() {
    return this.settings().devices.map((device) => device.name);
  }

  /**
   * Resolve a requested device name to its settings entry.
   * An empty request means the default device; matching is exact first, then
   * case-insensitive, so a hand-typed name does not have to be letter-perfect.
   * @param {string} [requested] the requested name.
   * @returns {object} the device settings.
   * @throws {NanoKvmError} when nothing matches.
   */
  resolve(requested) {
    const settings = this.settings();
    const devices = settings.devices;
    const asked = String(requested ?? '').trim();
    if (devices.length === 0) throw new NanoKvmError('no NanoKVM device is configured — add one in the plugin settings');
    if (asked === '') {
      const preferred = devices.find((device) => device.name === settings.defaultDevice) ?? devices[0];
      return preferred;
    }
    const exact = devices.find((device) => device.name === asked);
    if (exact !== undefined) return exact;
    const lower = asked.toLowerCase();
    const loose = devices.find((device) => device.name.toLowerCase() === lower);
    if (loose !== undefined) return loose;
    throw new NanoKvmError(`no NanoKVM device named "${asked}" — configured: ${devices.map((device) => device.name).join(', ')}`);
  }

  /**
   * The client for a device name, created or rebuilt as needed.
   * @param {string} [requested] the requested name.
   * @returns {{name: string, device: object, client: NanoKvmDevice}} the target.
   */
  target(requested) {
    const device = this.resolve(requested);
    const signature = signatureOf(device);
    const existing = this.entries.get(device.name);
    if (existing !== undefined && existing.signature === signature) return { name: device.name, device, client: existing.client };
    if (existing !== undefined) {
      try {
        existing.client.close();
      } catch {
        // The old session is being discarded either way.
      }
      this.entries.delete(device.name);
    }
    const client = new NanoKvmDevice({ device, timeoutMs: this.settings().requestTimeoutMs, log: this.log });
    this.entries.set(device.name, { signature, client });
    return { name: device.name, device, client };
  }

  /** @returns {string[]} the names that already have a live client. */
  used() {
    return [...this.entries.keys()];
  }

  /** Close every client and forget them. */
  closeAll() {
    for (const entry of this.entries.values()) {
      try {
        entry.client.close();
      } catch {
        // Closing is best effort.
      }
    }
    this.entries.clear();
  }
}
