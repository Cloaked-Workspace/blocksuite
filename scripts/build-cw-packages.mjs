import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformSync } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blocksuiteRoot = join(root, 'blocksuite');
const mappingPath = join(root, 'provenance', 'PACKAGE_NAME_MAPPING.json');
const yarn = join(root, '.yarn/releases/yarn-4.13.0.cjs');
const npmCli = resolve(
  dirname(process.execPath),
  '../lib/node_modules/npm/bin/npm-cli.js'
);
const stageRoot = join(root, '.standalone-stage');
const sourceScope = '@blocksuite/';
// Tree of the exact AFFiNE import, and the tree actually built: the import plus
// the fork patches recorded in provenance/FORK_PATCHES.md. Keeping both means a
// reviewer can still verify the import mechanically and see exactly what the
// fork changed on top of it.
const upstreamSubtreeSha = 'd0e6e70bfa88943c79dd5608ff3556e9aafb1783';
const patchedSubtreeSha = '00e032a0b60085f0db8ea30d5d8e4bbb70fc251c';
const distributionScope = '@cloaked-workspace/';
const distributionVersion = '0.27.0-cw.1';
const scopeStage = join(stageRoot, 'node_modules', '@cloaked-workspace');
const artifactDir = resolve(
  process.env.BLOCKSUITE_ARTIFACT_DIR ??
    join(tmpdir(), 'cloaked-workspace-blocksuite-0.27.0-cw.1-artifacts')
);

if (!isAbsolute(artifactDir) || relative(root, artifactDir).startsWith('..') === false) {
  throw new Error('BLOCKSUITE_ARTIFACT_DIR must be outside the repository');
}
if (stageRoot !== join(root, '.standalone-stage')) {
  throw new Error('Refusing unsafe staging path');
}
if (!existsSync(npmCli)) {
  throw new Error(`Unable to locate the npm bundled with ${process.execPath}`);
}

const walk = (dir, predicate = () => true, output = []) => {
  if (!existsSync(dir)) return output;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, predicate, output);
    else if (entry.isFile() && predicate(path)) output.push(path);
  }
  return output;
};

const manifests = new Map();
for (const path of walk(blocksuiteRoot, path => basename(path) === 'package.json')) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.name) manifests.set(manifest.name, { manifest, path });
}

const roots = ['@blocksuite/affine', '@blocksuite/affine-block-image'];
const queue = [...roots];
const graph = new Set();
while (queue.length) {
  const name = queue.shift();
  if (graph.has(name)) continue;
  const record = manifests.get(name);
  if (!record) throw new Error(`Missing workspace ${name}`);
  graph.add(name);
  for (const dep of Object.keys(record.manifest.dependencies ?? {})) {
    if (dep.startsWith('@blocksuite/') && manifests.has(dep)) queue.push(dep);
  }
}
const packageNames = [...graph].sort();
const distributionNames = new Map(
  packageNames.map(name => [
    name,
    `${distributionScope}blocksuite-${name.slice(sourceScope.length)}`,
  ])
);
const mappingBytes = readFileSync(mappingPath);
const recordedMapping = JSON.parse(mappingBytes);
const expectedMapping = packageNames.map(name => ({
  source: name,
  distribution: distributionNames.get(name),
}));
if (
  recordedMapping.schemaVersion !== 1 ||
  recordedMapping.distributionScope !== distributionScope ||
  recordedMapping.distributionVersion !== distributionVersion ||
  JSON.stringify(recordedMapping.packages) !== JSON.stringify(expectedMapping)
) {
  throw new Error('Recorded package-name mapping does not match the build graph');
}
const packageRootFor = name =>
  join(scopeStage, distributionNames.get(name).slice(distributionScope.length));
const internalSpecifierPattern = /@blocksuite\/[a-z0-9-]+/g;
const rewriteInternalSpecifiers = source =>
  source.replace(internalSpecifierPattern, name => distributionNames.get(name) ?? name);

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });
const npmVersion = run(process.execPath, [npmCli, '--version'], {
  capture: true,
}).trim();

// `inventory.json` records the Node that produced the artifacts, and that record
// is provenance rather than trivia. Nothing was checking it: `.nvmrc` and
// `engines.node` both pin 22.23.1, Yarn Berry does not enforce engines, and a
// build on Node 20 was written into the inventory as though it were in spec.
//
// Refusing outright would be wrong, though. Running the builder on other
// runtimes is how the cross-platform reproduction evidence in
// PUBLICATION_READINESS.md gets produced, and one such run — Node 20.18.2 with
// npm 11.12.1 on macOS — agreed with Node 22.22.2 and 22.23.1 to the byte. So
// the pin is asserted by default and can be waived deliberately, and the
// inventory records which of the two happened.
const parseVersion = value =>
  value
    .replace(/^v/, '')
    .split('.')
    .map(Number);
const compareVersions = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  }
  return 0;
};
const engineRange = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8')
).engines.node;
const satisfiesEngine = version =>
  engineRange
    .split(/\s+/)
    .filter(Boolean)
    .every(clause => {
      const [, operator, bound] = clause.match(/^(>=|<=|>|<|=)?(.+)$/);
      const order = compareVersions(version, bound);
      switch (operator) {
        case '>=':
          return order >= 0;
        case '<=':
          return order <= 0;
        case '>':
          return order > 0;
        case '<':
          return order < 0;
        default:
          return order === 0;
      }
    });

const nodePinHonored = satisfiesEngine(process.version);
const waiveNodePin = process.env.BLOCKSUITE_ALLOW_UNPINNED_NODE === '1';
if (!nodePinHonored && !waiveNodePin) {
  throw new Error(
    `Node ${process.version} does not satisfy the pinned range "${engineRange}". ` +
      'Artifacts built here would be recorded in inventory.json as provenance, so ' +
      'the pin is asserted rather than assumed. Switch to the pinned Node, or set ' +
      'BLOCKSUITE_ALLOW_UNPINNED_NODE=1 to build deliberately off-pin — the ' +
      'inventory will record that the pin was waived.'
  );
}
if (!nodePinHonored) {
  console.log(
    `Node pin waived: building on ${process.version}, outside "${engineRange}". ` +
      'inventory.json will record nodePinHonored: false.'
  );
}

console.log(
  `Building ${packageNames.length} CW graph workspaces for ${distributionScope} at ${distributionVersion}`
);
run(process.execPath, [yarn, 'build']);
const sourceTreeSha = run('git', ['rev-parse', 'HEAD:blocksuite'], {
  capture: true,
}).trim();
const trackedSourceChanges = run(
  'git',
  ['status', '--short', '--untracked-files=no', '--', 'blocksuite'],
  { capture: true }
).trim();
if (sourceTreeSha !== patchedSubtreeSha) {
  throw new Error(`Unexpected blocksuite source tree ${sourceTreeSha}`);
}
if (trackedSourceChanges) {
  throw new Error(`Build changed tracked AFFiNE source:\n${trackedSourceChanges}`);
}

const accessorPattern = /^\s*(?:static\s+)?accessor\s/m;

rmSync(stageRoot, { recursive: true, force: true });
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(scopeStage, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
const rawDir = mkdtempSync(join(tmpdir(), 'blocksuite-raw-packs-'));

for (const name of packageNames) {
  const base = name.slice(sourceScope.length);
  const raw = join(rawDir, `${base}.tgz`);
  run(process.execPath, [yarn, 'workspace', name, 'pack', '--out', raw], {
    capture: true,
  });
  const extractDir = mkdtempSync(join(tmpdir(), 'blocksuite-pack-'));
  run('tar', ['-xzf', raw, '-C', extractDir], { capture: true });
  renameSync(join(extractDir, 'package'), packageRootFor(name));
  rmSync(extractDir, { recursive: true, force: true });
}

let accessorFiles = 0;
for (const name of packageNames) {
  const packageRoot = packageRootFor(name);
  for (const path of walk(join(packageRoot, 'dist'), path => path.endsWith('.js'))) {
    const source = readFileSync(path, 'utf8');
    if (!accessorPattern.test(source)) continue;
    const { code } = transformSync(source, {
      loader: 'js',
      target: 'es2022',
      format: 'esm',
      sourcemap: false,
    });
    writeFileSync(path, code);
    accessorFiles += 1;
  }
}

const mapSourceExport = value => {
  if (typeof value !== 'string' || !value.startsWith('./src/')) return value;
  const base = value.replace('./src/', './dist/').replace(/\.ts$/, '');
  return {
    types: `${base}.d.ts`,
    import: `${base}.js`,
    default: `${base}.js`,
  };
};

const rewriteExportValue = value => {
  if (typeof value === 'string') return mapSourceExport(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      const mapped = mapSourceExport(nested);
      if (mapped !== nested && typeof mapped === 'object') {
        return [key, mapped.default];
      }
      return [key, rewriteExportValue(nested)];
    })
  );
};

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const externalSourceScopeDependencies = [
  ...new Set(
    packageNames.flatMap(name =>
      dependencyFields.flatMap(field =>
        Object.keys(manifests.get(name).manifest[field] ?? {}).filter(
          dependency =>
            dependency.startsWith(sourceScope) && !distributionNames.has(dependency)
        )
      )
    )
  ),
].sort();
if (
  JSON.stringify(recordedMapping.externalUnchanged) !==
  JSON.stringify(externalSourceScopeDependencies)
) {
  throw new Error('Recorded external dependency list does not match the build graph');
}
let rewrittenExports = 0;
let droppedStaleTypes = 0;
let rewrittenPackageNames = 0;
let rewrittenDependencySpecifiers = 0;
for (const name of packageNames) {
  const packageRoot = packageRootFor(name);
  const path = join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.name = distributionNames.get(name);
  manifest.version = distributionVersion;
  rewrittenPackageNames += 1;
  for (const field of dependencyFields) {
    if (!manifest[field]) continue;
    manifest[field] = Object.fromEntries(
      Object.entries(manifest[field]).map(([dependency, specifier]) => {
        const distributionName = distributionNames.get(dependency);
        if (!distributionName) return [dependency, specifier];
        rewrittenDependencySpecifiers += 1;
        return [distributionName, distributionVersion];
      })
    );
  }
  if (manifest.exports) {
    manifest.exports = Object.fromEntries(
      Object.entries(manifest.exports).map(([key, value]) => {
        const rewritten = rewriteExportValue(value);
        if (JSON.stringify(rewritten) !== JSON.stringify(value)) rewrittenExports += 1;
        return [key, rewritten];
      })
    );
  }
  // A top-level `types` survives from upstream pointing at a path that only made
  // sense before the export entries were moved under `dist`. `node16` and
  // `bundler` resolution read it from the export entry instead, so the stale
  // field is invisible until a consumer uses classic `node` resolution and finds
  // nothing. The export map carries the declarations, so drop it.
  if (manifest.types && !existsSync(join(packageRoot, manifest.types))) {
    delete manifest.types;
    droppedStaleTypes += 1;
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

let rewrittenCompiledSpecifiers = 0;
let rewrittenDeclarationSpecifiers = 0;
const isDeclaration = path => /\.d\.(?:ts|mts|cts)$/.test(path);
const isCompiledJavaScript = path => /\.(?:js|mjs|cjs)$/.test(path);
for (const path of walk(
  scopeStage,
  path => isDeclaration(path) || isCompiledJavaScript(path)
)) {
  const source = readFileSync(path, 'utf8');
  const rewritten = rewriteInternalSpecifiers(source);
  if (rewritten === source) continue;
  const matches = source.match(internalSpecifierPattern) ?? [];
  const count = matches.filter(name => distributionNames.has(name)).length;
  if (isDeclaration(path)) rewrittenDeclarationSpecifiers += count;
  else rewrittenCompiledSpecifiers += count;
  writeFileSync(path, rewritten);
}

const marker = '// @blocksuite-standalone-precompiled-vanilla-extract';
const workerSource = `
import { setAdapter } from '@vanilla-extract/css/adapter';
import { setFileScope, endFileScope } from '@vanilla-extract/css/fileScope';
import { transformCss } from '@vanilla-extract/css/transformCss';
import { pathToFileURL } from 'node:url';
const [, filePath, scopePath, packageName] = process.argv;
const localClassNames = [];
const composedClassLists = [];
const cssObjs = [];
setAdapter({
  appendCss: value => cssObjs.push(value),
  registerClassName: value => localClassNames.push(value),
  registerComposition: value => composedClassLists.push(value),
  markCompositionUsed: () => {},
  onBeginFileScope: () => {},
  onEndFileScope: () => {},
  getIdentOption: () => 'debug',
});
setFileScope(scopePath, packageName);
const namespace = await import(pathToFileURL(filePath).href);
endFileScope();
const css = transformCss({ localClassNames, composedClassLists, cssObjs }).join('\\n');
const exports = {};
for (const key of Object.keys(namespace)) {
  JSON.stringify(namespace[key]);
  exports[key] = namespace[key];
}
process.stdout.write(JSON.stringify({ css, exports }));
`;

const cssFiles = walk(scopeStage, path => path.endsWith('.css.js'))
  .map(path => ({ path, source: readFileSync(path, 'utf8') }))
  .sort((a, b) => {
    const count = source => (source.match(/from '\.[^']*\.css'/g) ?? []).length;
    return count(a.source) - count(b.source);
  });

for (const { path } of cssFiles) {
  const distAt = path.indexOf('/dist/');
  const packageRoot = path.slice(0, distAt);
  const packageName = `${distributionScope}${relative(scopeStage, packageRoot)}`;
  const scopePath = relative(packageRoot, path).replace(/\.js$/, '.ts');
  const output = run(
    process.execPath,
    [
      '--experimental-loader',
      join(root, 'scripts/standalone-node-loader.mjs'),
      '--no-warnings',
      '--input-type=module',
      '-e',
      workerSource,
      '--',
      path,
      scopePath,
      packageName,
    ],
    { capture: true, cwd: root }
  );
  const { css, exports } = JSON.parse(output);
  const styleId = `blocksuite-ve-${packageName.replace(/[^a-z0-9-]/gi, '-')}-${scopePath.replace(/[^a-z0-9-]/gi, '-')}`;
  const lines = [
    marker,
    '// Generated during the standalone package build; do not edit.',
    `const css = ${JSON.stringify(css)};`,
    `if (typeof document !== 'undefined' && !document.getElementById(${JSON.stringify(styleId)})) {`,
    `  const element = document.createElement('style');`,
    `  element.id = ${JSON.stringify(styleId)};`,
    '  element.textContent = css;',
    '  document.head.append(element);',
    '}',
  ];
  for (const [key, value] of Object.entries(exports)) {
    lines.push(`export const ${key} = ${JSON.stringify(value)};`);
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
}

// Every imported manifest declares `sideEffects: false`, which is wrong: 62
// packages ship an `effects.js` whose whole purpose is calling
// `customElements.define`, and the precompiled Vanilla Extract files append a
// `<style>` element to the document. A bundler that believes the metadata drops
// both, registering no elements and loading no styles. esbuild does exactly
// that, and reports it: "Ignoring this import because ... was marked as having
// no side effects".
//
// The files are listed exactly rather than by glob. A first attempt declared
// `**/effects.js` and friends, and the verification pass immediately caught
// `affine-block-paragraph/dist/heading-icon.js`, which registers
// `affine-paragraph-heading-icon` without following that naming convention.
// Scanning for the effect itself cannot miss a file the way a convention can.
// `import 'x'` runs a module for its effect. `import {} from 'x'` looks similar
// but is what tsc leaves behind after eliding type-only imports, and 61 files
// carry one — including the umbrella `effects.js`, whose source is nothing but
// `import { type effects as ... }` declarations. Treating those as effects
// marks most of the graph unshakeable for no reason, so only the binding-free
// form counts.
const sideEffectOnlyImport = /(?:^|\n)\s*import\s*['"]/;
const carriesSideEffect = source =>
  source.includes('customElements.define(') ||
  source.includes('document.head.append(') ||
  sideEffectOnlyImport.test(source);

let packagesWithSideEffects = 0;
let declaredSideEffectFiles = 0;
for (const name of packageNames) {
  const packageRoot = packageRootFor(name);
  const effectFiles = walk(packageRoot, path => path.endsWith('.js'))
    .filter(path => carriesSideEffect(readFileSync(path, 'utf8')))
    .map(path => `./${relative(packageRoot, path)}`)
    .sort();
  if (effectFiles.length === 0) continue;
  const manifestPath = join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.sideEffects = effectFiles;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  packagesWithSideEffects += 1;
  declaredSideEffectFiles += effectFiles.length;
}

// TypeScript's incremental build cache is build state, not something a package
// should publish: roughly 96 KB each, and its `latestChangedDtsFile` field
// varies with build scheduling. Measured over two forced rebuilds, it was the
// only file in the whole 70-package graph whose bytes changed.
let removedBuildInfoFiles = 0;
for (const name of packageNames) {
  for (const path of walk(packageRootFor(name), path =>
    path.endsWith('.tsbuildinfo')
  )) {
    rmSync(path);
    removedBuildInfoFiles++;
  }
}

/**
 * Digest of what a package publishes, independent of the archiver.
 *
 * The archive hash covers the gzip bytes npm produced, which are only guaranteed
 * for one archiver. This digest takes the file set npm decided to publish and
 * reads the bytes from the staged tree instead, so npm plays no part in
 * producing the values it covers. It is invariant across archivers by
 * construction, while still changing if npm's inclusion rules change or if any
 * published byte changes.
 *
 * Measured on npm 10.9.8 and 11.12.1, both this digest and the archive hashes
 * came out identical for all 70 packages, so today the archive hash happens to
 * be stable too. This digest does not depend on that continuing to hold.
 *
 * Formula, documented in BUILDING.md: for each published file, sorted by path,
 * feed `path`, NUL, file bytes, NUL into one SHA-256.
 */
function packageContentDigest(packageRoot, files) {
  const digest = createHash('sha256');
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const { path: relativePath } of sorted) {
    digest.update(relativePath);
    digest.update('\0');
    digest.update(readFileSync(join(packageRoot, relativePath)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

const inventory = [];
for (const name of packageNames) {
  const packageRoot = packageRootFor(name);
  const npmOutput = JSON.parse(
    run(
      process.execPath,
      [
        npmCli,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        artifactDir,
        packageRoot,
      ],
      { capture: true }
    )
  );
  const filename = npmOutput[0].filename;
  const artifact = join(artifactDir, filename);
  const bytes = readFileSync(artifact);
  inventory.push({
    sourceName: name,
    name: distributionNames.get(name),
    version: JSON.parse(readFileSync(join(packageRoot, 'package.json'))).version,
    filename,
    bytes: statSync(artifact).size,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    contentSha256: packageContentDigest(packageRoot, npmOutput[0].files),
    files: npmOutput[0].files.length,
  });
}

// Equivalence across two independent builds is checked on this value, not on the
// archive hashes. It is not a substitute for npm provenance once publication is
// configured; it only proves two pre-publication builds staged the same content.
const inventoryContentLines = inventory
  .map(entry => `${entry.name}@${entry.version} ${entry.contentSha256}`)
  .sort()
  .join('\n');
const inventoryContentSha256 = createHash('sha256')
  .update(`${inventoryContentLines}\n`)
  .digest('hex');

const remainingSourceExports = [];
const remainingAccessors = [];
const uncompiledCss = [];
const remainingWorkspaceSpecifiers = [];
const remainingInternalSpecifiers = [];
for (const name of packageNames) {
  const packageRoot = packageRootFor(name);
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json')));
  if (manifest.name !== distributionNames.get(name)) {
    throw new Error(`Unexpected staged package name for ${name}: ${manifest.name}`);
  }
  if (manifest.version !== distributionVersion) {
    throw new Error(`Unexpected staged version for ${name}: ${manifest.version}`);
  }
  if (JSON.stringify(manifest.exports ?? {}).includes('./src/')) {
    remainingSourceExports.push(name);
  }
  for (const field of dependencyFields) {
    for (const [dependency, specifier] of Object.entries(manifest[field] ?? {})) {
      if (distributionNames.has(dependency)) remainingInternalSpecifiers.push(dependency);
      if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
        remainingWorkspaceSpecifiers.push(`${manifest.name}:${field}:${dependency}`);
      }
    }
  }
  for (const path of walk(join(packageRoot, 'dist'), path => path.endsWith('.js'))) {
    const source = readFileSync(path, 'utf8');
    if (accessorPattern.test(source)) remainingAccessors.push(path);
    if (path.endsWith('.css.js') && !source.startsWith(marker)) uncompiledCss.push(path);
  }
  for (const path of walk(
    join(packageRoot, 'dist'),
    path => isDeclaration(path) || isCompiledJavaScript(path)
  )) {
    const source = readFileSync(path, 'utf8');
    const matches = source.match(internalSpecifierPattern) ?? [];
    if (matches.some(specifier => distributionNames.has(specifier))) {
      remainingInternalSpecifiers.push(path);
    }
  }
}
if (
  remainingSourceExports.length ||
  remainingAccessors.length ||
  uncompiledCss.length ||
  remainingWorkspaceSpecifiers.length ||
  remainingInternalSpecifiers.length
) {
  throw new Error(
    JSON.stringify(
      {
        remainingSourceExports,
        remainingAccessors,
        uncompiledCss,
        remainingWorkspaceSpecifiers,
        remainingInternalSpecifiers,
      },
      null,
      2
    )
  );
}

writeFileSync(
  join(artifactDir, 'inventory.json'),
  `${JSON.stringify(
    {
      sourceCommit: '00576e1e7842fb63095cdc5d7a236321957b550c',
      upstreamSubtreeSha,
      patchedSubtreeSha,
      verifiedSourceTreeSha: sourceTreeSha,
      node: process.version,
      nodeEngineRange: engineRange,
      nodePinHonored,
      yarn: '4.13.0',
      npm: npmVersion,
      packageNameMappingSha256: createHash('sha256')
        .update(mappingBytes)
        .digest('hex'),
      distributionScope,
      distributionVersion,
      externalSourceScopeDependencies,
      inventoryContentSha256,
      packagesWithDeclaredSideEffects: packagesWithSideEffects,
      declaredSideEffectFiles,
      buildInfoFilesRemoved: removedBuildInfoFiles,
      packageCount: inventory.length,
      rewrittenPackageNames,
      rewrittenDependencySpecifiers,
      rewrittenCompiledSpecifiers,
      rewrittenDeclarationSpecifiers,
      rewrittenExports,
      droppedStaleTypes,
      accessorFilesDownleveled: accessorFiles,
      vanillaExtractFilesPrecompiled: cssFiles.length,
      packages: inventory,
    },
    null,
    2
  )}\n`
);

rmSync(rawDir, { recursive: true, force: true });
rmSync(stageRoot, { recursive: true, force: true });
console.log(
  `Built ${inventory.length} local tarballs; rewrote ${rewrittenExports} exports, ` +
    `downleveled ${accessorFiles} accessor files, and precompiled ${cssFiles.length} Vanilla Extract files.`
);
console.log(`Inventory content SHA-256: ${inventoryContentSha256}`);
console.log(`Artifacts: ${artifactDir}`);
