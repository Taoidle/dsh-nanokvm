/**
 * Control tools: the power and reset pins, and the keyboard and mouse.
 *
 * The pins are the only guaranteed-out-of-band control — they work with no OS,
 * no network and no agent in the guest. Keyboard and mouse go over the box's HID
 * websocket as HID boot reports, which makes them layout-sensitive: text is typed
 * through the box's own paste path (US layout by default) and chords through
 * explicit reports.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { NanoKvmError, annotateDeviceError } from '../lib/device.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The control tools.
 * @param {{pool: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function controlTools(deps) {
  return [
    {
      name: 'nanokvm_power',
      description:
        "Press the target machine's power button through the NanoKVM box, or turn it on/off deliberately. " +
        '`on` and `off` watch the power LED: the box is wired to the real button and the real LED, so the tool ' +
        'presses the button and polls the LED until it reaches the wanted state. `press` never checks anything and ' +
        'is the right call when the machine is stuck or suspended. Note that a short press on a running machine ' +
        'may either power it off or suspend it, depending on the guest OS settings — that behaviour belongs to the ' +
        'machine, not to the box.',
      parameters: {
        device: DEVICE_PARAM,
        mode: { type: 'string', enum: ['on', 'off', 'press'], description: 'Wanted state (default press).' },
        durationMs: { type: 'number', description: 'Press length, ms (default 800 — the box default); at least 1.' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 120000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const mode = args.mode ?? 'press';
        if (!['on', 'off', 'press'].includes(mode)) throw new NanoKvmError(`unknown power mode "${mode}" — use on, off or press`);
        try {
          const result = await target.client.power(mode, { durationMs: Number(args.durationMs ?? 800) });
          return {
            device: target.name,
            mode,
            ...result,
            ok: mode === 'press' || result.after === (mode === 'on'),
          };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_reset',
      description:
        'Press the target machine\'s reset button (the hardware reset line, not an OS reboot). ' +
        'Use it when the machine is hung and the power button would take too long. Reports the power LED before and after.',
      parameters: { device: DEVICE_PARAM },
      output: PLAIN_OUTPUT,
      timeoutMs: 120000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          const result = await target.client.reset();
          return { device: target.name, ok: true, ...result };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_type',
      description:
        "Type text into the target machine through the box's paste path (the same one its web UI uses). " +
        'This needs no agent inside the guest, but the box maps characters with a layout — US English by default — ' +
        'so non-US layouts produce the wrong characters. For a single special key or a chord use nanokvm_key.',
      parameters: {
        device: DEVICE_PARAM,
        text: { type: 'string', required: true, description: 'The text to type.' },
        language: {
          type: 'string',
          description: "The layout the box should assume: 'us', 'de', 'fr'… Empty (default) uses the box's own default.",
        },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 120000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const text = String(args.text ?? '');
        if (text === '') throw new NanoKvmError('nothing to type');
        try {
          const result = await target.client.paste(text, String(args.language ?? ''));
          return { device: target.name, ok: true, chars: [...text].length, result };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_key',
      description:
        'Press one key or a chord on the target machine over HID: a letter or digit, f1–f12, arrows, enter, esc, tab, ' +
        'delete and friends, with optional ctrl/shift/alt/gui. Examples: keys ["enter"]; keys ["delete"] with ' +
        'modifiers "ctrl+alt"; keys ["f2"]. Modifiers can also be listed inside keys. Works before any OS boots ' +
        '(BIOS menus, boot selectors).',
      parameters: {
        device: DEVICE_PARAM,
        keys: { type: 'array', description: 'Keys to hold together, at most 6. A modifier name here is also accepted.' },
        modifiers: { type: 'string', description: 'Modifier chord, e.g. ctrl, ctrl+shift, ctrl+alt+delete.' },
        delayMs: { type: 'number', description: 'How long the keys stay down, ms (default 40).' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const keys = Array.isArray(args.keys) && args.keys.length > 0 ? args.keys : args.modifiers ? [] : ['enter'];
        try {
          const result = await target.client.key({ keys, modifiers: args.modifiers, delayMs: Number(args.delayMs ?? 40) });
          return { device: target.name, ok: true, ...result };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_mouse',
      description:
        'Move the pointer over the target screen and optionally click or scroll. Coordinates are pixels on the ' +
        'target screen; the box reports the size it knows, and a screenshot also records it. Absolute reports span ' +
        '0–32767, so the pixel is mapped with that size — pass width/height when no frame was taken yet.',
      parameters: {
        device: DEVICE_PARAM,
        x: { type: 'number', required: true, description: 'X in target screen pixels.' },
        y: { type: 'number', required: true, description: 'Y in target screen pixels.' },
        width: { type: 'number', description: 'Target screen width in pixels, when the box does not report it.' },
        height: { type: 'number', description: 'Target screen height in pixels, when the box does not report it.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Click with this button (omit to only move).' },
        clicks: { type: 'number', description: 'How many clicks (default 1; 2 for a double click).' },
        wheel: { type: 'number', description: 'Wheel delta at the destination (negative scrolls down).' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          const result = await target.client.mouse({
            x: Number(args.x ?? 0),
            y: Number(args.y ?? 0),
            width: args.width === undefined ? undefined : Number(args.width),
            height: args.height === undefined ? undefined : Number(args.height),
            button: args.button ?? undefined,
            clicks: args.clicks === undefined ? undefined : Number(args.clicks),
            wheel: args.wheel === undefined ? 0 : Number(args.wheel),
          });
          return { device: target.name, ok: true, ...result };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
