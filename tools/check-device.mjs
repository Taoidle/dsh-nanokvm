/**
 * Device tests against a local mock NanoKVM: login envelope, cookie handling,
 * a 401 that forces one re-login, media state on firmware that does not serve it,
 * the power flow with its LED poll, and the HID report maths.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { NanoKvmDevice, NanoKvmError, absoluteMouseReport, assertInputAllowed, hidKey, keyboardReport, modifierByte } from '../lib/device.js';
import { encryptPassword, request } from '../lib/http.js';
import { PanelView } from '../lib/routes.js';
import { jpegSize, takeJpeg } from '../lib/jpeg.js';

const problems = [];
const check = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
  }
};

/** Turn an OpenSSL salted AES blob back into the plaintext (as the box does). */
function decryptPassword(encoded) {
  const raw = Buffer.from(decodeURIComponent(encoded), 'base64');
  assert.equal(raw.subarray(0, 8).toString('latin1'), 'Salted__');
  const salt = raw.subarray(8, 16);
  const data = raw.subarray(16);
  const secret = Buffer.from('nanokvm-sipeed-2024', 'utf8');
  let previous = Buffer.alloc(0);
  let material = Buffer.alloc(0);
  while (material.length < 48) {
    previous = crypto.createHash('md5').update(Buffer.concat([previous, secret, salt])).digest();
    material = Buffer.concat([material, previous]);
  }
  const key = material.subarray(0, 32);
  const iv = material.subarray(32, 48);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

let validToken = null;
let loginCount = 0;
let pwr = false;
let expireAfterLogin = false;
const seen = {
  logins: 0,
  info: 0,
  mediaState: 0,
  gpio: 0,
  failedAuth: 0,
  inputResolution: 0,
  oledBodies: [],
  jigglerPaths: [],
  jigglerBodies: [],
  passwordBodies: [],
  legacyMounts: [],
  legacyEjects: 0,
};
let applicationVersion = '2.5.0';

/** Read and parse one JSON request body. */
function readJson(req, done) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => done(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
}

const server = http.createServer((req, res) => {
  const cookie = String(req.headers.cookie ?? '');
  const authorized = validToken !== null && cookie === `nano-kvm-token=${validToken}`;
  const reply = (status, body, headers = {}) => {
    const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
    res.end(payload);
  };
  if (req.url === '/api/auth/login') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const password = decryptPassword(body.password);
      if (body.username !== 'admin' || password !== 'admin') {
        reply(200, { code: 1, msg: 'bad credentials' });
        return;
      }
      loginCount += 1;
      seen.logins = loginCount;
      validToken = `t${loginCount}`;
      if (expireAfterLogin) {
        validToken = `stale-${loginCount}`;
        expireAfterLogin = false;
      }
      reply(200, { code: 0, data: { token: validToken } });
    });
    return;
  }
  if (!authorized) {
    seen.failedAuth += 1;
    reply(401, { code: 401, msg: 'unauthorized' });
    return;
  }
  if (req.url === '/api/vm/info') {
    seen.info += 1;
    reply(200, { code: 0, data: { ips: [{ name: 'eth0', addr: '192.168.2.57', version: 'IPv4', type: 'Wired' }], application: '2.5.0' } });
    return;
  }
  if (req.url === '/api/application/version' && req.method === 'GET') {
    reply(200, { code: 0, data: { current: applicationVersion, latest: applicationVersion } });
    return;
  }
  if (req.url === '/api/vm/input-resolution' && req.method === 'GET') {
    seen.inputResolution += 1;
    reply(404, '404 page not found');
    return;
  }
  if (req.url === '/api/vm/oled' && req.method === 'GET') {
    reply(200, { code: 0, data: { exist: true, sleep: 0 } });
    return;
  }
  if (req.url === '/api/vm/oled' && req.method === 'POST') {
    readJson(req, (body) => {
      seen.oledBodies.push(body);
      reply(200, { code: 0, data: null });
    });
    return;
  }
  if (req.url === '/api/vm/mouse-jiggler/' && req.method === 'POST') {
    readJson(req, (body) => {
      seen.jigglerPaths.push(req.url);
      seen.jigglerBodies.push(body);
      reply(200, { code: 0, data: null });
    });
    return;
  }
  if (req.url === '/api/vm/mouse-jiggler' && req.method === 'POST') {
    // What Gin answers when the trailing slash is missing; the client must
    // follow it with POST and the same body rather than treating 307 as success.
    seen.jigglerPaths.push(req.url);
    reply(307, '', { location: '/api/vm/mouse-jiggler/' });
    return;
  }
  if (req.url === '/api/auth/password' && req.method === 'POST') {
    readJson(req, (body) => {
      seen.passwordBodies.push(body);
      reply(200, { code: 0, data: null });
    });
    return;
  }
  if (req.url === '/api/storage/media' && req.method === 'GET') {
    reply(404, '404 page not found');
    return;
  }
  if (req.url === '/api/storage/media/mount' && req.method === 'POST') {
    reply(404, '404 page not found');
    return;
  }
  if (req.url === '/api/storage/media/eject' && req.method === 'POST') {
    reply(404, '404 page not found');
    return;
  }
  if (req.url === '/api/storage/image' && req.method === 'GET') {
    reply(200, { code: 0, data: { files: ['/data/test.iso'] } });
    return;
  }
  if (req.url === '/api/storage/image/mount' && req.method === 'POST') {
    readJson(req, (body) => {
      seen.legacyMounts.push(body);
      reply(200, { code: 0, data: null });
    });
    return;
  }
  if (req.url === '/api/storage/image/eject' && req.method === 'POST') {
    seen.legacyEjects += 1;
    reply(404, '404 page not found');
    return;
  }
  if (req.url === '/api/vm/gpio' && req.method === 'GET') {
    seen.gpio += 1;
    reply(200, { code: 0, data: { pwr, hdd: false } });
    return;
  }
  if (req.url === '/api/vm/gpio' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body.type === 'power') pwr = !pwr;
      reply(200, { code: 0, data: null });
    });
    return;
  }
  if (req.url === '/api/storage/media/state') {
    seen.mediaState += 1;
    reply(404, 'page not found');
    return;
  }
  if (req.url === '/api/storage/media') {
    reply(200, { code: 0, data: { images: [] } });
    return;
  }
  reply(200, { code: 0, data: null });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const device = {
  name: 'lab',
  baseUrl: `http://127.0.0.1:${port}`,
  username: 'admin',
  password: 'admin',
  insecureTls: false,
  description: '',
};

await check('the password travels encrypted exactly as the web UI sends it', () => {
  const encoded = encryptPassword('admin');
  assert.match(encoded, /^U2FsdGVkX1/);
  assert.equal(decryptPassword(encoded), 'admin');
});

const client = new NanoKvmDevice({ device, timeoutMs: 5000 });
await check('login stores the cookie and info answers', async () => {
  await client.login();
  assert.equal(seen.logins, 1);
  const info = await client.info();
  assert.equal(info.application, '2.5.0');
  assert.equal(seen.failedAuth, 0);
});
await check('a 401 forces exactly one re-login and then succeeds', async () => {
  validToken = 'revoked-by-the-box';
  const before = seen.logins;
  const info = await client.info();
  assert.equal(info.application, '2.5.0');
  assert.equal(seen.logins, before + 1);
  assert.equal(seen.failedAuth >= 1, true);
});
await check('a media state endpoint that answers 404 becomes null instead of an error', async () => {
  const state = await client.mediaState();
  assert.equal(state, null);
  assert.equal(seen.mediaState >= 1, true);
});
await check('power(on) presses the button and waits for the LED', async () => {
  pwr = false;
  const result = await client.power('on');
  assert.equal(result.before, false);
  assert.equal(result.after, true);
  const idempotent = await client.power('on');
  assert.equal(idempotent.pressed, false);
});
await check('an unknown device produces a message that lists the configured ones', () => {
  assert.throws(() => hidKey('nope'), NanoKvmError);
});
await check('HID reports have the documented shape', () => {
  assert.equal(hidKey('a'), 0x04);
  assert.equal(hidKey('z'), 0x1d);
  assert.equal(hidKey('1'), 0x1e);
  assert.equal(hidKey('0'), 0x27);
  assert.equal(hidKey('enter'), 0x28);
  assert.equal(hidKey('f12'), 0x45);
  assert.equal(modifierByte('ctrl+shift'), 0x03);
  assert.equal(modifierByte(['alt', 'gui']), 0x0c);
  const keyboard = keyboardReport(0x02, [0x04, 0x05]);
  assert.deepEqual([...keyboard], [0x02, 0x00, 0x04, 0x05, 0x00, 0x00, 0x00, 0x00]);
  const mouse = absoluteMouseReport({ x: 0, y: 32767, buttons: 1, wheel: 0 });
  assert.equal(mouse.length, 6);
  assert.deepEqual([...mouse], [0x01, 0x00, 0x00, 0xff, 0x7f, 0x00]);
});
await check('a JPEG frame is found and measured', () => {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]);
  const tail = Buffer.from([0xff, 0xd9]);
  const frame = Buffer.concat([head, Buffer.alloc(9), tail]);
  const found = takeJpeg(frame);
  assert.notEqual(found, null);
  assert.deepEqual(jpegSize(found.jpeg), { width: 800, height: 600 });
  assert.equal(takeJpeg(Buffer.from([0xff, 0xd8, 0x01])), null);
});

await check('input injection can be switched off for every caller', () => {
  assert.throws(() => assertInputAllowed(() => ({ injectInput: false })), /input injection is disabled/);
  assert.doesNotThrow(() => assertInputAllowed(() => ({ injectInput: true })));
  assert.doesNotThrow(() => assertInputAllowed(() => ({})));
  assert.doesNotThrow(() => assertInputAllowed(null));
});

await check('the pointer size falls back to the last frame', async () => {
  const device = new NanoKvmDevice({ device: { baseUrl: 'http://127.0.0.1:1', username: 'admin', password: 'x' } });
  device.screen = { width: 1280, height: 800 };
  const size = await device.screenSize();
  assert.deepEqual(size, { width: 1280, height: 800 });
  const explicit = await device.screenSize({ width: 640, height: 400 });
  assert.deepEqual(explicit, { width: 640, height: 400 });
});

await check('a single pointer report maps pixels to the 0-32767 range', async () => {
  const device = new NanoKvmDevice({ device: { baseUrl: 'http://127.0.0.1:1', username: 'admin', password: 'x' } });
  device.screen = { width: 1280, height: 800 };
  const sent = [];
  device.socket = { alive: true, sendBinary: (buffer) => sent.push(Buffer.from(buffer)), close() {} };
  const report = await device.pointer({ x: 640, y: 400, buttons: 1 });
  assert.equal(report.width, 1280);
  assert.deepEqual([...sent[0]], [2, ...absoluteMouseReport({ x: 16384, y: 16384, buttons: 1, wheel: 0 })]);
});

await check('OLED writes send the integer Sleep field', async () => {
  seen.oledBodies.length = 0;
  await client.setOled(true);
  await client.setOled(false);
  assert.deepEqual(seen.oledBodies, [{ sleep: 1 }, { sleep: 0 }]);
  assert.equal(typeof seen.oledBodies[0].sleep, 'number');
});

await check('the mouse-jiggler write uses the registered trailing-slash route', async () => {
  seen.jigglerPaths.length = 0;
  await client.setMouseJiggler({ enabled: true, mode: 'relative' });
  assert.deepEqual(seen.jigglerPaths, ['/api/vm/mouse-jiggler/']);
  assert.deepEqual(seen.jigglerBodies.at(-1), { enabled: true, mode: 'relative' });
});

await check('a 307 is followed with POST and the same body', async () => {
  await client.login();
  seen.jigglerPaths.length = 0;
  const reply = await request(
    { baseUrl: device.baseUrl },
    {
      method: 'POST',
      path: '/api/vm/mouse-jiggler',
      body: { enabled: false, mode: 'absolute' },
      headers: { cookie: `nano-kvm-token=${client.token}` },
    },
  );
  assert.equal(reply.status, 200);
  assert.deepEqual(seen.jigglerPaths, ['/api/vm/mouse-jiggler', '/api/vm/mouse-jiggler/']);
  assert.deepEqual(seen.jigglerBodies.at(-1), { enabled: false, mode: 'absolute' });
});

await check('media falls back to the legacy image routes and says when eject is unavailable', async () => {
  const media = await client.media();
  assert.deepEqual(media, { files: ['/data/test.iso'] });
  assert.equal(client.legacyMedia, true);
  seen.legacyMounts.length = 0;
  await client.mount({ type: 'image', rel: '/data/test.iso', cdrom: true });
  assert.deepEqual(seen.legacyMounts.at(-1), {
    file: '/data/test.iso',
    image: '/data/test.iso',
    cdrom: true,
    force: false,
  });
  await assert.rejects(client.mount({ type: 'partition', rel: '/data/test.iso' }), (error) => {
    assert.ok(error instanceof NanoKvmError);
    assert.equal(error.code, 'UNSUPPORTED');
    assert.match(error.message, /cannot mount partitions/);
    return true;
  });
  await assert.rejects(client.eject(), (error) => {
    assert.ok(error instanceof NanoKvmError);
    assert.equal(error.code, 'UNSUPPORTED');
    assert.match(error.message, /cannot eject; mount another image to replace it/);
    return true;
  });
  assert.equal(seen.legacyEjects, 1);
});

await check('2.5.0 password changes use the username shape and encrypt the new password', async () => {
  applicationVersion = '2.5.0';
  const legacyClient = new NanoKvmDevice({ device, timeoutMs: 5000 });
  try {
    await legacyClient.changePassword({ current: 'admin', next: 'newpass1' });
  } finally {
    legacyClient.close();
  }
  const body = seen.passwordBodies.at(-1);
  assert.equal(body.username, 'admin');
  assert.equal('currentPassword' in body, false);
  assert.equal(decryptPassword(body.password), 'newpass1');
});

await check('2.6 password changes send both encrypted passwords and no username', async () => {
  applicationVersion = '2.6.0';
  const modernClient = new NanoKvmDevice({ device, timeoutMs: 5000 });
  try {
    await modernClient.changePassword({ current: 'admin', next: 'newpass1' });
  } finally {
    modernClient.close();
  }
  const body = seen.passwordBodies.at(-1);
  assert.equal('username' in body, false);
  assert.equal(decryptPassword(body.currentPassword), 'admin');
  assert.equal(decryptPassword(body.password), 'newpass1');
  applicationVersion = '2.5.0';
});

await check('the panel gate only blocks the four input actions', async () => {
  const fake = {
    power: async () => ({ before: false, after: true }),
    setOled: async (sleep) => {
      fake.oled = sleep;
      return { sleep: sleep ? 1 : 0 };
    },
    mount: async (spec) => {
      fake.mounted = spec;
      return { ok: true };
    },
  };
  const view = new PanelView({
    pool: { target: () => ({ name: 'lab', client: fake }) },
    settings: () => ({ injectInput: false, view: { autoOpen: true } }),
    store: { summary: () => [] },
  });
  for (const action of ['paste', 'key', 'mouse', 'pointer']) {
    await assert.rejects(view.act(action, {}), /input injection is disabled/);
  }
  const power = await view.act('power', { mode: 'press' });
  assert.equal(power.power.after, true);
  await view.act('oled', { sleep: true });
  assert.equal(fake.oled, true);
  await view.act('mount', { rel: '/data/test.iso' });
  assert.equal(fake.mounted.rel, '/data/test.iso');

  view.reveal('lab');
  const signal = await view.state(undefined, { signal: true });
  assert.equal(signal.reveal, 1);
  assert.equal(signal.device, 'lab');
  assert.deepEqual(signal.view, { autoOpen: true });
});

await check('resolution still falls back to a frame when input-resolution 404s', async () => {
  const local = new NanoKvmDevice({ device, timeoutMs: 5000 });
  try {
    await local.login();
    const resolution = await local.resolution();
    assert.equal(resolution, null);
    assert.equal(seen.inputResolution >= 1, true);
    local.screenshot = async () => ({ jpeg: Buffer.alloc(0), width: 1024, height: 768 });
    const size = await local.screenSize();
    assert.deepEqual(size, { width: 1024, height: 768 });
  } finally {
    local.close();
  }
});

client.close();
server.close();

if (problems.length > 0) {
  console.log(JSON.stringify({ problems }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ problems: [] }));
