/**
 * Packaging test: every file the plugin imports must be inside the npm tarball.
 *
 * The `files` list in package.json decides what ships. A module that exists in
 * the checkout but is missing from that list installs as a broken bundle
 * (`ERR_MODULE_NOT_FOUND` at import time), which is silent until someone
 * installs it. This walks the relative imports from the two entry points and
 * compares them with `npm pack --dry-run --json`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g;

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }))[0];
const shipped = new Set((packed?.files ?? []).map((file) => file.path));

const seen = new Set();
const queue = ['index.js', 'client.js'];
while (queue.length > 0) {
  const from = queue.shift();
  if (seen.has(from)) continue;
  seen.add(from);
  const absolute = join(root, from);
  if (!existsSync(absolute)) {
    problems.push(`${from}: imported but missing from the checkout`);
    continue;
  }
  if (!shipped.has(from)) problems.push(`${from}: imported but not in the npm tarball — add it to package.json "files"`);
  const source = readFileSync(absolute, 'utf8');
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const target = relative(root, resolve(dirname(absolute), match[1]));
    if (target.startsWith('..')) continue;
    queue.push(target);
  }
}

if (!shipped.has('LICENSE')) problems.push('LICENSE is missing from the tarball');
if (problems.length > 0) {
  console.log(JSON.stringify({ problems }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ problems: [] }));
