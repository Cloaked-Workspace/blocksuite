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
const yarn = join(root, '.yarn/releases/yarn-4.13.0.cjs');
const stageRoot = join(root, '.standalone-stage');
const scopeStage = join(stageRoot, 'node_modules', '@blocksuite');
const artifactDir = resolve(
  process.env.BLOCKSUITE_ARTIFACT_DIR ??
    join(tmpdir(), 'blocksuite-affine-0.27-standalone-artifacts')
);

if (!isAbsolute(artifactDir) || relative(root, artifactDir).startsWith('..') === false) {
  throw new Error('BLOCKSUITE_ARTIFACT_DIR must be outside the repository');
}
if (stageRoot !== join(root, '.standalone-stage')) {
  throw new Error('Refusing unsafe staging path');
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

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });

console.log(`Building ${packageNames.length} CW graph workspaces`);
run(process.execPath, [yarn, 'build']);

const accessorPattern = /^\s*(?:static\s+)?accessor\s/m;
let accessorFiles = 0;
for (const name of packageNames) {
  const packageRoot = dirname(manifests.get(name).path);
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

rmSync(stageRoot, { recursive: true, force: true });
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(scopeStage, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
const rawDir = mkdtempSync(join(tmpdir(), 'blocksuite-raw-packs-'));

for (const name of packageNames) {
  const base = name.slice('@blocksuite/'.length);
  const raw = join(rawDir, `${base}.tgz`);
  run(process.execPath, [yarn, 'workspace', name, 'pack', '--out', raw], {
    capture: true,
  });
  const extractDir = mkdtempSync(join(tmpdir(), 'blocksuite-pack-'));
  run('tar', ['-xzf', raw, '-C', extractDir], { capture: true });
  renameSync(join(extractDir, 'package'), join(scopeStage, base));
  rmSync(extractDir, { recursive: true, force: true });
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

let rewrittenExports = 0;
for (const name of packageNames) {
  const packageRoot = join(scopeStage, name.slice('@blocksuite/'.length));
  const path = join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.exports) {
    manifest.exports = Object.fromEntries(
      Object.entries(manifest.exports).map(([key, value]) => {
        const rewritten = rewriteExportValue(value);
        if (JSON.stringify(rewritten) !== JSON.stringify(value)) rewrittenExports += 1;
        return [key, rewritten];
      })
    );
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
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
  const packageName = `@blocksuite/${relative(scopeStage, packageRoot)}`;
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

const inventory = [];
for (const name of packageNames) {
  const base = name.slice('@blocksuite/'.length);
  const packageRoot = join(scopeStage, base);
  const npmOutput = JSON.parse(
    run(
      'npm',
      [
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
    name,
    version: JSON.parse(readFileSync(join(packageRoot, 'package.json'))).version,
    filename,
    bytes: statSync(artifact).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    files: npmOutput[0].files.length,
  });
}

const remainingSourceExports = [];
const remainingAccessors = [];
const uncompiledCss = [];
for (const name of packageNames) {
  const packageRoot = join(scopeStage, name.slice('@blocksuite/'.length));
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json')));
  if (JSON.stringify(manifest.exports ?? {}).includes('./src/')) {
    remainingSourceExports.push(name);
  }
  for (const path of walk(join(packageRoot, 'dist'), path => path.endsWith('.js'))) {
    const source = readFileSync(path, 'utf8');
    if (accessorPattern.test(source)) remainingAccessors.push(path);
    if (path.endsWith('.css.js') && !source.startsWith(marker)) uncompiledCss.push(path);
  }
}
if (remainingSourceExports.length || remainingAccessors.length || uncompiledCss.length) {
  throw new Error(
    JSON.stringify({ remainingSourceExports, remainingAccessors, uncompiledCss }, null, 2)
  );
}

writeFileSync(
  join(artifactDir, 'inventory.json'),
  `${JSON.stringify(
    {
      sourceCommit: '00576e1e7842fb63095cdc5d7a236321957b550c',
      subtreeSha: 'd0e6e70bfa88943c79dd5608ff3556e9aafb1783',
      node: process.version,
      yarn: '4.13.0',
      packageCount: inventory.length,
      rewrittenExports,
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
console.log(`Artifacts: ${artifactDir}`);
