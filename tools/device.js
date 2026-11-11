/**
 * Device tools: what is configured, and what one box currently reports.
 *
 * These are the "look first" tools — cheap, read-only, and the ones that tell a
 * user whether a box is reachable before anything is pressed.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { annotateDeviceError } from '../lib/device.js';

/** Shared parameter map. */
const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The device tools.
 * @param {{pool: object, settings: () => object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function deviceTools(deps) {
  return [
    {
      name: 'nanokvm_devices',
      description:
        'List the NanoKVM devices configured in the plugin settings, with the default one marked. ' +
        'No network traffic: this is the configuration, not the devices. ' +
        'Use nanokvm_status to ask a device how it is doing.',
      parameters: {},
      output: PLAIN_OUTPUT,
      async execute() {
        const settings = deps.settings();
        return {
          defaultDevice: settings.defaultDevice,
          devices: settings.devices.map((device) => ({
            name: device.name,
            baseUrl: device.baseUrl,
            username: device.username,
            description: device.description,
            default: device.name === settings.defaultDevice,
          })),
        };
      },
    },
    {
      name: 'nanokvm_status',
      description:
        'Read one NanoKVM device: its network addresses, firmware image and application version, the target power ' +
        'and disk LED states (the box sees the machine it is plugged into), the HDMI capture state, the HID mode, ' +
        'and the locally cached images. Read-only. Works while the target is powered off — the box itself answers.',
      parameters: { device: DEVICE_PARAM },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          const [info, hardware, version, gpio, hdmi, hidMode, images] = await Promise.all([
            target.client.info(),
            target.client.hardware().catch(() => null),
            target.client.version().catch(() => null),
            target.client.gpio(),
            target.client.hdmi().catch(() => null),
            target.client.hidMode().catch(() => null),
            target.client.images().catch(() => null),
          ]);
          return {
            device: target.name,
            baseUrl: target.device.baseUrl,
            info,
            hardware,
            version,
            gpio,
            hdmi,
            hidMode,
            images,
            powered: Boolean(gpio?.pwr),
          };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
