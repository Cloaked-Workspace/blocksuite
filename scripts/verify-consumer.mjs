// Installs the staged distribution tarballs into a disposable project outside
// the repository and asserts they are self-contained and resolvable.
//
// The readiness record described this proof for a long time without anything in
// the repository that could re-run it. This script is that missing piece: it
// takes the artifacts `build-cw-packages.mjs` produces and checks what a
// consumer actually receives, so the claim can be reproduced rather than
// recited.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = resolve(
  dirname(process.execPath),
  '../lib/node_modules/npm/bin/npm-cli.js'
);
const artifactDir = resolve(
  process.env.BLOCKSUITE_ARTIFACT_DIR ??
    join(tmpdir(), 'cloaked-workspace-blocksuite-0.27.0-cw.1-artifacts')
);
const keepProject = process.argv.includes('--keep');

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });

const walk = (dir, predicate, output = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, predicate, output);
    else if (predicate(path)) output.push(path);
  }
  return output;
};

const inventoryPath = join(artifactDir, 'inventory.json');
if (!existsSync(inventoryPath)) {
  throw new Error(
    `No artifacts at ${artifactDir}. Run "yarn build:packages" first, or set BLOCKSUITE_ARTIFACT_DIR.`
  );
}
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
console.log(
  `Verifying ${inventory.packageCount} packages from ${artifactDir}\n` +
    `Built with Node ${inventory.node}, npm ${inventory.npm}, content ${inventory.inventoryContentSha256}`
);

const projectDir = mkdtempSync(join(tmpdir(), 'cw-consumer-'));
const dependencies = Object.fromEntries(
  inventory.packages.map(entry => [
    entry.name,
    `file:${join(artifactDir, entry.filename)}`,
  ])
);
writeFileSync(
  join(projectDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'cw-consumer-proof',
      private: true,
      type: 'module',
      dependencies,
    },
    null,
    2
  )}\n`
);

// `--ignore-scripts` is the point rather than a convenience: a consumer install
// of these packages must never need to execute anything.
console.log('\nInstalling into a disposable project with scripts disabled');
run(
  process.execPath,
  [
    npmCli,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--loglevel',
    'error',
  ],
  { cwd: projectDir }
);

const installedScope = join(projectDir, 'node_modules', '@cloaked-workspace');
const installed = readdirSync(installedScope).sort();
if (installed.length !== inventory.packageCount) {
  throw new Error(
    `Installed ${installed.length} packages, expected ${inventory.packageCount}`
  );
}

// Every internal reference must have been rewritten. `@blocksuite/icons` is the
// one dependency the fork consumes from upstream rather than republishing, so it
// is the only original-scope specifier allowed to survive.
const sourceScopePattern = /@blocksuite\/[a-z0-9-]+/g;
const strayReferences = [];
for (const name of installed) {
  const packageRoot = join(installedScope, name);
  const files = walk(
    packageRoot,
    path =>
      path.endsWith('.js') ||
      path.endsWith('.mjs') ||
      path.endsWith('.d.ts') ||
      basename(path) === 'package.json'
  );
  for (const path of files) {
    for (const match of readFileSync(path, 'utf8').matchAll(
      sourceScopePattern
    )) {
      if (match[0] === '@blocksuite/icons') continue;
      strayReferences.push(`${name}: ${match[0]} in ${basename(path)}`);
    }
  }
}
if (strayReferences.length > 0) {
  throw new Error(
    `Installed packages still reference the original scope:\n${strayReferences
      .slice(0, 20)
      .join('\n')}`
  );
}
console.log(
  `Installed ${installed.length} packages, 0 unrewritten original-scope references`
);

// Resolution is checked through the installed exports maps, which is what a
// bundler follows. Resolving every entry catches a broken map that a single
// smoke import would miss.
const require = createRequire(join(projectDir, 'noop.cjs'));
const unresolved = [];
for (const name of installed) {
  const specifier = `@cloaked-workspace/${name}`;
  try {
    require.resolve(specifier);
  } catch (error) {
    unresolved.push(`${specifier}: ${error.code ?? error.message}`);
  }
}
if (unresolved.length > 0) {
  throw new Error(`Entry points did not resolve:\n${unresolved.join('\n')}`);
}
console.log(`Resolved ${installed.length} package entry points`);

// A `types` field must point at a file that exists. The builder rewrites export
// entries to `dist`, and a stale top-level `types` left behind still resolves
// for `node16` and `bundler` module resolution while breaking classic `node`.
const brokenTypes = [];
for (const name of installed) {
  const packageRoot = join(installedScope, name);
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8')
  );
  if (manifest.types && !existsSync(join(packageRoot, manifest.types))) {
    brokenTypes.push(`${name}: types -> ${manifest.types}`);
  }
}
if (brokenTypes.length > 0) {
  throw new Error(`Manifest types fields point at missing files:\n${brokenTypes.join('\n')}`);
}
console.log('Every declared types entry exists');

// These packages are bundler targets: the compiled output uses extensionless and
// directory-relative specifiers, which Node's ESM resolver rejects and every
// bundler accepts. Linking them with a bundler is therefore the honest end-to-end
// check, and plain Node loadability is reported but not required.
// Every package declares `sideEffects: false`, so a bare `import 'pkg'` is
// tree-shaken away entirely and would link an empty bundle. Re-exporting each
// package as a namespace makes its bindings roots the bundler cannot drop.
const probeEntry = join(projectDir, 'bundle-probe.mjs');
writeFileSync(
  probeEntry,
  [
    "export * as affine from '@cloaked-workspace/blocksuite-affine';",
    "export * as std from '@cloaked-workspace/blocksuite-std';",
    "export * as store from '@cloaked-workspace/blocksuite-store';",
    "export * as sync from '@cloaked-workspace/blocksuite-sync';",
    '',
  ].join('\n')
);
const esbuild = join(root, 'node_modules', '.bin', 'esbuild');
if (!existsSync(esbuild)) {
  throw new Error(`esbuild not found at ${esbuild}; run a workspace install first`);
}
const bundleOutput = run(
  esbuild,
  [
    probeEntry,
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--log-level=warning',
    `--outfile=${join(projectDir, 'bundle.js')}`,
  ],
  { cwd: projectDir, capture: true }
);
if (bundleOutput.trim()) {
  console.log(bundleOutput.trim());
}
const bundleBytes = statSync(join(projectDir, 'bundle.js')).size;
const minimumBundleBytes = 1_000_000;
if (bundleBytes < minimumBundleBytes) {
  throw new Error(
    `Bundle is ${bundleBytes} bytes, below the ${minimumBundleBytes} floor. ` +
      'A near-empty bundle means the editor was tree-shaken away rather than linked.'
  );
}
console.log(
  `Bundled the editor entry points with esbuild: ${(bundleBytes / 1048576).toFixed(2)} MB`
);

let nodeLoadable = 0;
for (const name of installed) {
  try {
    await import(`file://${require.resolve(`@cloaked-workspace/${name}`)}`);
    nodeLoadable++;
  } catch {
    // Expected for bundler-targeted output; counted rather than asserted.
  }
}
console.log(
  `Loadable by Node's ESM resolver without bundling: ${nodeLoadable} of ${installed.length} (informational)`
);

if (keepProject) {
  console.log(`\nDisposable project kept at ${projectDir}`);
} else {
  rmSync(projectDir, { recursive: true, force: true });
}
console.log('\nConsumer proof passed');
