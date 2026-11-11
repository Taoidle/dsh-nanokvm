/**
 * The device store: adding, editing and removing a box without ever sending an
 * existing password back through the page.
 *
 * `node tools/check-store.mjs` — a failing assertion prints the reason and exits 1.
 */
import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';

// The harness patches `.volatile()` into schemastery; a bare checkout does not.
const proto = Object.getPrototypeOf(z.string());
if (typeof proto.volatile !== 'function') {
  proto.volatile = function volatile() {
    return this;
  };
}

const { createDeviceStore } = await import('../lib/store.js');

const problems = [];

/** A context whose configuration editor records what it is given. */
function fakeContext(initial) {
  const entry = { id: 'nanokvm' };
  const state = { config: { devices: initial.devices ?? [], defaultDevice: initial.defaultDevice ?? '' } };
  const ctx = {
    fiber: { entry },
    get(name) {
      if (name === 'configEditor') {
        return {
          async edit(target, mutate) {
            assert.equal(target, entry);
            state.config = mutate({ ...state.config });
          },
        };
      }
      if (name === 'settings') {
        return {
          describe: () => [{ ns: 'nanokvm', value: state.config }],
          async update() {
            throw new Error('the configEditor path should be used in this test');
          },
        };
      }
      return undefined;
    },
  };
  return { ctx, state };
}

async function main() {
  const { ctx, state } = fakeContext({ devices: [] });
  const store = createDeviceStore(ctx, { entryId: 'nanokvm', section: () => state.config });

  // A new device without a password is refused: the box answers "invalid
  // username or password" and the reason is then impossible to see.
  await assert.rejects(() => store.save({ name: 'lab', baseUrl: '192.168.2.57' }), /needs its web password/);

  const first = await store.save({ name: 'lab', baseUrl: '192.168.2.57', username: 'admin' }, { password: 'admin' });
  assert.deepEqual(first, { name: 'lab', added: true });
  assert.equal(state.config.devices.length, 1);
  assert.equal(state.config.devices[0].baseUrl, 'http://192.168.2.57', 'a bare address becomes http');
  assert.equal(state.config.devices[0].password, 'admin');
  assert.equal(state.config.defaultDevice, 'lab', 'the first device becomes the default');

  // A second device does not steal the default.
  await store.save({ name: 'office', baseUrl: 'http://10.0.0.9', username: 'root' }, { password: 's3cret' });
  assert.equal(state.config.defaultDevice, 'lab');
  assert.equal(state.config.devices.length, 2);

  // Editing an unrelated field of the FIRST device must keep its password.
  await store.save({ name: 'lab', baseUrl: 'http://192.168.2.57', username: 'admin', description: 'plugged into lab' });
  assert.equal(state.config.devices[0].password, 'admin', 'an untouched password survives an edit');
  assert.equal(state.config.devices[0].description, 'plugged into lab');

  // Editing a different device and saving must not touch the first one's secret.
  await store.save({ name: 'office', baseUrl: 'http://10.0.0.9', username: 'root', insecureTls: true });
  assert.equal(state.config.devices[0].password, 'admin');
  assert.equal(state.config.devices[1].password, 's3cret');

  // A new password replaces the old one.
  await store.save({ name: 'office', baseUrl: 'http://10.0.0.9', username: 'root' }, { password: 'newpass' });
  assert.equal(state.config.devices[1].password, 'newpass');

  // The panel's summary never carries a secret.
  const summary = store.summary();
  assert.equal(summary.length, 2);
  assert.equal(Object.hasOwn(summary[0], 'password'), false, 'the summary must not leak passwords');
  assert.equal(summary[0].hasPassword, true);
  assert.equal(summary[0].default, true);

  // The live section shows the overlay without re-reading the profile.
  assert.equal(store.section().devices.length, 2);

  // Default and remove.
  await store.setDefault('office');
  assert.equal(state.config.defaultDevice, 'office');
  await assert.rejects(() => store.remove('missing'), /no device named/);
  await store.remove('office');
  assert.equal(state.config.devices.length, 1);
  assert.equal(state.config.defaultDevice, 'lab', 'removing the default keeps a default');
}

try {
  await main();
} catch (error) {
  problems.push(error?.message ?? String(error));
}

if (problems.length === 0) process.stdout.write('{"problems":[]}\n');
else {
  process.stdout.write(`${JSON.stringify({ problems }, null, 2)}\n`);
  process.exitCode = 1;
}
