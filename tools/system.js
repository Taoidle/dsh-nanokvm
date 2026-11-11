/**
 * Box-level tools: HDMI capture, the OLED, and the box's own system actions.
 *
 * These belong to the NanoKVM itself, not to the machine it is plugged into.
 * HDMI capture is the one most worth reaching for when the screen "does not come":
 * a reset re-negotiates the link with the target, which fixes a blank frame after
 * a reboot or a resolution change more often than anything else.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { annotateDeviceError } from '../lib/device.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The system tools.
 * @param {{pool: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function systemTools(deps) {
  return [
    {
      name: 'nanokvm_hdmi',
      description:
        'Read or change the HDMI capture of the NanoKVM box. `state` (default) reports whether capture is enabled ' +
        'and its idle timeout; `reset` re-negotiates the link with the target (the first thing to try when ' +
        'nanokvm_screenshot says no frame is coming); `enable`/`disable` turn capture on/off; `timeout` sets how ' +
        'many minutes of idle before capture stops (0 disables the timeout).',
      parameters: {
        device: DEVICE_PARAM,
        mode: { type: 'string', enum: ['state', 'reset', 'enable', 'disable', 'timeout'], description: 'What to do (default state).' },
        minutes: { type: 'number', description: 'Idle minutes for mode timeout (0 disables it).' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const mode = args.mode ?? 'state';
        try {
          if (mode === 'state') return { device: target.name, hdmi: await target.client.hdmi() };
          if (mode === 'reset') return { device: target.name, ok: true, result: await target.client.call('POST', '/api/vm/hdmi/reset') };
          if (mode === 'enable') return { device: target.name, ok: true, result: await target.client.call('POST', '/api/vm/hdmi/enable') };
          if (mode === 'disable') return { device: target.name, ok: true, result: await target.client.call('POST', '/api/vm/hdmi/disable') };
          return { device: target.name, ok: true, result: await target.client.call('POST', '/api/vm/hdmi/timeout', { minutes: Number(args.minutes ?? 0) }) };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_oled',
      description:
        "Read or set the NanoKVM's small OLED screen: `sleep` blanks it, and waking it shows the device's address and " +
        'state again. Useful when the box sits next to the machine and its screen should not glow all night.',
      parameters: {
        device: DEVICE_PARAM,
        sleep: { type: 'boolean', description: 'true blanks the OLED, false wakes it. Omit to only read the state.' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 30000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          if (args.sleep === undefined) return { device: target.name, oled: await target.client.oled() };
          return { device: target.name, ok: true, oled: await target.client.setOled(Boolean(args.sleep)) };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_system',
      description:
        "The NanoKVM box's own actions: `version` reports the installed application and the latest available one, " +
        '`update` asks the box to download and install the newest application and restart its services (the target ' +
        'machine is not touched, but every console session drops for a minute), `preview` reads whether preview ' +
        'builds are offered and `preview-set` switches that, `reboot` restarts the box itself, and `wol` sends a ' +
        'Wake-on-LAN packet from the box\'s network to wake a machine by MAC.',
      parameters: {
        device: DEVICE_PARAM,
        action: {
          type: 'string',
          enum: ['version', 'update', 'preview', 'preview-set', 'reboot', 'wol'],
          description: 'What to do (default version).',
        },
        mac: { type: 'string', description: 'MAC address for action wol, e.g. aa:bb:cc:dd:ee:ff.' },
        enabled: { type: 'boolean', description: 'For preview-set: whether the box should offer preview builds.' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 120000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const action = args.action ?? 'version';
        try {
          if (action === 'version') {
            const [version, info] = await Promise.all([target.client.version(), target.client.info().catch(() => null)]);
            return { device: target.name, version, info };
          }
          if (action === 'update') return { device: target.name, ok: true, note: 'the box restarts its services about a second after answering', result: await target.client.update() };
          if (action === 'preview') return { device: target.name, preview: await target.client.preview() };
          if (action === 'preview-set') {
            if (args.enabled === undefined) throw new Error('action preview-set needs enabled');
            return { device: target.name, ok: true, result: await target.client.setPreview(Boolean(args.enabled)) };
          }
          if (action === 'reboot') return { device: target.name, ok: true, result: await target.client.call('POST', '/api/vm/system/reboot') };
          const mac = String(args.mac ?? '').trim();
          if (mac === '') throw new Error('action wol needs a mac address');
          return { device: target.name, ok: true, result: await target.client.call('POST', '/api/network/wol', { mac }) };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
