// These checks prove the lab's transport and browser host, not Apple Pencil hardware.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { buildLab, createLabServer } from './server.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cw-ipad-verify-'));
const assetsDir = process.env.IPAD_LAB_TEST_ASSETS ?? join(dir, 'app');
const dataDir = join(dir, 'data');
const token = 'verification-only-token';
let server;
let browser;
let contextA;
let contextB;
const errors = [];
const log = text => console.log(`PASS  ${text}`);
try {
  if (!process.env.IPAD_LAB_TEST_ASSETS) { console.log('Building the device test host…'); await buildLab(assetsDir); }
  server = await createLabServer({ assetsDir, dataDir, token });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = (path, options = {}) => fetch(`${origin}/api/${path}?room=verification`, { ...options, headers: { 'x-lab-token': token, 'content-type': 'application/json', ...options.headers } });
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin}/.git/config`)).status, 404);
  assert.equal((await api('sync', { method: 'POST', body: JSON.stringify({ update: 'not-base64!' }) })).status, 400);
  log('test endpoints require the token, reject malformed updates and do not expose repository files');

  browser = await chromium.launch();
  contextA = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true });
  contextB = await browser.newContext({ viewport: { width: 810, height: 1080 }, hasTouch: true });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  for (const page of [pageA, pageB]) page.on('pageerror', error => errors.push(error.message));
  const url = `${origin}/?room=verification&token=${token}&mode=page`;
  await Promise.all([pageA.goto(url), pageB.goto(url)]);
  await Promise.all([pageA, pageB].map(page => page.waitForFunction(() => window.ipadLab?.ready, undefined, { timeout: 30_000 })));
  assert.equal((await pageA.evaluate(() => window.ipadLab.paragraphs())).length, 2);
  assert.equal((await pageB.evaluate(() => window.ipadLab.paragraphs())).length, 2);
  assert.equal(await pageA.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).isDisabled(), true);
  assert.equal(await pageB.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).isDisabled(), true);
  log('simultaneous fresh clients open one canonical document without duplicate seed blocks');

  const editable = pageA.locator('affine-paragraph [contenteditable="true"]').first();
  await editable.click();
  await pageA.keyboard.press('End');
  await pageA.keyboard.type(' Synced from keyboard.');
  await pageB.waitForFunction(() => window.ipadLab.paragraphs().some(text => text.includes('Synced from keyboard.')));
  const inputDiagnostics = await pageA.evaluate(() => window.ipadLab.summary());
  assert(inputDiagnostics.textInputs.editor > 0, 'actual editor typing must be counted even when input is prevented');
  assert.equal(inputDiagnostics.diagnosticVersion, 2);
  assert.equal(inputDiagnostics.textInputMetric, 'beforeinput-events');
  assert.equal(inputDiagnostics.textInputs.editor, inputDiagnostics.textInputEvents.editor.beforeinput);
  log('real editor typing reaches the second browser through Yjs');
  log('editor beforeinput activity is counted alongside the verified model change');

  const original = await pageA.evaluate(() => window.ipadLab.paragraphs()[0]);
  await pageA.getByRole('button', { name: 'Skriv med penna', exact: true }).click();
  const native = pageA.getByLabel('Text att lägga till', { exact: true });
  await native.fill('Handskrift med åäö — already recognized test text.');
  // fill() may emit only input. Generate a real keyboard edit as well so the
  // native beforeinput metric is checked without counting input a second time.
  await native.press('End');
  await native.press('Space');
  await native.press('Backspace');
  const nativeDiagnostics = await pageA.evaluate(() => window.ipadLab.summary());
  assert(nativeDiagnostics.textInputs.native > 0);
  assert(nativeDiagnostics.textInputEvents.native.input > 0);
  assert.equal(nativeDiagnostics.textInputs.native, nativeDiagnostics.textInputEvents.native.beforeinput);
  await native.dispatchEvent('compositionstart', { data: 'test' });
  const insert = pageA.getByRole('button', { name: 'Lägg till i textblocket', exact: true });
  assert.equal(await insert.isDisabled(), true);
  await native.dispatchEvent('compositionend', { data: 'test' });
  assert.equal(await insert.isDisabled(), false);
  await insert.click();
  await pageB.waitForFunction(() => window.ipadLab.paragraphs()[0].includes('Handskrift med åäö'));
  assert.equal((await pageA.evaluate(() => window.ipadLab.paragraphs())).length, 2);
  assert.equal(await pageA.evaluate(() => window.ipadLab.paragraphs()[0]), `${original}\nHandskrift med åäö — already recognized test text.`);
  assert.equal(await native.inputValue(), '');
  await pageA.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).click();
  await pageB.waitForFunction(expected => window.ipadLab.paragraphs()[0] === expected, original);
  assert.equal(await pageB.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).isDisabled(), true);
  await pageA.getByRole('button', { name: 'Gör om i dokumentet', exact: true }).click();
  await pageB.waitForFunction(() => window.ipadLab.paragraphs()[0].includes('Handskrift med åäö'));
  log('visible document undo/redo syncs and does not add remote changes to the other client\'s undo history');
  await pageA.getByRole('button', { name: 'Stäng', exact: true }).click();
  log('native writing field respects composition and appends Unicode text to an existing synced block');

  await pageA.getByRole('button', { name: 'Skriv med penna', exact: true }).click();
  await pageA.getByLabel('Textblock', { exact: true }).selectOption('new');
  await native.fill('Penndraft');
  await pageA.getByRole('button', { name: 'Tangentbord', exact: true }).click();
  assert.equal(await native.evaluate(element => document.activeElement === element), true);
  assert.equal(await native.inputValue(), 'Penndraft');
  await pageA.keyboard.type(' + tangentbord');
  assert.equal(await native.inputValue(), 'Penndraft + tangentbord');
  await native.fill('Penndraft + tangentbord + ändring');
  await pageA.getByRole('button', { name: 'Ångra text i fältet', exact: true }).click();
  assert.equal(await native.inputValue(), 'Penndraft + tangentbord');
  await pageA.getByRole('button', { name: 'Gör om text i fältet', exact: true }).click();
  assert.equal(await native.inputValue(), 'Penndraft + tangentbord + ändring');
  await pageA.getByRole('button', { name: 'Skriv med penna', exact: true }).click();
  assert.equal(await native.inputValue(), 'Penndraft + tangentbord + ändring');
  assert.equal(await pageA.getByLabel('Textblock', { exact: true }).inputValue(), 'new');
  assert.equal(await pageA.getByRole('button', { name: 'Skriv med penna', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await native.evaluate(element => document.activeElement === element), false);
  await pageA.setViewportSize({ width: 810, height: 1080 });
  await pageA.waitForFunction(() => document.getElementById('handwriting-panel').getBoundingClientRect().top >= document.querySelector('header').getBoundingClientRect().bottom);
  assert.equal(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const panelBounds = await pageA.locator('#handwriting-panel').boundingBox();
  const headerBounds = await pageA.locator('header').boundingBox();
  assert(panelBounds.y >= headerBounds.y + headerBounds.height);
  if (process.env.IPAD_LAB_SCREENSHOT) await pageA.screenshot({ path: process.env.IPAD_LAB_SCREENSHOT });
  await pageA.setViewportSize({ width: 1194, height: 834 });
  log('pen/keyboard switches preserve draft and target; draft undo/redo works; portrait controls fit');
  await native.fill('Text from the native writing field in a new block.');
  await insert.click();
  await pageB.waitForFunction(() => window.ipadLab.paragraphs().includes('Text from the native writing field in a new block.'));
  await pageA.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).click();
  await pageB.waitForFunction(() => !window.ipadLab.paragraphs().includes('Text from the native writing field in a new block.'));
  await pageA.getByRole('button', { name: 'Gör om i dokumentet', exact: true }).click();
  await pageB.waitForFunction(() => window.ipadLab.paragraphs().includes('Text from the native writing field in a new block.'));
  await pageA.getByRole('button', { name: 'Stäng', exact: true }).click();
  log('native writing can also create a new text block');

  await Promise.all([
    pageA.evaluate(() => window.ipadLab.append('Concurrent A')),
    pageB.evaluate(() => window.ipadLab.append('Concurrent B')),
  ]);
  for (const page of [pageA, pageB]) await page.waitForFunction(() => ['Concurrent A', 'Concurrent B'].every(text => window.ipadLab.paragraphs().includes(text)));
  assert.deepEqual(await pageA.evaluate(() => window.ipadLab.paragraphs()), await pageB.evaluate(() => window.ipadLab.paragraphs()));
  log('concurrent edits converge in the same order');

  await contextB.setOffline(true);
  await pageB.evaluate(() => window.ipadLab.append('Offline edit'));
  await pageA.evaluate(() => window.ipadLab.append('Online while B was offline'));
  await pageB.waitForFunction(() => window.ipadLab.summary().cacheStatus === 'Sparad lokalt');
  await contextB.setOffline(false);
  for (const page of [pageA, pageB]) await page.waitForFunction(() => ['Offline edit', 'Online while B was offline'].every(text => window.ipadLab.paragraphs().includes(text)));
  await pageB.reload();
  await pageB.waitForFunction(() => window.ipadLab?.ready && window.ipadLab.paragraphs().includes('Offline edit'));
  log('offline edits merge on reconnect and survive reload');

  await pageA.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await pageA.locator('affine-edgeless-root').waitFor();
  await pageB.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await pageB.locator('affine-edgeless-root').waitFor();
  await pageA.locator('edgeless-pen-tool-button [data-drawing-tool="brush"]').click();
  const beforeStroke = await pageA.evaluate(() => window.ipadLab.canvasElements());
  await pageA.mouse.move(120, 180);
  await pageA.mouse.down();
  await pageA.mouse.move(300, 230, { steps: 20 });
  await pageA.mouse.up();
  for (const page of [pageA, pageB]) await page.waitForFunction(() => window.ipadLab.canvasElements() > 0);
  await pageA.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).click();
  for (const page of [pageA, pageB]) await page.waitForFunction(expected => window.ipadLab.canvasElements() === expected, beforeStroke);
  await pageA.getByRole('button', { name: 'Gör om i dokumentet', exact: true }).click();
  for (const page of [pageA, pageB]) await page.waitForFunction(expected => window.ipadLab.canvasElements() > expected, beforeStroke);
  log('visible undo/redo also removes and restores a brush stroke across clients');
  log('a stroke drawn through the native brush tool syncs to the other whiteboard');

  await pageA.getByRole('button', { name: 'Infoga objekt', exact: true }).tap();
  if (process.env.IPAD_LAB_CANVAS_SCREENSHOT) await pageA.screenshot({ path: process.env.IPAD_LAB_CANVAS_SCREENSHOT });
  await pageA.getByRole('button', { name: 'Tankekarta', exact: true }).tap();
  for (const page of [pageA, pageB]) await page.waitForFunction(() => window.ipadLab.canvasKinds().includes('mindmap'));
  await pageA.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).click();
  for (const page of [pageA, pageB]) await page.waitForFunction(() => !window.ipadLab.canvasKinds().includes('mindmap'));
  await pageA.getByRole('button', { name: 'Gör om i dokumentet', exact: true }).click();
  for (const page of [pageA, pageB]) await page.waitForFunction(() => window.ipadLab.canvasKinds().includes('mindmap'));
  log('named touch choices insert a mind map without dragging and support synchronized undo/redo');

  // The native shape tool is kept: tapping it shows its shape and colour menu,
  // and a tap on the canvas places the chosen shape there.
  const shapesBefore = await pageA.evaluate(() => window.ipadLab.canvasKinds().filter(kind => kind === 'shape').length);
  assert.equal(await pageA.getByRole('button', { name: 'Former', exact: true }).count(), 0);
  await pageA.locator('edgeless-shape-tool-button').tap();
  await pageA.locator('edgeless-shape-menu').waitFor();
  await pageA.touchscreen.tap(1000, 200);
  for (const page of [pageA, pageB]) await page.waitForFunction(before => window.ipadLab.canvasKinds().filter(kind => kind === 'shape').length > before, shapesBefore);
  await pageA.getByRole('button', { name: 'Infoga objekt', exact: true }).tap();
  await pageA.getByRole('button', { name: 'Text', exact: true }).tap();
  await pageA.locator('affine-edgeless-text [contenteditable="true"]').waitFor();
  await pageA.keyboard.type('Text inserted through the touch menu');
  for (const page of [pageA, pageB]) await page.locator('affine-edgeless-text').filter({ hasText: 'Text inserted through the touch menu' }).waitFor();
  await pageA.getByRole('button', { name: 'Mallar', exact: true }).tap();
  await pageA.getByText('Inga mallar är laddade i den här testvyn.', { exact: false }).waitFor();
  await pageA.getByRole('button', { name: 'Stäng verktygsmenyn', exact: true }).tap();
  log('native shape tool places a shape by touch; text insertion works and the empty template catalog is explained');
  await pageA.getByRole('button', { name: 'Dokument', exact: true }).click();
  await pageA.locator('affine-page-root').waitFor();
  log('document and whiteboard mount in the same test session');

  await pageA.evaluate(() => {
    document.getElementById('editor').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 21, pressure: 0.65, tiltX: 12, bubbles: true }));
    document.getElementById('editor').dispatchEvent(new PointerEvent('pointerup', { pointerType: 'pen', pointerId: 21, pressure: 0, bubbles: true }));
  });
  const cdp = await contextA.newCDPSession(pageA);
  const touch = async (type, count) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : Array.from({ length: count }, (_, id) => ({ x: 500 + id * 60, y: 500, id })),
  });
  // Records whether the touchstart that brought the screen to N fingers was canceled.
  await pageA.evaluate(() => {
    window.touchStarts = [];
    window.addEventListener('touchstart', event => {
      setTimeout(() => window.touchStarts.push([event.touches.length, event.defaultPrevented]));
    });
  });
  const canceledAt = async fingers => {
    await pageA.waitForFunction(n => window.touchStarts.some(([count]) => count === n), fingers);
    return pageA.evaluate(n => window.touchStarts.find(([count]) => count === n)[1], fingers);
  };
  await touch('touchStart', 2);
  assert.equal(await canceledAt(2), false, 'two-finger zoom must keep its touches');
  await touch('touchEnd', 0);
  await touch('touchStart', 3);
  assert.equal(await canceledAt(3), true, 'three-finger touches are canceled before iPadOS sees them');
  await touch('touchEnd', 0);
  assert.equal((await pageA.evaluate(() => window.ipadLab.summary())).systemGestureBlocks, 1);
  log('three-finger touches are canceled and logged; two-finger touches are left alone');
  await pageA.getByRole('button', { name: 'Testpanel', exact: true }).click();
  await pageA.getByLabel('Enhet', { exact: true }).fill('Synthetic iPad verification');
  await pageA.getByLabel('Enhet', { exact: true }).blur();
  await pageA.getByLabel('Observation', { exact: true }).fill('Synthetic input only; no physical Pencil tested.');
  await pageA.getByRole('button', { name: 'Problem', exact: true }).click();
  await pageA.waitForFunction(async () => {
    const params = new URLSearchParams(location.search);
    const response = await fetch('/api/report?room=verification', { headers: { 'x-lab-token': params.get('token') } });
    const report = await response.json();
    return report.clients.some(client => client.summary.penEvents > 0 && client.events.some(event => event.kind === 'observation'));
  });
  const monitor = await contextA.newPage();
  await monitor.goto(`${origin}/monitor.html?room=verification&token=${token}`);
  await monitor.getByRole('heading', { name: 'Synthetic iPad verification' }).waitFor();
  log('synthetic pen diagnostics and scenario observations reach the Mac monitor');

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join(' | ')}`);
  const persisted = await (await api('state')).json();
  await contextA.close(); contextA = null;
  await contextB.close(); contextB = null;
  await browser.close(); browser = null;
  await new Promise(resolve => server.close(resolve));
  server = await createLabServer({ assetsDir, dataDir, token });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const afterRestart = await (await fetch(`http://127.0.0.1:${server.address().port}/api/state?room=verification`, { headers: { 'x-lab-token': token } })).json();
  assert.equal(afterRestart.update, persisted.update);
  log('the canonical test document survives a test-server restart');

  const webkitExecutable = process.env.IPAD_LAB_WEBKIT_EXECUTABLE ?? webkit.executablePath();
  if (existsSync(webkitExecutable)) {
    browser = await webkit.launch({ executablePath: webkitExecutable });
    const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?room=verification&token=${token}`);
    await page.waitForFunction(() => window.ipadLab?.ready);
    await page.locator('affine-edgeless-root').waitFor();
    const webkitShapes = await page.evaluate(() => window.ipadLab.canvasKinds().filter(kind => kind === 'shape').length);
    await page.locator('edgeless-shape-tool-button').tap();
    await page.locator('edgeless-shape-menu').waitFor();
    await page.touchscreen.tap(1000, 200);
    await page.waitForFunction(before => window.ipadLab.canvasKinds().filter(kind => kind === 'shape').length > before, webkitShapes);
    const webkitMindmaps = await page.evaluate(() => window.ipadLab.canvasKinds().filter(kind => kind === 'mindmap').length);
    await page.getByRole('button', { name: 'Infoga objekt', exact: true }).tap();
    await page.getByRole('button', { name: 'Tankekarta', exact: true }).tap();
    await page.waitForFunction(before => window.ipadLab.canvasKinds().filter(kind => kind === 'mindmap').length > before, webkitMindmaps);
    await page.getByRole('button', { name: 'Infoga objekt', exact: true }).tap();
    await page.getByRole('button', { name: 'Text', exact: true }).tap();
    await page.locator('affine-edgeless-text [contenteditable="true"]').last().waitFor();
    await page.keyboard.type('WebKit text from the touch menu');
    await page.locator('affine-edgeless-text').filter({ hasText: 'WebKit text from the touch menu' }).waitFor();
    log('WebKit touch menus create new shapes, mind maps and editable text');
    await page.getByRole('button', { name: 'Dokument', exact: true }).click();
    await page.locator('affine-page-root').waitFor();
    await page.locator('affine-paragraph [contenteditable="true"]').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' WebKit input counter.');
    await page.waitForFunction(() => window.ipadLab.paragraphs().some(text => text.includes('WebKit input counter.')));
    assert((await page.evaluate(() => window.ipadLab.summary())).textInputs.editor > 0);
    await page.getByRole('button', { name: 'Tangentbord', exact: true }).click();
    const input = page.getByLabel('Text att lägga till', { exact: true });
    assert.equal(await input.evaluate(element => document.activeElement === element), true);
    await input.fill('WebKit native text insertion');
    await page.getByRole('button', { name: 'Lägg till i textblocket', exact: true }).click();
    await page.waitForFunction(() => window.ipadLab.paragraphs().some(text => text.includes('WebKit native text insertion')));
    await page.getByRole('button', { name: 'Ångra i dokumentet', exact: true }).click();
    await page.waitForFunction(() => !window.ipadLab.paragraphs().some(text => text.includes('WebKit native text insertion')));
    await page.getByRole('button', { name: 'Gör om i dokumentet', exact: true }).click();
    await page.waitForFunction(() => window.ipadLab.paragraphs().some(text => text.includes('WebKit native text insertion')));
    assert.deepEqual(errors, [], `Unexpected WebKit errors: ${errors.join(' | ')}`);
    await browser.close(); browser = null;
    log('WebKit mounts both modes and inserts native-field text (handwriting recognition remains a physical test)');
  } else console.log('SKIP  WebKit binary is not installed; physical iPad and Pencil remain untested.');
  console.log('\niPad lab verification passed.');
} finally {
  await contextA?.close();
  await contextB?.close();
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
