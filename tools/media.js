/**
 * Virtual media tools: the emulated USB disk and its images.
 *
 * The box exposes one emulated mass-storage device whose contents are an ISO or a
 * disk image kept on the box itself. Mounting it makes the target see a USB drive;
 * the target boots or installs from it. Nothing here touches the box's own files
 * except the image it is told to mount.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PLAIN_OUTPUT } from '../lib/output.js';
import { annotateDeviceError } from '../lib/device.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};


/**
 * The media tools.
 * @param {{pool: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function mediaTools(deps) {
  return [
    {
      name: 'nanokvm_media',
      description:
        'List the images stored on the NanoKVM box and what the virtual USB drive is currently doing. ' +
        'The list covers whole ISO/disk images and, on newer firmware, the partitions inside them ' +
        '(`type: partition`). Read-only.',
      parameters: { device: DEVICE_PARAM },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          const [media, state, mounted] = await Promise.all([
            target.client.media(),
            target.client.mediaState(),
            target.client.mountedImage().catch(() => null),
          ]);
          return { device: target.name, legacy: target.client.legacyMedia === true, media, state, mounted };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_mount',
      description:
        'Mount one image (or one partition of it) as the target\'s USB drive. `rel` is the path shown by ' +
        'nanokvm_media. `cdrom` presents it as a CD-ROM instead of a hard disk, which is what operating-system ' +
        'installers usually expect. Application 2.5.3+ mounts whole images and partitions; 2.5.0 falls back to ' +
        'its legacy image API, which mounts whole ISO/disk images only. The target sees the change only after a ' +
        'boot, a rescan or a replug.',
      parameters: {
        device: DEVICE_PARAM,
        rel: { type: 'string', required: true, description: 'The image path from nanokvm_media.' },
        type: { type: 'string', enum: ['image', 'partition'], description: 'Mount a whole image or a partition inside it (default image).' },
        cdrom: { type: 'boolean', description: 'Present it as a CD-ROM (default false).' },
        force: { type: 'boolean', description: 'Mount even when the box reports the medium is in use.' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 120000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const rel = String(args.rel ?? '');
        if (rel === '') throw new Error('rel is required — see nanokvm_media for the paths');
        try {
          const result = await target.client.mount({
            type: args.type ?? 'image',
            rel,
            cdrom: Boolean(args.cdrom),
            force: Boolean(args.force),
          });
          return { device: target.name, ok: true, rel, result };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_eject',
      description:
        'Release the mounted medium from the target\'s USB drive. `force` is for a medium the box still reports as ' +
        'open (an OS may still be reading it) — ejecting under a live installer can upset the guest, so it is opt-in. ' +
        'Application 2.5.0 has no eject route: there the only way to replace a medium is to mount the next one, and ' +
        'this tool says so instead of failing silently.',
      parameters: {
        device: DEVICE_PARAM,
        force: { type: 'boolean', description: 'Eject even when the box reports it is in use (default false).' },
      },
      output: PLAIN_OUTPUT,
      timeoutMs: 60000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          const result = await target.client.eject(Boolean(args.force));
          return { device: target.name, ok: true, result };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
  ];
}
