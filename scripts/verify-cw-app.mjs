// Runs a real downstream application's own test suite and production build
// against the staged distribution.
//
// `verify-consumer-app.mjs` proves the distribution works in an application this
// repository wrote. That application was written against what the distribution
// happens to expose, so it can share the distribution's blind spots — which is
// exactly how the mandatory React edge survived `verify-consumer.mjs`. Running
// the real consumer is the check that cannot be written to fit.
//
// The readiness record has claimed this result since before it could be
// repeated: "Disposable CW tests: PASS, 16/16" and a passing Next.js production
// build, both from a manual run nothing could reproduce. This script is the
// missing piece.
//
// Usage:
//   BLOCKSUITE_ARTIFACT_DIR=/abs/path/to/artifacts \
//     node scripts/verify-cw-app.mjs --app /abs/path/to/cloakedworkspace
//
// The application checkout is never modified. It is copied to a disposable
// directory, and every install and build happens there.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = name => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const appDir = resolve(argOf('--app') ?? process.env.CW_APP_DIR ?? '');
const keepProject = argv.includes('--keep');
if (!appDir || !existsSync(join(appDir, 'package.json'))) {
  throw new Error(
    'Pass the application checkout with --app /abs/path (or set CW_APP_DIR). ' +
      'It must contain a package.json.'
  );
}

const artifactDir = resolve(
  process.env.BLOCKSUITE_ARTIFACT_DIR ??
    join(tmpdir(), 'cloaked-workspace-blocksuite-0.27.0-cw.1-artifacts')
);
const inventoryPath = join(artifactDir, 'inventory.json');
if (!existsSync(inventoryPath)) {
  throw new Error(
    `No artifacts at ${artifactDir}. Run "yarn build:packages" first, or set BLOCKSUITE_ARTIFACT_DIR.`
  );
}
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const mapping = JSON.parse(
  readFileSync(join(root, 'provenance/PACKAGE_NAME_MAPPING.json'), 'utf8')
);
const distributionFor = new Map(mapping.packages.map(p => [p.source, p.distribution]));
const tarballFor = new Map(
  inventory.packages.map(p => [p.name, join(artifactDir, p.filename)])
);

console.log(
  `Verifying ${appDir}\n` +
    `against ${inventory.packageCount} packages from ${artifactDir}\n` +
    `Built with Node ${inventory.node}, npm ${inventory.npm}, content ${inventory.inventoryContentSha256}\n`
);

const appManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

// Which BlockSuite packages does the application actually declare? Only those
// get redirected; the rest of its dependency graph is left exactly as it is.
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies'];
const declared = [];
for (const field of dependencyFields) {
  for (const name of Object.keys(appManifest[field] ?? {})) {
    if (name.startsWith('@blocksuite/')) declared.push({ field, name });
  }
}
if (declared.length === 0) {
  throw new Error(
    'The application declares no @blocksuite/* dependencies. Either the wrong ' +
      'directory was passed, or it consumes the editor some other way — say ' +
      'which, because this script cannot guess.'
  );
}

const redirected = [];
const unmapped = [];
for (const { field, name } of declared) {
  // `@blocksuite/icons` is consumed from upstream and deliberately not
  // republished, so it must keep resolving to the real registry package.
  if (mapping.externalUnchanged.includes(name)) continue;
  const distribution = distributionFor.get(name);
  const tarball = distribution && tarballFor.get(distribution);
  if (!tarball) {
    unmapped.push(name);
    continue;
  }
  redirected.push({ field, name, distribution, tarball });
}

console.log(`Application declares ${declared.length} @blocksuite/* dependencies`);
console.log(`Redirecting ${redirected.length} to the distribution`);
for (const entry of redirected) {
  console.log(`  ${entry.name} -> ${entry.distribution}`);
}
if (unmapped.length > 0) {
  // Not fatal on its own: it means the application uses a package this
  // distribution does not carry, which is a finding rather than a script error.
  console.log(
    `\nNot in the distribution, left untouched: ${unmapped.join(', ')}\n` +
      'If the application imports these at runtime, the distribution does not ' +
      'cover its full surface.'
  );
}

// Copy rather than mutate. The application checkout is somebody's working tree.
const projectDir = mkdtempSync(join(tmpdir(), 'cw-app-proof-'));
const workDir = join(projectDir, 'app');
console.log(`\nCopying the application to ${workDir}`);
cpSync(appDir, workDir, {
  recursive: true,
  dereference: false,
  filter: source => {
    const relative = source.slice(appDir.length + 1);
    if (!relative) return true;
    const top = relative.split('/')[0];
    return !['node_modules', '.next', '.git', 'dist', 'build', '.turbo'].includes(top);
  },
});

// Every distribution package goes in as a `file:` dependency, not just the ones
// the application names. The tarballs depend on each other by version, and those
// versions are not published anywhere, so the whole graph has to be supplied
// locally — the same reason `verify-consumer.mjs` installs all 70.
//
// An `npm:` alias would be the obvious way to keep the application's own
// `@blocksuite/*` imports resolving, but it resolves against the registry, where
// nothing is published. The names are linked into `node_modules` after install
// instead, which is what an alias would have produced anyway.
const workManifest = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf8'));
for (const entry of redirected) {
  delete workManifest[entry.field][entry.name];
}
workManifest.dependencies ??= {};
for (const entry of inventory.packages) {
  workManifest.dependencies[entry.name] = `file:${join(artifactDir, entry.filename)}`;
}
writeFileSync(
  join(workDir, 'package.json'),
  `${JSON.stringify(workManifest, null, 2)}\n`
);

// A stale lockfile pins the old graph and would defeat the redirect.
for (const lock of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
  const path = join(workDir, lock);
  if (existsSync(path)) {
    rmSync(path);
    console.log(`Removed ${lock} so the redirect is what resolves`);
  }
}

const packageManager = existsSync(join(appDir, 'pnpm-lock.yaml'))
  ? 'pnpm'
  : existsSync(join(appDir, 'yarn.lock'))
    ? 'yarn'
    : 'npm';
console.log(`Package manager: ${packageManager}`);

const results = [];
const step = (name, command, args) => {
  console.log(`\n=== ${name} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  try {
    execFileSync(command, args, { cwd: workDir, stdio: 'inherit', env: process.env });
    results.push([name, 'PASS']);
    return true;
  } catch (error) {
    results.push([name, `FAIL (${error.status ?? error.message})`]);
    return false;
  }
};

const installArgs =
  packageManager === 'npm'
    ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
    : packageManager === 'pnpm'
      ? ['install', '--ignore-scripts']
      : ['install', '--mode=skip-build'];
const installed = step('Install against the distribution', packageManager, installArgs);

if (installed) {
  // Point the application's original specifiers at the installed distribution
  // packages, so its own source keeps resolving unchanged. This is the step that
  // makes the run a test of the distribution rather than a test of a rename.
  console.log('\nLinking the original names to the distribution packages');
  for (const entry of redirected) {
    const target = join(workDir, 'node_modules', entry.distribution);
    const link = join(workDir, 'node_modules', entry.name);
    if (!existsSync(target)) {
      throw new Error(`Expected ${entry.distribution} to be installed at ${target}`);
    }
    mkdirSync(dirname(link), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(target, link, 'dir');
    console.log(`  ${entry.name} -> ${entry.distribution}`);
  }
}

if (installed) {
  const scripts = workManifest.scripts ?? {};
  // Run what the application defines rather than a guessed command.
  const testScript = ['test', 'test:unit', 'test:ci', 'vitest', 'jest'].find(s => scripts[s]);
  const buildScript = ['build', 'build:prod'].find(s => scripts[s]);

  if (testScript) step(`Test suite (${testScript})`, packageManager, ['run', testScript]);
  else results.push(['Test suite', 'SKIP (no test script found)']);

  if (buildScript) step(`Production build (${buildScript})`, packageManager, ['run', buildScript]);
  else results.push(['Production build', 'SKIP (no build script found)']);
}

console.log('\n=== Result ===');
for (const [name, outcome] of results) console.log(`${outcome.padEnd(28)} ${name}`);

if (keepProject) console.log(`\nDisposable copy kept at ${workDir}`);
else rmSync(projectDir, { recursive: true, force: true });

const failed = results.filter(([, outcome]) => outcome.startsWith('FAIL'));
if (failed.length > 0) {
  console.error(`\nCW application proof FAILED: ${failed.map(([n]) => n).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nCW application proof passed');
}
