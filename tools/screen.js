/**
 * Screen tool: one frame of what the target is showing.
 *
 * The box streams MJPEG continuously; a screenshot is "read the stream until the
 * first complete JPEG, then hang up". A target that is off (or whose HDMI is
 * asleep) sends no frames at all, so this tool always carries a deadline and
 * says so instead of hanging.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { NanoKvmError, annotateDeviceError } from '../lib/device.js';
import { PLAIN_OUTPUT } from '../lib/output.js';

const DEVICE_PARAM = {
  type: 'string',
  description: 'NanoKVM device to work with: a name from the `devices` list in the plugin settings. Omit for the default device.',
};

/** What a frame reports about itself. */
const SHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    device: { type: 'string', description: 'The device the frame came from.' },
    width: { type: 'number', description: 'Frame width in pixels.' },
    height: { type: 'number', description: 'Frame height in pixels.' },
    bytes: { type: 'number', description: 'JPEG size.' },
    capturedAt: { type: 'number', description: 'Unix time of the capture, ms.' },
    attachment: { type: 'object', additionalProperties: true, description: 'The stored image.' },
  },
};

/**
 * The screen tools.
 * @param {{pool: object, attachments: object}} deps the plugin dependencies.
 * @returns {object[]} the tool definitions.
 */
export function screenTools(deps) {
  return [
    {
      name: 'nanokvm_screenshot',
      description:
        "Capture the target machine's screen through the NanoKVM HDMI capture and return it as a JPEG image. " +
        'Use it to look at a BIOS, a boot menu, a blue screen or a desktop without any agent inside the guest. ' +
        'A frame needs an active HDMI signal: if the target is powered off or its output is asleep, the box sends ' +
        'nothing and this fails with that explanation (turn the machine on, or reset the HDMI capture, then retry). ' +
        'Screenshots are the slow path — prefer SSH or a guest agent when the guest is up.',
      parameters: {
        device: DEVICE_PARAM,
        timeoutMs: {
          type: 'number',
          description: 'How long to wait for a frame, ms (default 4000). The box sends frames only while the target drives HDMI.',
        },
      },
      output: {
        schema: SHOT_SCHEMA,
        render: (args, value) => [
          { type: 'text', text: `${value.device}: frame ${value.width}x${value.height}, ${value.bytes} bytes` },
          { type: 'image', attachment: value.attachment },
        ],
      },
      timeoutMs: 120000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        try {
          const shot = await target.client.screenshot({ timeoutMs: Number(args.timeoutMs ?? 4000) });
          deps.reveal?.(target.name);
          const attachment = await deps.attachments.saveImage({
            data: shot.jpeg,
            mediaType: 'image/jpeg',
            name: `${target.name}-screen.jpeg`,
          });
          return {
            device: target.name,
            width: shot.width,
            height: shot.height,
            bytes: shot.jpeg.length,
            capturedAt: shot.capturedAt,
            attachment,
          };
        } catch (error) {
          throw annotateDeviceError(error, target.name);
        }
      },
    },
    {
      name: 'nanokvm_resolution',
      description:
        'Read the screen size used for pointer coordinates. The application only serves `/api/vm/input-resolution` ' +
        'from 2.5.3; on 2.5.0 and older this falls back to a frame grabbed from the stream, so it still works. ' +
        'Pass the result to nanokvm_mouse when a click must land on an exact pixel.',
      parameters: { device: DEVICE_PARAM },
      output: PLAIN_OUTPUT,
      timeoutMs: 30000,
      async execute(args) {
        const target = deps.pool.target(args.device);
        const size = await target.client.screenSize();
        return { device: target.name, ...size };
      },
    },
  ];
}
