/**
 * HID tools: the keyboard LEDs, the reset of the whole input channel, the mode
 * the box exposes its USB devices in, and the shortcut list its web UI keeps.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { NanoKvmError, annotateDeviceError } from '../lib/device.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The HID tools.
 * @param {{pool: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function hidTools(deps) {
  return [
    {
      name: 'nanokvm_hid',
      description:
        'Work with the box-side HID channel rather than the target: `leds` reads the target keyboard LEDs ' +
        '(num/caps/scroll), `reset` clears a stuck keyboard or mouse report, `mode` reads or switches how the box ' +
        'exposes its USB devices (`normal` or `hid-only`), `shortcut-list` lists the shortcuts the box remembers, ' +
        '`shortcut-add` stores a chord, `shortcut-remove` deletes one by id, `leader-key` reads the leader key and ' +
        '`leader-key-set` changes it. Shortcuts are stored by the box, not by this plugin.',
      parameters: {
        device: DEVICE_PARAM,
        action: {
          type: 'string',
          enum: ['leds', 'reset', 'mode', 'shortcut-list', 'shortcut-add', 'shortcut-remove', 'leader-key', 'leader-key-set'],
          description: 'What to do.',
        },
        mode: { type: 'string', enum: ['normal', 'hid-only'], description: 'For action mode: the wanted USB mode.' },
        keys: {
          type: 'array',
          description: 'For shortcut-add: the chord, as the box stores it — [{code, label}].',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              code: { type: 'string', description: 'The key code the box uses.' },
              label: { type: 'string', description: 'How the shortcut is shown.' },
            },
          },
        },
        id: { type: 'string', description: 'For shortcut-remove: the shortcut id.' },
        key: { type: 'string', description: 'For leader-key-set: the leader key; empty clears it.' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const action = String(args.action ?? 'leds');
        try {
          if (action === 'leds') return { device: target.name, leds: await target.client.hidLeds() };
          if (action === 'reset') return { device: target.name, ok: true, result: await target.client.hidReset() };
          if (action === 'mode') {
            if (args.mode === undefined) return { device: target.name, mode: await target.client.hidMode() };
            if (!['normal', 'hid-only'].includes(String(args.mode))) {
              throw new NanoKvmError(`unknown HID mode "${args.mode}" — use normal or hid-only`);
            }
            return { device: target.name, ok: true, result: await target.client.setHidMode(String(args.mode)) };
          }
          if (action === 'shortcut-list') return { device: target.name, shortcuts: await target.client.shortcuts() };
          if (action === 'shortcut-add') {
            const keys = Array.isArray(args.keys) ? args.keys : [];
            if (keys.length === 0) throw new NanoKvmError('shortcut-add needs keys');
            return { device: target.name, ok: true, result: await target.client.addShortcut(keys) };
          }
          if (action === 'shortcut-remove') {
            const id = String(args.id ?? '').trim();
            if (id === '') throw new NanoKvmError('shortcut-remove needs an id — shortcut-list shows the ids');
            return { device: target.name, ok: true, result: await target.client.removeShortcut(id) };
          }
          if (action === 'leader-key') return { device: target.name, leaderKey: await target.client.leaderKey() };
          return { device: target.name, ok: true, result: await target.client.setLeaderKey(String(args.key ?? '')) };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
