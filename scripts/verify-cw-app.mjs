// Runs a real downstream application's own test suite and production build
// against the staged distribution.
//
// `verify-consumer-app.mjs` proves the distribution works in an application this
// repository wrote. That application was written against what the distribution
// happens to expose, so it can share the distribution's blind spots — which is
// exactly how the mandatory React edge survived `verify-consumer.mjs`. Running
// the real consumer is the check that cannot be written to fit.
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
  readdirSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = name => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const keepProject = argv.includes('--keep');

// `--app` may point at the application itself or at a repository root that
// contains it. Guessing between them is cheap and saves a support round trip.
const appArgument = resolve(argOf('--app') ?? process.env.CW_APP_DIR ?? '');
const appCandidates = [appArgument, join(appArgument, 'web'), join(appArgument, 'app')];
const appDir = appCandidates.find(path => existsSync(join(path, 'package.json')));
if (!appArgument || !appDir) {
  throw new Error(
    'Pass the application with --app /abs/path (or set CW_APP_DIR). Looked for a ' +
      `package.json in:\n${appCandidates.map(p => `  ${p}`).join('\n')}`
  );
}
if (appDir !== appArgument) {
  console.log(`Resolved --app ${appArgument} to ${appDir}`);
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
const tarballFor = new Map(
  inventory.packages.map(p => [p.name, join(artifactDir, p.filename)])
);
const distributionFor = new Map(mapping.packages.map(p => [p.source, p.distribution]));

console.log(
  `Verifying ${appDir}\n` +
    `against ${inventory.packageCount} packages from ${artifactDir}\n` +
    `Built with Node ${inventory.node}, npm ${inventory.npm}, content ${inventory.inventoryContentSha256}` +
    (inventory.nodePinHonored === false
      ? `\nArtifacts were built off-pin (${inventory.nodeEngineRange})`
      : '') +
    '\n'
);

const appManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies'];

// A consumer may name these packages either way, and both must work. An
// application converted to the distribution names is the current shape; one
// still on the upstream names is what a fresh consumer of published packages
// would look like, and it needs the original specifier linked to the renamed
// package. The inventory and the mapping decide which case applies, so no prefix
// is hardcoded.
const redirected = [];
const unmapped = [];
for (const field of dependencyFields) {
  for (const name of Object.keys(appManifest[field] ?? {})) {
    if (mapping.externalUnchanged.includes(name)) continue;
    if (tarballFor.has(name)) {
      redirected.push({ field, name, distribution: name, needsAlias: false });
      continue;
    }
    const distribution = distributionFor.get(name);
    if (distribution && tarballFor.has(distribution)) {
      redirected.push({ field, name, distribution, needsAlias: true });
      continue;
    }
    if (name.startsWith('@blocksuite/')) unmapped.push(name);
  }
}
if (redirected.length === 0) {
  throw new Error(
    'The application declares no packages this distribution provides, under ' +
      'either the upstream or the distribution names. Either the wrong directory ' +
      'was passed, or it consumes the editor some other way — say which, because ' +
      'this script cannot guess.'
  );
}

const aliased = redirected.filter(entry => entry.needsAlias);
console.log(
  `Application declares ${redirected.length} of ${inventory.packageCount} distribution packages` +
    (aliased.length > 0
      ? `, ${aliased.length} under the upstream names`
      : ', all under the distribution names')
);
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
const skipDirectories = ['node_modules', '.next', '.git', 'dist', 'build', '.turbo'];
const copyTree = (from, to) => {
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter: source => {
      const rel = source.slice(from.length + 1);
      return !rel || !skipDirectories.includes(rel.split('/')[0]);
    },
  });
};
console.log(`\nCopying the application to ${workDir}`);
copyTree(appDir, workDir);

// Sibling directories the application reaches outside its own tree have to
// travel with it, or the copy cannot install or run. They arrive two ways, and
// only handling the declared one is not enough: the real consumer's tests import
// a sibling workspace by relative path without declaring it as a dependency at
// all. The copy keeps each sibling at the same position relative to the
// application, so those relative imports resolve unchanged.
const workManifest = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf8'));
const siblings = new Map();
const adoptSibling = target => {
  const name = basename(target);
  if (siblings.has(name)) return siblings.get(name);
  const copied = join(projectDir, name);
  console.log(`Copying the ${name} sibling to ${copied}`);
  copyTree(target, copied);
  const record = { name, dir: copied };
  siblings.set(name, record);
  return record;
};
const escapesApp = target => relative(appDir, target).startsWith('..');

// Declared as `file:` or `link:` dependencies.
for (const field of dependencyFields) {
  for (const [name, spec] of Object.entries(workManifest[field] ?? {})) {
    const match = typeof spec === 'string' && spec.match(/^(file:|link:)(.+)$/);
    if (!match) continue;
    const target = resolve(appDir, match[2]);
    if (!existsSync(join(target, 'package.json')) || !escapesApp(target)) continue;
    const record = adoptSibling(target);
    workManifest[field][name] = `${match[1]}${
      isAbsolute(match[2]) ? record.dir : relative(workDir, record.dir)
    }`;
  }
}

// Imported by relative path from the application's own sources. Undeclared, so
// nothing in the manifest points at them.
const sourcePattern = /\.(m|c)?[jt]sx?$/;
const specifierPattern = /(?:from|import|require)\s*\(?\s*['"](\.\.\/[^'"]+)['"]/g;
const walkSources = (dir, output = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDirectories.includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(path, output);
    else if (sourcePattern.test(entry.name)) output.push(path);
  }
  return output;
};
for (const path of walkSources(appDir)) {
  const source = readFileSync(path, 'utf8');
  for (const [, specifier] of source.matchAll(specifierPattern)) {
    const target = resolve(dirname(path), specifier);
    if (!escapesApp(target)) continue;
    // Take the directory that sits beside the application, not the file itself.
    const outside = relative(dirname(appDir), target).split('/')[0];
    if (!outside || outside.startsWith('..')) continue;
    const sibling = join(dirname(appDir), outside);
    if (existsSync(sibling)) adoptSibling(sibling);
  }
}

// Every distribution package goes in as a `file:` dependency, not just the ones
// the application names. The tarballs depend on each other by version, and those
// versions are not published anywhere, so the whole graph has to be supplied
// locally — the same reason `verify-consumer.mjs` installs all 70.
for (const entry of redirected) {
  delete workManifest[entry.field][entry.name];
}
workManifest.dependencies ??= {};
for (const entry of inventory.packages) {
  workManifest.dependencies[entry.name] = `file:${join(artifactDir, entry.filename)}`;
}
writeFileSync(join(workDir, 'package.json'), `${JSON.stringify(workManifest, null, 2)}\n`);

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
const step = (name, command, args, options = {}) => {
  console.log(`\n=== ${name} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  try {
    execFileSync(command, args, {
      cwd: options.cwd ?? workDir,
      stdio: 'inherit',
      env: process.env,
    });
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

// A sibling with its own lockfile installs its own graph; the application's
// install does not do it for it.
const installedSiblings = [];
for (const sibling of siblings.values()) {
  const manifestPath = join(sibling.dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Only install a sibling that needs its own graph. Installing one that does
  // not gives it an empty `node_modules` for nothing, and installing one that
  // does gives it a private copy of every shared dependency — which is how a
  // harness invents a duplicate the real application does not have. The yjs
  // count below is reported with that in mind.
  if (Object.keys(manifest.dependencies ?? {}).length === 0) {
    console.log(`\nSkipping the ${sibling.name} sibling install: it declares no dependencies`);
    continue;
  }
  const hasLock = existsSync(join(sibling.dir, 'package-lock.json'));
  installedSiblings.push(sibling.name);
  step(
    `Install the ${sibling.name} sibling`,
    'npm',
    [hasLock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: sibling.dir }
  );
}

if (installed) {
  // The claim this whole script exists to support is that the application ran
  // against these artifacts. Asserting it beats inferring it: npm records where
  // each package actually came from, so read that rather than trusting the
  // rewrite above.
  const lockPath = join(workDir, 'node_modules/.package-lock.json');
  const strayResolutions = [];
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      const name = path.replace(/^node_modules\//, '');
      if (!tarballFor.has(name)) continue;
      const resolved = (entry.resolved ?? '').replace(/^file:/, '');
      if (!resolve(workDir, decodeURIComponent(resolved)).startsWith(artifactDir)) {
        strayResolutions.push(`${name} <- ${entry.resolved ?? 'unrecorded'}`);
      }
    }
    const covered = Object.keys(lock.packages ?? {}).filter(path =>
      tarballFor.has(path.replace(/^node_modules\//, ''))
    ).length;
    console.log(
      `\nInstalled ${covered} distribution packages; ` +
        `${strayResolutions.length} resolved from outside ${artifactDir}`
    );
    results.push([
      'Packages resolved from the artifacts',
      strayResolutions.length === 0 && covered > 0
        ? 'PASS'
        : `FAIL (${strayResolutions.slice(0, 5).join(', ') || 'none installed'})`,
    ]);
  } else {
    results.push(['Packages resolved from the artifacts', 'SKIP (no npm lock written)']);
  }

  // Link the upstream specifiers to the installed distribution packages, so an
  // application still on the original names resolves unchanged. An `npm:` alias
  // would be the obvious way, but it resolves against the registry, where
  // nothing is published.
  if (aliased.length > 0) {
    console.log('\nLinking the upstream names to the distribution packages');
    for (const entry of aliased) {
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

  const scripts = workManifest.scripts ?? {};
  // Run what the application defines rather than a guessed command.
  const testScript = ['test', 'test:unit', 'test:ci', 'vitest', 'jest'].find(s => scripts[s]);
  const buildScript = ['build', 'build:prod'].find(s => scripts[s]);

  if (testScript) step(`Test suite (${testScript})`, packageManager, ['run', testScript]);
  else results.push(['Test suite', 'SKIP (no test script found)']);

  if (buildScript) step(`Production build (${buildScript})`, packageManager, ['run', buildScript]);
  else results.push(['Production build', 'SKIP (no build script found)']);

  // Yjs breaks `instanceof` across duplicate copies, and 21 distribution
  // packages declare it as a regular dependency rather than a peer, so a
  // consumer whose own range does not overlap gets a second one. Reported
  // rather than asserted: it is a property of the consumer's graph, and the
  // decision about those manifests is not this script's to make.
  try {
    const listed = execFileSync('npm', ['ls', 'yjs', '--all', '--json'], {
      cwd: workDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const versions = new Set();
    const walk = node => {
      for (const [name, child] of Object.entries(node.dependencies ?? {})) {
        if (name === 'yjs' && child.version) versions.add(child.version);
        walk(child);
      }
    };
    walk(JSON.parse(listed));
    console.log(
      `\nyjs copies in the application graph: ${versions.size || 'none'}` +
        (versions.size > 0 ? ` (${[...versions].join(', ')})` : '') +
        (versions.size > 1
          ? ' — more than one breaks Yjs constructor checks (informational)'
          : '') +
        (installedSiblings.length > 0
          ? `\nNote: ${installedSiblings.join(', ')} installed separately and may hold ` +
            'further copies this count does not see. A duplicate reached that way is ' +
            'this harness, not the distribution.'
          : '')
    );
  } catch {
    console.log('\nCould not enumerate yjs copies (informational)');
  }
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
