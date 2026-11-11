/**
 * Contract tests for the settings layer — no network, no harness.
 *
 * `lib/config.js` calls `.volatile()` on top-level fields; the harness patches that
 * into schemastery, a bare checkout does not have it. The shim below is the whole
 * difference, so these tests run anywhere Node runs.
 */
import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';

const proto = Object.getPrototypeOf(z.string());
if (typeof proto.volatile !== 'function') {
  proto.volatile = function volatile() {
    return this;
  };
}

const { Config, CONFIG_KEYS, normalizeBaseUrl, deviceNames, normalizeDevices, resolveSettings, deviceSettings, snapshot } = await import(
  '../lib/config.js'
);

const problems = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
  }
};

check('normalizeBaseUrl adds http to a bare address', () => {
  assert.equal(normalizeBaseUrl('192.168.2.57'), 'http://192.168.2.57');
});
check('normalizeBaseUrl keeps https and drops the trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://kvm.lan/'), 'https://kvm.lan');
});
check('normalizeBaseUrl keeps an explicit port', () => {
  assert.equal(normalizeBaseUrl('kvm.lan:8080'), 'http://kvm.lan:8080');
});
check('normalizeBaseUrl rejects empty and non-http schemes', () => {
  assert.equal(normalizeBaseUrl('   '), '');
  assert.equal(normalizeBaseUrl('ftp://kvm.lan'), '');
});
check('deviceNames fills gaps and suffixes duplicates', () => {
  assert.deepEqual(deviceNames([{ name: '' }, { name: 'lab' }, { name: 'lab' }, { name: 'lab' }]), [
    'kvm-1',
    'lab',
    'lab-2',
    'lab-3',
  ]);
});
check('normalizeDevices drops entries without an address and defaults the login', () => {
  const devices = normalizeDevices({
    devices: [
      { name: 'a', baseUrl: '' },
      { name: 'b', baseUrl: '10.0.0.5' },
    ],
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'b');
  assert.equal(devices[0].username, 'admin');
  assert.equal(devices[0].password, '');
  assert.equal(devices[0].insecureTls, false);
});
check('resolveSettings marks the configured default and falls back to the first', () => {
  const named = resolveSettings({ devices: [{ name: 'a', baseUrl: '10.0.0.1' }, { name: 'b', baseUrl: '10.0.0.2' }], defaultDevice: 'b' });
  assert.equal(named.defaultDevice, 'b');
  const loose = resolveSettings({ devices: [{ name: 'a', baseUrl: '10.0.0.1' }], requestTimeoutMs: 10, viewFps: 9 });
  assert.equal(loose.defaultDevice, 'a');
  assert.equal(loose.requestTimeoutMs, 1000);
  assert.equal(loose.view.fps, 4);
  assert.equal(loose.injectInput, true);
});
check('deviceSettings resolves by name, case-insensitively, and explains a miss', () => {
  const settings = resolveSettings({ devices: [{ name: 'Lab', baseUrl: '10.0.0.1' }], defaultDevice: 'Lab' });
  assert.equal(deviceSettings(settings, 'lab').name, 'Lab');
  assert.equal(deviceSettings(settings, '').name, 'Lab');
  assert.throws(() => deviceSettings(settings, 'nope'), /no NanoKVM device named "nope" — configured: Lab/);
});
check('deviceSettings explains an empty configuration', () => {
  assert.throws(() => deviceSettings(resolveSettings({}), 'x'), /no NanoKVM device is configured/);
});
check('Config applies the documented defaults', () => {
  // A published schemastery keeps `.volatile()` fields as refs, so read them
  // through the same unwrapping the plugin uses at runtime.
  const value = snapshot(Config({}));
  assert.deepEqual(value.devices, []);
  assert.equal(value.requestTimeoutMs, 15000);
  assert.equal(value.injectInput, true);
  assert.equal(value.viewAutoOpen, false);
  assert.equal(value.viewFps, 1);
});
check('snapshot unwraps live refs and passes plain values through', () => {
  const plain = snapshot({ devices: [{ name: 'a' }], viewFps: 2 });
  assert.equal(plain.viewFps, 2);
  const live = snapshot({ viewFps: { get: () => 3 } });
  assert.equal(live.viewFps, 3);
});
check('CONFIG_KEYS covers every top-level schema field', () => {
  const schemaKeys = Object.keys(Config.dict ?? Config.toJSON?.().dict ?? {});
  if (schemaKeys.length > 0) assert.deepEqual([...schemaKeys].sort(), [...CONFIG_KEYS].sort());
});

/** Paths of output properties carrying a boolean `required` (invalid in JSON Schema). */
function requiredFlags(schema, path = '$') {
  const offenders = [];
  if (schema === null || typeof schema !== 'object') return offenders;
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => offenders.push(...requiredFlags(item, `${path}[${index}]`)));
    return offenders;
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'required' && typeof value === 'boolean') offenders.push(path);
    else if (key === 'properties' || key === 'items' || key === 'oneOf' || key === 'anyOf') offenders.push(...requiredFlags(value, `${path}.${key}`));
  }
  return offenders;
}

const expectedTools = {
  'nanokvm_devices': '../tools/device.js',
  'nanokvm_status': '../tools/device.js',
  'nanokvm_screenshot': '../tools/screen.js',
  'nanokvm_resolution': '../tools/screen.js',
  'nanokvm_power': '../tools/control.js',
  'nanokvm_reset': '../tools/control.js',
  'nanokvm_type': '../tools/control.js',
  'nanokvm_key': '../tools/control.js',
  'nanokvm_mouse': '../tools/control.js',
  'nanokvm_media': '../tools/media.js',
  'nanokvm_mount': '../tools/media.js',
  'nanokvm_eject': '../tools/media.js',
  'nanokvm_hdmi': '../tools/system.js',
  'nanokvm_oled': '../tools/system.js',
  'nanokvm_system': '../tools/system.js',
};

const factories = {
  '../tools/device.js': 'deviceTools',
  '../tools/screen.js': 'screenTools',
  '../tools/control.js': 'controlTools',
  '../tools/media.js': 'mediaTools',
  '../tools/system.js': 'systemTools',
};

const deps = { pool: { target: () => ({ name: 'x', client: {}, device: {} }) }, settings: () => resolveSettings({}), attachments: {} };
const { defineTool } = await import('@deepseek-ai/dsh-tools');
const seen = new Set();
for (const [file, factoryName] of Object.entries(factories)) {
  const module = await import(file);
  const tools = module[factoryName](deps);
  for (const tool of tools) {
    seen.add(tool.name);
    if (typeof tool.description !== 'string' || tool.description.length < 30) problems.push(`${tool.name}: description is too thin`);
    if (typeof tool.execute !== 'function') problems.push(`${tool.name}: no execute`);
    if (tool.parameters !== undefined && typeof tool.parameters !== 'object') problems.push(`${tool.name}: parameters must be an object map`);
    if (tool.output?.schema?.type !== 'object') problems.push(`${tool.name}: output schema must be an object`);
    if (typeof tool.output?.render !== 'function') problems.push(`${tool.name}: output needs a render function`);
    for (const offender of requiredFlags(tool.output?.schema)) problems.push(`${tool.name}: output property ${offender} uses required: true; JSON Schema needs a required array`);

    // The plugin registers `defineTool(options)`, and only that compiled form is
    // safe to send: the raw author map has no root `type: "object"`, so a
    // parameter named `type` is read as the schema keyword and the provider
    // rejects the tool — which fails every model request in every session.
    let compiled;
    try {
      compiled = defineTool(tool);
    } catch (error) {
      problems.push(`${tool.name}: defineTool rejected the definition — ${error.message}`);
      continue;
    }
    const parameters = compiled.parameters;
    if (parameters?.type !== 'object') {
      problems.push(`${tool.name}: compiled parameters must be an object schema, got ${JSON.stringify(parameters)?.slice(0, 120)}`);
    } else if (parameters.properties === null || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) {
      problems.push(`${tool.name}: compiled parameters need a properties record`);
    } else {
      for (const name of parameters.required ?? []) {
        if (!Object.hasOwn(parameters.properties, name)) problems.push(`${tool.name}: required names "${name}" which is not a property`);
      }
      for (const [name, schema] of Object.entries(parameters.properties)) {
        if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) problems.push(`${tool.name}: parameter ${name} is not a schema object`);
        else if (schema.type === undefined && schema.oneOf === undefined) problems.push(`${tool.name}: parameter ${name} declares neither type nor oneOf`);
        else if (Object.hasOwn(schema, 'required') && typeof schema.required === 'boolean') problems.push(`${tool.name}: parameter ${name} keeps author flag required: true`);
      }
    }
    if (compiled.output?.schema?.type !== 'object') problems.push(`${tool.name}: compiled output schema must be an object`);
  }
}
for (const name of Object.keys(expectedTools)) {
  if (!seen.has(name)) problems.push(`missing tool ${name}`);
}

if (problems.length > 0) {
  console.log(JSON.stringify({ problems }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ problems: [] }));
