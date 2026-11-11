/**
 * Device-settings tools: the box's own hostname, mDNS, SSH server, swap, memory
 * limit, mouse jiggler and virtual USB devices. Every one of these reads with
 * `action: "get"` and writes when a value is given.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { NanoKvmError, annotateDeviceError } from '../lib/device.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The device-settings tools.
 * @param {{pool: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function settingsTools(deps) {
  return [
    {
      name: 'nanokvm_settings',
      description:
        "Read or change the NanoKVM box's own settings (not the target machine). `get` returns hostname, mDNS, " +
        'SSH, swap, memory limit, the mouse jiggler and the virtual USB devices in one answer. The individual ' +
        'actions write when a value is given: `hostname` (text), `mdns` and `ssh` (enabled), `swap` (sizeMb), ' +
        '`memory` (enabled, limitMb), `jiggler` (enabled, mode), `virtual` (target: network|media|disk, enabled) ' +
        'and `web-title` (text).',
      parameters: {
        device: DEVICE_PARAM,
        action: {
          type: 'string',
          enum: ['get', 'hostname', 'mdns', 'ssh', 'swap', 'memory', 'jiggler', 'virtual', 'web-title'],
          description: 'Which setting to read or write (default get).',
        },
        text: { type: 'string', description: 'For hostname and web-title.' },
        enabled: { type: 'boolean', description: 'For mdns, ssh, memory, jiggler and virtual.' },
        sizeMb: { type: 'number', description: 'For swap: size in MB (0 turns it off).' },
        limitMb: { type: 'number', description: 'For memory: limit in MB.' },
        mode: { type: 'string', description: 'For jiggler: the box mode name, e.g. its own default.' },
        target: {
          type: 'string',
          enum: ['network', 'media', 'disk'],
          description: 'For virtual: which virtual device to switch.',
        },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const action = String(args.action ?? 'get');
        const client = target.client;
        try {
          if (action === 'get') {
            const [hostname, mdns, ssh, swap, memory, jiggler, virtual] = await Promise.all([
              client.hostname().catch((error) => ({ error: String(error?.message ?? error) })),
              client.mdns().catch((error) => ({ error: String(error?.message ?? error) })),
              client.ssh().catch((error) => ({ error: String(error?.message ?? error) })),
              client.swap().catch((error) => ({ error: String(error?.message ?? error) })),
              client.memoryLimit().catch((error) => ({ error: String(error?.message ?? error) })),
              client.mouseJiggler().catch((error) => ({ error: String(error?.message ?? error) })),
              client.virtualDevices().catch((error) => ({ error: String(error?.message ?? error) })),
            ]);
            return { device: target.name, hostname, mdns, ssh, swap, memory, jiggler, virtual };
          }
          if (action === 'hostname') {
            if (args.text === undefined) return { device: target.name, hostname: await client.hostname() };
            return { device: target.name, ok: true, result: await client.setHostname(String(args.text)) };
          }
          if (action === 'mdns') {
            if (args.enabled === undefined) return { device: target.name, mdns: await client.mdns() };
            return { device: target.name, ok: true, result: await client.setMdns(Boolean(args.enabled)) };
          }
          if (action === 'ssh') {
            if (args.enabled === undefined) return { device: target.name, ssh: await client.ssh() };
            return { device: target.name, ok: true, result: await client.setSsh(Boolean(args.enabled)) };
          }
          if (action === 'swap') {
            if (args.sizeMb === undefined) return { device: target.name, swap: await client.swap() };
            return { device: target.name, ok: true, result: await client.setSwap(Number(args.sizeMb)) };
          }
          if (action === 'memory') {
            if (args.enabled === undefined && args.limitMb === undefined) return { device: target.name, memory: await client.memoryLimit() };
            return {
              device: target.name,
              ok: true,
              result: await client.setMemoryLimit({ enabled: Boolean(args.enabled), limitMb: Number(args.limitMb ?? 0) }),
            };
          }
          if (action === 'jiggler') {
            if (args.enabled === undefined && args.mode === undefined) return { device: target.name, jiggler: await client.mouseJiggler() };
            return {
              device: target.name,
              ok: true,
              result: await client.setMouseJiggler({ enabled: Boolean(args.enabled), mode: String(args.mode ?? '') }),
            };
          }
          if (action === 'virtual') {
            if (args.target === undefined) return { device: target.name, virtual: await client.virtualDevices() };
            if (!['network', 'media', 'disk'].includes(String(args.target))) {
              throw new NanoKvmError(`unknown virtual device "${args.target}" — use network, media or disk`);
            }
            return {
              device: target.name,
              ok: true,
              result: await client.setVirtualDevice({
                target: String(args.target),
                enabled: args.enabled === undefined ? null : Boolean(args.enabled),
              }),
            };
          }
          if (args.text === undefined) return { device: target.name, webTitle: await client.webTitle() };
          return { device: target.name, ok: true, result: await client.setWebTitle(String(args.text)) };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
