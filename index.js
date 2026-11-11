/**
 * dsh-nanokvm — NanoKVM boxes from DeepSeek Harness.
 *
 * One NanoKVM box is a tiny KVM: an HDMI capture device, an emulated USB keyboard
 * and mouse, two wires to the target's power and reset buttons, two LEDs, and an
 * emulated USB disk. This plugin turns a list of such boxes into tools and a live
 * tab in the right sidebar.
 *
 * The settings arrive from the form built from {@link Config}; the id of the entry
 * in `cordis.patch.yml` must match the settings namespace (`nanokvm`).
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Config, resolveSettings, snapshot } from './lib/config.js';
import { DevicePool } from './lib/pool.js';
import { createDeviceStore } from './lib/store.js';
import { PanelView, registerPanelRoutes } from './lib/routes.js';
import { deviceTools } from './tools/device.js';
import { screenTools } from './tools/screen.js';
import { controlTools } from './tools/control.js';
import { hidTools } from './tools/hid.js';
import { settingsTools } from './tools/settings.js';
import { accountTools } from './tools/account.js';
import { mediaTools } from './tools/media.js';
import { systemTools } from './tools/system.js';

export { Config };
export const name = 'nanokvm';
export const inject = ['tools', 'attachments', 'settings'];

/**
 * Attach the plugin to the composition.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context.
 * @param {Record<string, {get?: () => unknown}>} config live settings values.
 */
export function apply(ctx, config) {
  // The settings card writes one device at a time through a route (never the
  // whole list, so passwords are not round-tripped), and the store keeps the
  // live overlay the running plugin reads.
  const store = createDeviceStore(ctx, { entryId: 'nanokvm', section: () => snapshot(config) });
  const settings = () => resolveSettings(store.section());
  // One client per device: a client owns a session cookie and a HID socket, so
  // it must be rebuilt when the connection fields change (lib/pool.js).
  const pool = new DevicePool({ settings, log: ctx.logger });
  ctx.effect(() => () => pool.closeAll());

  // The panel is built before the tools because the frame/power tools bump its
  // reveal counter, which is what lets the tab auto-open through the existing
  // `/state` route (no extra host route is needed).
  const view = new PanelView({ pool, settings, store });
  const deps = { pool, settings, attachments: ctx.attachments, reveal: (device) => view.reveal(device) };
  // `defineTool` compiles the author-facing parameter map into the object-rooted
  // JSON Schema the model API validates. Registering the raw options would send the
  // map itself as `parameters`, and a parameter named `type` then reads as the
  // schema keyword — the provider rejects the whole tool and every request fails.
  for (const options of [
    ...deviceTools(deps),
    ...screenTools(deps),
    ...controlTools(deps),
    ...hidTools(deps),
    ...settingsTools(deps),
    ...accountTools(deps),
    ...mediaTools(deps),
    ...systemTools(deps),
  ]) {
    ctx.tools.register(defineTool(options));
  }

  // The panel reads its frames through HTTP routes on the same origin. A headless
  // composition has no web server: then the tools keep working and only the tab
  // has nothing to talk to, so the dependency is declared through ctx.inject.
  ctx.inject(['webServer'], (scoped) => registerPanelRoutes(scoped.webServer, { view }));
}
