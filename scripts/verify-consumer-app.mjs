// Builds a real application against the staged distribution and drives it in a
// browser.
//
// `verify-consumer.mjs` proves the tarballs install, resolve and link. It stops
// there: a bundle above a size floor says the modules were reachable, not that
// the editor works. This script closes that gap. It mounts an editor from the
// published packages only, then asserts the document renders, typing reaches the
// model, and a model mutation reaches the view.
//
// The application under `scripts/consumer-app/` imports nothing from this
// repository. Every specifier in it resolves to an installed
// `@cloaked-workspace/*` tarball, which is the whole point.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = join(root, 'scripts/consumer-app');
const npmCli = resolve(
  dirname(process.execPath),
  '../lib/node_modules/npm/bin/npm-cli.js'
);
const artifactDir = resolve(
  process.env.BLOCKSUITE_ARTIFACT_DIR ??
    join(tmpdir(), 'cloaked-workspace-blocksuite-0.27.0-cw.1-artifacts')
);
const keepProject = process.argv.includes('--keep');

const inventoryPath = join(artifactDir, 'inventory.json');
if (!existsSync(inventoryPath)) {
  throw new Error(
    `No artifacts at ${artifactDir}. Run "yarn build:packages" first, or set BLOCKSUITE_ARTIFACT_DIR.`
  );
}
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
console.log(
  `Building an application against ${inventory.packageCount} packages from ${artifactDir}\n` +
    `Built with Node ${inventory.node}, npm ${inventory.npm}, content ${inventory.inventoryContentSha256}`
);

const projectDir = mkdtempSync(join(tmpdir(), 'cw-consumer-app-'));
const dependencies = Object.fromEntries(
  inventory.packages.map(entry => [
    entry.name,
    `file:${join(artifactDir, entry.filename)}`,
  ])
);
// `lit` is the render entry point the application itself calls, and the only
// dependency this proof adds. React is deliberately absent: the icon barrel used
// to re-export `@blocksuite/icons/rc`, which made `react/jsx-runtime` a hard
// requirement for every consumer. This install failing to bundle is what would
// catch that returning.
dependencies.lit = '^3.0.0';

mkdirSync(join(projectDir, 'src'), { recursive: true });
writeFileSync(
  join(projectDir, 'package.json'),
  `${JSON.stringify(
    { name: 'cw-consumer-app-proof', private: true, type: 'module', dependencies },
    null,
    2
  )}\n`
);
copyFileSync(join(appSource, 'main.ts'), join(projectDir, 'src/main.ts'));
copyFileSync(join(appSource, 'style.css'), join(projectDir, 'src/style.css'));
copyFileSync(join(appSource, 'index.html'), join(projectDir, 'index.html'));

console.log('\nInstalling into a disposable project with scripts disabled');
execFileSync(
  process.execPath,
  [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel', 'error'],
  { cwd: projectDir, stdio: 'inherit' }
);

const esbuild = join(root, 'node_modules/.bin/esbuild');
if (!existsSync(esbuild)) {
  throw new Error(`esbuild not found at ${esbuild}; run a workspace install first`);
}
console.log('Bundling the application');
execFileSync(
  esbuild,
  [
    'src/main.ts',
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2022',
    '--outfile=bundle.js',
    '--log-level=warning',
  ],
  { cwd: projectDir, stdio: 'inherit' }
);
execFileSync(
  esbuild,
  [
    'src/style.css',
    '--bundle',
    '--loader:.woff2=dataurl',
    '--loader:.woff=dataurl',
    '--loader:.ttf=dataurl',
    '--loader:.otf=dataurl',
    '--outfile=bundle.css',
    '--log-level=warning',
  ],
  { cwd: projectDir, stdio: 'inherit' }
);

// The application is three known files, so the request path selects one rather
// than building one. Joining a request path onto a directory would be a path
// traversal even here, where the server is bound to the loopback interface on an
// ephemeral port and serves a disposable directory.
const served = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/bundle.js', ['bundle.js', 'text/javascript']],
  ['/bundle.css', ['bundle.css', 'text/css']],
]);
const server = createServer((req, res) => {
  const requested = req.url.split('?')[0];
  // Browsers ask for this unprompted; a 404 would land in the console-error
  // assertion below.
  if (requested === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  const entry = served.get(requested);
  if (!entry) {
    res.writeHead(404).end('not found');
    return;
  }
  const [file, type] = entry;
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(join(projectDir, file)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const { chromium } = await import(join(root, 'node_modules/playwright/index.mjs'));
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {}
);
const page = await browser.newPage();

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('affine-paragraph', { timeout: 30_000 }).catch(() => {});

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

// Element registration is the step a link-only proof cannot see: the view
// extensions must have run their `effects()` during scope setup.
const expectedElements = [
  'editor-host',
  'affine-page-root',
  'affine-note',
  'affine-paragraph',
  'v-line',
];
const defined = await page.evaluate(
  tags => tags.filter(tag => customElements.get(tag) !== undefined),
  expectedElements
);
check(
  'custom elements registered',
  defined.length === expectedElements.length,
  `registered: ${defined.join(', ') || 'none'}`
);

const rendered = await page.evaluate(() => {
  const paragraph = document.querySelector('affine-paragraph');
  return {
    host: !!document.querySelector('editor-host'),
    paragraph: !!paragraph,
    // The inline editor's line, not the element's whole textContent, which also
    // picks up injected <style> blocks.
    text: paragraph?.querySelector('v-line')?.textContent?.trim() ?? '',
    editable: !!document.querySelector('[contenteditable="true"]'),
  };
});
check('editor host in the DOM', rendered.host);
check('paragraph rendered', rendered.paragraph);
check(
  'document text reached the DOM',
  rendered.text.includes('Hello from a separate project'),
  JSON.stringify(rendered.text.slice(0, 60))
);
check('an editable surface exists', rendered.editable);

const model = await page.evaluate(() => ({
  text: window.consumerProbe.paragraphText(),
  flavours: window.consumerProbe.blockFlavours(),
}));
check(
  'store model matches',
  model.text === 'Hello from a separate project',
  JSON.stringify(model.text)
);
check(
  'expected block flavours present',
  ['affine:page', 'affine:surface', 'affine:note', 'affine:paragraph'].every(flavour =>
    model.flavours.includes(flavour)
  ),
  model.flavours.join(', ')
);

// Typing exercises the full path a link-only proof never reaches:
// DOM event -> inline editor -> Yjs document -> block model.
let typedOk = false;
let typedText = '';
try {
  await page.locator('affine-paragraph [contenteditable="true"]').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' + edited live');
  await page.waitForFunction(
    () => window.consumerProbe.paragraphText()?.includes('edited live'),
    undefined,
    { timeout: 15_000 }
  );
  typedOk = true;
} catch {
  typedText = await page.evaluate(() => window.consumerProbe.paragraphText() ?? '');
}
check(
  'typing updates the document model',
  typedOk,
  typedOk ? '' : `model text stayed ${JSON.stringify(typedText)}`
);

// And the reverse direction: a model mutation must reach the rendered view.
await page.evaluate(() => window.consumerProbe.appendParagraph('Added through the store API'));
const reactive = await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll('affine-paragraph')].some(node =>
        node.textContent?.includes('Added through the store API')
      ),
    undefined,
    { timeout: 15_000 }
  )
  .then(() => true)
  .catch(() => false);
check('store mutation re-renders the view', reactive);

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

if (process.env.CONSUMER_APP_SCREENSHOT) {
  await page.screenshot({ path: resolve(process.env.CONSUMER_APP_SCREENSHOT) });
  console.log(`Screenshot written to ${resolve(process.env.CONSUMER_APP_SCREENSHOT)}`);
}

await browser.close();
server.close();

if (keepProject) {
  console.log(`\nDisposable project kept at ${projectDir}`);
} else {
  rmSync(projectDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nConsumer application proof FAILED: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nConsumer application proof passed');
}
