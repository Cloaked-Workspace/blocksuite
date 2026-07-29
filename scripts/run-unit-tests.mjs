import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blocksuiteRoot = join(root, 'blocksuite');
const yarn = join(root, '.yarn/releases/yarn-4.13.0.cjs');
const runBrowser = process.argv.includes('--browser');

const walk = (dir, output = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, output);
    else if (entry.isFile() && basename(path) === 'vitest.config.ts') output.push(path);
  }
  return output;
};

const configs = walk(blocksuiteRoot)
  .filter(path => !path.includes('/integration-test/'))
  .filter(path => {
    const browser = readFileSync(path, 'utf8').includes('browser:');
    return runBrowser ? browser : !browser;
  })
  .sort();

if (!existsSync(yarn) || configs.length === 0) {
  throw new Error('Standalone Yarn runtime or unit-test configurations missing');
}

console.log(
  `Running ${configs.length} ${runBrowser ? 'browser' : 'Node/happy-dom'} unit-test configurations`
);
for (const config of configs) {
  const display = relative(root, config);
  console.log(`\n[vitest] ${display}`);
  execFileSync(
    process.execPath,
    [yarn, 'exec', 'vitest', 'run', '--config', config],
    { cwd: dirname(config), stdio: 'inherit' }
  );
}
