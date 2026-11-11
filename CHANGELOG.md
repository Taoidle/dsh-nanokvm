# Changelog

## [0.3.1] — 2026-11-11

### Fixed

- The new tool modules (`tools/hid.js`, `tools/settings.js`, `tools/account.js`) were
  missing from the package `files` list, so 0.3.0 installed with
  `ERR_MODULE_NOT_FOUND` on import. They ship now.
- `tools/check-pack.mjs` walks every relative import from the two entry points and
  compares it with `npm pack --dry-run --json`, so a module that exists in the
  checkout but not in the tarball fails the test suite instead of the install.

## [0.3.0] — 2026-11-11

### Added

- **Click and drag in the sidebar panel.** The frame now takes absolute pointer
  reports: press, move while held, release, right-click and wheel. The same report
  is a tool too (`nanokvm_mouse` with `buttons`), so an agent can drag exactly what
  a person could drag. Both paths obey one gate: with `injectInput: false` the panel
  and the tools both refuse, instead of only the tools pretending to.
- `nanokvm_hid`: keyboard LEDs, HID channel reset, USB mode (`normal` / `hid-only`),
  the box's shortcut list (list/add/remove) and its leader key.
- `nanokvm_settings`: hostname, mDNS, SSH, swap, memory limit, mouse jiggler and the
  virtual USB devices (`network` / `media` / `disk`) — read with `action: "get"` and
  written when a value is given.
- `nanokvm_account`: the account the box serves (`info`), and the web password change
  (`password`), which also drops every session on the box.
- `nanokvm_system` gained `update` (the box downloads and installs its own update and
  restarts its services), `preview` and `preview-set`.

### Fixed

- `nanokvm_resolution` works on firmware 1.4.x, which has no input-resolution route:
  the size now falls back to the last frame (or a fresh one), and the same helper
  backs pointer mapping, so a click no longer needs a screenshot taken first.
- The `injectInput` setting was advertised but never enforced; it now refuses both
  the tools and the panel with the same message.

### Notes

- A drag is three calls: `buttons: 1` down, moves with `buttons: 1`, `buttons: 0` up.
  The panel throttles moves to about 11 per second; the tools send exactly what they
  are told.
- `tools/check-config.mjs` now compiles the new tools through `defineTool`, so a raw
  parameter map can never reach the model API again.

## [0.2.0] — 2026-11-11

### Fixed

- **A device's password can no longer be erased by editing another device.** The
  settings card used to send the whole device array back through the settings form,
  so every card edit re-sent (and could drop) every password. The card now posts ONE
  device to the plugin's own `/dsh-nanokvm/device` route; the host merges it into the
  stored list and an untouched password never leaves the profile. Editing device B
  can no longer touch device A's secret.
- A new device without a password is refused with a clear message instead of being
  stored with an empty password (which the box reports as `invalid username or
  password`, with no way to see why).
- The panel's device picker no longer snaps back to the previous box when the newly
  selected one fails: the user's pick wins, a failed box only fills the error line,
  and the device list is always answered by `/state` even when the box is off.
- Switching devices clears the previous frame instead of leaving it on screen.

### Added

- A **Test** button on every device card and in the editor: it logs in with the
  entered fields (and the typed password when there is one) and reports the box's
  application version, so a wrong password is visible before anything is stored.
- `password stored` / `no password` badges on each card.
- `tools/check-store.mjs`: covers new-device password requirement, untouched-password
  preservation across edits of other devices, default handling, removal, and that the
  panel summary never carries a secret.

## [0.1.4] — 2026-11-11

### Fixed

- **The client bundle can no longer keep the app from starting.** The renderer counts a
  client entry that never materialises as a failed boot (`web boot: 1 entry did not
  activate`) and refuses to start, so a throw inside the browser half took every session
  with it. The factory now wraps its build in a `try`: on failure it logs the reason and
  returns an inert module (`apply` that does nothing, no injected services), which keeps the
  app booting with the settings card and the panel simply absent.
- `tools/check-client.mjs` loads the bundle through a loader stand-in, asserts the id it
  registers under, asserts the exported `apply`/`inject`, and drives a deliberately failing
  build to prove the fallback is inert rather than thrown.

## [0.1.3] — 2026-11-11

### Fixed

- **Every session failed while this plugin was enabled.** The tools were registered as raw
  option objects, so the model API received the author parameter map itself instead of the
  compiled schema; `nanokvm_mount` declares a parameter named `type`, which then read as the
  schema keyword and the provider rejected the tool (`enum: ["image","partition"] ... not
  valid under any of the schemas listed in the 'anyOf' keyword`). Tools now go through
  `defineTool`, which compiles an object-rooted schema, and the contract test compiles every
  tool and asserts that root.
- `nanokvm_screenshot`'s `attachment` output field is an explicit object schema
  (`additionalProperties: true`); the harness rejects an object node that leaves it implicit.

## [0.1.2] — 2026-11-11

### Fixed

- Output schemas are plain JSON Schema: a boolean `required` on a property (valid in the parameter map, not here) is gone, and the test now rejects it.

## [0.1.1] — 2026-11-11

### Fixed

- Every tool declares a renderer next to its output schema; the harness refuses a tool that has a schema without one.

## [0.1.0] — 2026-11-11

First version, built against a NanoKVM on firmware 1.4.3 (application 2.5.0).

### Added

- Device cards in the plugin settings: one complete configuration per NanoKVM (address, web login, TLS, note), with
  add/edit/remove and a default device.
- Right-sidebar panel: live MJPEG frame, power LED state, device selector, and quick actions — power on/off/press,
  reset, Enter, HDMI reset, and a text field that types into the target.
- Tools: `nanokvm_devices`, `nanokvm_status`, `nanokvm_screenshot`, `nanokvm_resolution`, `nanokvm_power`,
  `nanokvm_reset`, `nanokvm_type`, `nanokvm_key`, `nanokvm_mouse`, `nanokvm_media`, `nanokvm_mount`, `nanokvm_eject`,
  `nanokvm_hdmi`, `nanokvm_oled`, `nanokvm_system`.
- Login through the box's own encrypted-password handshake, with a cookie session and one automatic re-login on 401.
- HID keyboard and absolute-mouse reports over the box's websocket, including the 8-byte boot reports needed to work
  in a BIOS.
- A 404 on `storage/media/state` (older firmware) is reported as "unknown" instead of failing the media tools.

### Notes

- A screenshot needs an active HDMI signal; with the target powered off the box sends no frames, so the tool times out
  with that explanation instead of hanging.
- Power/reset are electrical pulses through the box's GPIO pins and work with no OS, no network and no agent in the
  guest. A short power press may suspend instead of powering off — that is the machine's own policy, and the tool
  reports the LED rather than guessing.
