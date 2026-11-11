# dsh-nanokvm

NanoKVM boxes in DeepSeek Harness: see the machine's screen, press its power button, type and click, and mount
virtual media — one card per box, a live tab in the right sidebar, and tools the agent calls directly.

A [NanoKVM](https://github.com/sipeed/NanoKVM) is a small IP-KVM: HDMI capture, an emulated USB keyboard and mouse,
two wires to the target's power and reset buttons (plus the two LEDs), an emulated USB disk, and a web UI. This
plugin speaks to that web UI the way the browser does, over the box's own HTTP and websocket API.

The settings card writes one device at a time through the plugin's own route, not
through the settings form: the host merges the submitted fields into the stored
list, so an existing password is never part of the page round trip and editing one
box cannot clear another box's password. A new box needs its web password; an edit
with the password field left empty keeps the stored one. **Test** logs in with the
fields as typed, before anything is saved.

## Install

From npm:

```bash
dsh plugin add dsh-nanokvm
```

Or from the plugin manager (Settings ▸ Plugins ▸ install) by package name, and once the
plugin is listed in the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
catalogue it also shows up in the Discover tab of the market.

From a checkout of this repository:

```bash
npm pack                      # produces dsh-nanokvm-<version>.tgz
# then install that tarball through the plugin manager / `dsh plugin add file:./dsh-nanokvm-<version>.tgz`
```

In this desktop application the profile is owned by the Electron application, so a
direct `dsh plugin --profile desktop …` is refused; use the plugin manager there.

Restart the application after installing: the host half and the client half are
loaded once per process.

## Configure

Settings ▸ Plugins ▸ NanoKVM. Each box is one complete card — address, login, TLS, note:

| field | meaning |
|---|---|
| name | the `device` argument of every tool (`lab`, `kvm-x99ii`…) |
| baseUrl | `192.168.2.57` (http), `https://kvm.lan`, or `host:8080` |
| username / password | the box's web UI login (the password is sent AES-wrapped, as the web UI does) |
| insecureTls | self-signed HTTPS certificates |
| description | note: which machine is plugged into this box |

The first device is the default when a tool call omits `device`, unless another is marked default.

Global settings stay global: request timeout, whether keyboard/mouse injection tools are allowed, whether the panel
opens after an action (a screenshot, power or reset), and the panel frame rate.

## Tools

| tool | what it does |
|---|---|
| `nanokvm_devices` | list the configured boxes |
| `nanokvm_status` | addresses, firmware, power/disk LEDs, HDMI state, cached images |
| `nanokvm_screenshot` | one frame of the target screen (JPEG) |
| `nanokvm_resolution` | the size pointer input is mapped into |
| `nanokvm_power` | press the power button; `on`/`off` watch the LED |
| `nanokvm_reset` | press the hardware reset button |
| `nanokvm_type` | type text through the box's paste path |
| `nanokvm_key` | press a key or chord (works in a BIOS) |
| `nanokvm_mouse` | move/click/scroll at a pixel of the target screen; `buttons` holds a mask for drag steps |
| `nanokvm_hid` | keyboard LEDs, HID reset, USB mode, the box's shortcuts and leader key |
| `nanokvm_settings` | hostname, mDNS, SSH, swap, memory limit, mouse jiggler, virtual devices |
| `nanokvm_account` | the box account, and changing its web password |
| `nanokvm_media` | list images and the virtual drive state |
| `nanokvm_mount` / `nanokvm_eject` | attach or release an image as the USB drive |
| `nanokvm_hdmi` | read/reset/enable/disable capture, idle timeout |
| `nanokvm_oled` | read or blank the box's OLED |
| `nanokvm_system` | firmware version, update, preview builds, reboot the box, Wake-on-LAN |

Every tool takes `device`; omitting it uses the default box.

## The panel

The NanoKVM tab in the right sidebar shows the captured frame, the power LED state, and the actions worth one click:
power on/off/press, reset, Enter, an HDMI reset, and a text field that types into the target. With several boxes a
selector switches between them.

The frame itself takes input: click, drag, right-click and wheel are absolute pointer reports mapped from the
rendered picture back to the target's pixels. It is the same report `nanokvm_mouse` sends, and the panel's paste,
key, mouse and pointer actions obey the injection switch. Power, reset, HDMI, OLED and media are device controls,
not input injection, so they stay available when injection is turned off.

## How it talks to a box

- **Login**: `POST /api/auth/login` with the password AES-256-CBC encrypted (OpenSSL `Salted__`, MD5
  `EVP_BytesToKey`, secret `nanokvm-sipeed-2024`), the same transformation the web UI applies before sending.
  The token comes back in the body; every later request carries `Cookie: nano-kvm-token=…`.
- **Screen**: `GET /api/stream/mjpeg` — a `multipart/x-mixed-replace` stream. A screenshot reads until the first
  complete JPEG and hangs up. No frame means no HDMI signal: the target is off or its output is asleep.
- **Power/reset**: `POST /api/vm/gpio {type, duration}` — a real electrical pulse on the button line. `GET /api/vm/gpio`
  reports the power LED, which is what `power on/off` polls until it reaches the wanted state.
- **Keyboard/mouse**: the `/api/ws` HID websocket, 8-byte boot reports (`[1, modifiers, 0, key1…key6]`) and 6-byte
  absolute mouse reports (`[2, buttons, x, y, wheel]`, x/y in 0–32767).
- **Media**: the client tries `storage/media*` first. Application 2.5.3+ serves it and still keeps the
  pre-2.6 `storage/image*` endpoints as a compatibility layer; 2.5.0 serves only `storage/image*`. A 404/501 on the
  modern family falls back to the legacy list/mount calls. `media/state` is missing there and is treated as
  "unknown" rather than an error. 2.5.0 has no eject route at all.

## Requirements

- Node 22+ (the plugin's own engines and the harness's).
- A box reachable from the machine running DSH. Baseline: application 2.5.0 and system image 1.4.2 or newer.
  This release was exercised against application 2.5.0 on image 2026-06-10-1_4_3 (1.4.3).
- Network access to the box's web port (80/443). No PVE, no SSH, no `ipmitool`.

## Firmware compatibility

The application version and the system image are separate: the image supplies the base system, the application is
updated independently from it. The plugin reads the application version and adapts where the two APIs differ.

| feature | application | system image |
|---|---|---|
| login, frame, power/reset, keyboard/mouse/paste, HDMI, OLED, status, HID | 2.5.0 (tested) | 1.4.2+ (tested 1.4.3) |
| media list and whole-image mount | 2.5.0 via `storage/image*`; 2.5.3+ via `storage/media*` | 1.4.2+ |
| partitions inside an image, media state, eject | 2.5.3+ | 1.4.2+ |
| exact pointer resolution from `/api/vm/input-resolution` | 2.5.3+; 2.5.0 falls back to the frame size | 1.4.2+ |
| password change verifies the current password | 2.6+; 2.5.x accepts username + new password only | 1.4.2+ |
| mouse-jiggler read/write | 2.5.0+ | 1.4.2+ |

On 2.5.0, eject has no route: mount the replacement image instead. The tool answers with that instruction rather
than reporting a success that did not happen.

## Limitations

- One HID session per box: the plugin holds the websocket while tools type, and the box may drop it while the web UI
  is open in a browser — the next call reconnects.
- `nanokvm_screenshot` needs an HDMI signal; there is no "capture a black screen" fallback.
- The IPMI simulator inside the box is not managed here (it needs its own IPMI tooling and credentials).
- Not verified: applications older than 2.5.0 or system images older than 1.4.2 (the media and HID APIs changed),
  hardware without the OLED.

## Development

```bash
npm run check   # node --check over every source file
npm test        # contract tests: config, device (local mock box), client guard, device store
```

The tests run offline. `tools/check-device.mjs` starts a local mock of the box's API and
drives the real client against it; nothing in the test suite needs a NanoKVM.

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Taoidle.
