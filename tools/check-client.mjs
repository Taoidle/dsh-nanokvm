/**
 * The browser half, checked without a browser.
 *
 * Two things matter here and neither is visible from `node --check`:
 *
 *   1. the bundle registers itself under the package id the renderer looks the
 *      row up by, and
 *   2. it survives a broken build. The renderer treats a client entry that never
 *      materialises as a failed boot and refuses to start the whole app, so a
 *      throwing factory here is not "the panel is missing" — it is "no session
 *      opens at all". The factory therefore has to answer with an inert module
 *      instead of letting the throw escape.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};

/** A loader stand-in: it keeps the definition instead of executing anything. */
function loadBundle() {
  let definition;
  globalThis.window = {
    __ModuleLoader__: {
      load(loaded) {
        definition = loaded;
      },
    },
  };
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, append() {}, remove() {} }),
    head: { append() {} },
  };
  globalThis.console = { ...console };
  (0, eval)(readFileSync(join(root, 'client.js'), 'utf8'));
  return definition;
}

/** The three modules the shell hands to a client bundle, in miniature. */
function stubbedRequire({ failOn } = {}) {
  if (failOn !== undefined) {
    return (specifier) => {
      if (specifier === failOn) throw new Error(`stub failure for ${specifier}`);
      return {};
    };
  }
  const React = {
    useState: () => [null, () => {}],
    useEffect: () => {},
    useMemo: (compute) => compute(),
    useRef: () => ({ current: null }),
    useCallback: (callback) => callback,
    useLayoutEffect: () => {},
    createElement: () => null,
    memo: (component) => component,
    Fragment: 'fragment',
  };
  const runtime = { jsx: () => ({}), jsxs: () => ({}), Fragment: 'fragment' };
  const primitives = { Button: () => null, Checkbox: () => null, Input: () => null };
  return (specifier) => {
    if (specifier === 'react') return React;
    if (specifier === 'react/jsx-runtime') return runtime;
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`unexpected client requirement: ${specifier}`);
  };
}

const definition = loadBundle();
check(definition !== undefined, 'client.js did not call window.__ModuleLoader__.load');
check(definition?.id === 'dsh-nanokvm', `client bundle id is ${JSON.stringify(definition?.id)}, expected "dsh-nanokvm"`);
check(typeof definition?.factory === 'function', 'client bundle declares no factory');

const built = definition?.factory?.(stubbedRequire());
check(typeof built?.apply === 'function', 'client factory did not return an apply function');
const inject = built?.inject;
check(Array.isArray(inject), `client inject is ${JSON.stringify(inject)}, expected an array`);
for (const service of ['slots', 'locale', 'configForms']) {
  check(inject?.includes(service), `client inject is missing ${service}`);
}

// The guard: a throwing build must degrade, never propagate. Silence the
// expected console.error so a passing run stays readable.
const realError = console.error;
console.error = () => {};
let inert;
try {
  inert = definition?.factory?.(stubbedRequire({ failOn: 'react' }));
} finally {
  console.error = realError;
}
check(inert !== undefined, 'a throwing client build escaped the factory instead of degrading');
check(typeof inert?.apply === 'function', 'the inert fallback exposes no apply function');
check(Array.isArray(inert?.inject) && inert.inject.length === 0, 'the inert fallback must inject no services');

if (problems.length > 0) {
  console.log(JSON.stringify({ problems }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ problems: [] }));
}
