// A disposable device-testing host, not the CW application or its production backend.
import { getInternalStoreExtensions } from '@blocksuite/affine/extensions/store';
import { getInternalViewExtensions } from '@blocksuite/affine/extensions/view';
import { StoreExtensionManager, ViewExtensionManager } from '@blocksuite/affine/ext-loader';
import { BlockStdScope } from '@blocksuite/affine/std';
import type { BlockComponent } from '@blocksuite/affine/std';
import { GfxControllerIdentifier } from '@blocksuite/affine/std/gfx';
import { CommunityCanvasTextFonts, EditPropsStore, FontConfigExtension } from '@blocksuite/affine/shared/services';
import { DefaultTool } from '@blocksuite/affine/blocks/surface';
import { Bound } from '@blocksuite/affine/global/gfx';
import { createTemplateJob, EdgelessTemplatePanel, type Template } from '@blocksuite/affine-gfx-template';
import { getMindmapRender, mediaRender, textRender } from '../../blocksuite/affine/gfx/mindmap/src/toolbar/basket-elements';
import { Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { render } from 'lit';
import * as Y from 'yjs';
import './style.css';
import { touchToolbar, type CanvasMenu } from './touch-toolbar';

const params = new URLSearchParams(location.search);
const token = params.get('token') ?? '';
const room = params.get('room') ?? 'ipad-baseline';
const client = Math.random().toString(36).slice(2, 12);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Entry = { seq: number; at: string; kind: string; [key: string]: unknown };
const events: Entry[] = [];
let seq = 0;
let mode: 'page' | 'edgeless' = 'edgeless';
let std: BlockStdScope;
let syncStatus = 'Ansluter';
let cacheStatus = 'Inte sparad';
let penEvents = 0;
let cancellations = 0;
let maxTouches = 0;
let systemGestureBlocks = 0;
let minPressure = 1;
let maxPressure = 0;
let lastPointer: Record<string, unknown> = {};
const activeTouches = new Set<number>();
let deviceName = localStorage.getItem('cw-ipad-device-name') ?? '';
let osVersion = localStorage.getItem('cw-ipad-os-version') ?? '';
let lastTelemetry = 0;
let lastTextBlockId: string | undefined;
let writingMode: 'pen' | 'keyboard' | null = null;
let closeCanvasMenu = () => {};
const textInputs = { native: 0, editor: 0 };
const textInputEvents = {
  native: { beforeinput: 0, input: 0 },
  editor: { beforeinput: 0, input: 0 },
};
const record = (kind: string, data: Record<string, unknown> = {}) => {
  events.push({ seq: ++seq, at: new Date().toISOString(), kind, ...data });
  if (events.length > 1500) events.splice(0, events.length - 1500);
};
const base64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
};
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}?room=${encodeURIComponent(room)}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-lab-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

// The cache holds only this test document. It lets a suspended/offline tab rejoin.
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('cw-ipad-lab', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('documents');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function cache(action: 'read' | 'write', value?: Uint8Array): Promise<Uint8Array | undefined> {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', action === 'read' ? 'readonly' : 'readwrite');
    const table = tx.objectStore('documents');
    const key = `${location.host}/${room}`;
    const request = action === 'read' ? table.get(key) : table.put(value, key);
    tx.oncomplete = () => resolve(action === 'read' ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
// Handle blocked storage immediately, even before initialization reaches the cache.
dbPromise.catch(error => record('cache-error', { message: String(error) }));

function summary() {
  return {
    client, deviceName, osVersion, room, mode, writingMode, syncStatus, cacheStatus,
    diagnosticVersion: 2, textInputMetric: 'beforeinput-events', textInputs, textInputEvents,
    userAgent: navigator.userAgent, online: navigator.onLine,
    secureContext: window.isSecureContext, clipboardAPI: Boolean(navigator.clipboard),
    maxTouchPoints: navigator.maxTouchPoints,
    screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
    viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height, scale: visualViewport?.scale },
    penEvents, pressure: penEvents ? [minPressure, maxPressure] : null,
    cancellations, maxTouches, systemGestureBlocks, lastPointer,
  };
}
const snapshot = () => ({ summary: summary(), events });
async function telemetry() {
  const batch = events.filter(event => event.seq > lastTelemetry);
  try {
    await api('telemetry', { client, summary: summary(), events: batch });
    if (batch.length) lastTelemetry = batch[batch.length - 1].seq;
  } catch { /* Keep a bounded local log; sending it retries on the next tick. */ }
}

for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
  let lastMove = 0;
  $('editor').addEventListener(type, event => {
    if (event.pointerType === 'touch') {
      if (type === 'pointerdown') activeTouches.add(event.pointerId);
      if (type === 'pointerup' || type === 'pointercancel') activeTouches.delete(event.pointerId);
      maxTouches = Math.max(maxTouches, activeTouches.size);
    }
    if (event.pointerType === 'pen') {
      penEvents++;
      if (event.pressure > 0) minPressure = Math.min(minPressure, event.pressure);
      maxPressure = Math.max(maxPressure, event.pressure);
    }
    if (type === 'pointercancel') cancellations++;
    lastPointer = { type: event.pointerType, pressure: event.pressure, tiltX: event.tiltX, tiltY: event.tiltY, width: event.width, height: event.height };
    // Observe passively. Do not capture pointers, prevent default or alter gestures.
    if (type === 'pointermove' && performance.now() - lastMove < 80) return;
    lastMove = performance.now();
    record(type, { ...lastPointer, x: event.clientX, y: event.clientY, pointerId: event.pointerId });
  }, { capture: true, passive: true });
}
// Experiment, unverified on hardware: three fingers (or a palm and two fingers)
// on the screen are iPadOS's own editing gesture, which opens the system
// Undo/Cut/Copy/Paste/Redo bar over Safari's address bar. The whiteboard has no
// three-finger gesture of its own, so cancel those touches and hope WebKit then
// fails the system gesture. Pointer events (strokes, two-finger zoom) are
// dispatched before touch events and are unaffected. Each case is logged.
let threeFingerTouch = false;
for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
  window.addEventListener(type, event => {
    if (event.touches.length >= 3 && !threeFingerTouch) {
      threeFingerTouch = true;
      systemGestureBlocks++;
      record('three-finger-touch', { touches: event.touches.length, cancelable: event.cancelable });
    }
    if (threeFingerTouch && event.cancelable) event.preventDefault();
    if (event.touches.length === 0) threeFingerTouch = false;
  }, { capture: true, passive: false });
}
window.addEventListener('error', event => record('error', { message: event.message }));
window.addEventListener('unhandledrejection', event => record('error', { message: String(event.reason) }));
window.addEventListener('online', () => record('online'));
window.addEventListener('offline', () => record('offline'));
document.addEventListener('visibilitychange', () => record('visibility', { state: document.visibilityState }));
visualViewport?.addEventListener('resize', () => record('viewport', { height: visualViewport?.height, scale: visualViewport?.scale }));
const updateVisibleHeight = () => document.documentElement.style.setProperty('--lab-visible-height', `${visualViewport?.height ?? innerHeight}px`);
visualViewport?.addEventListener('resize', updateVisibleHeight);
window.addEventListener('resize', updateVisibleHeight);
updateVisibleHeight();
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--lab-toolbar-height', `${entry.target.getBoundingClientRect().height}px`);
}).observe(document.querySelector('header')!);
document.addEventListener('focusin', event => {
  const target = event.target as Element;
  const paragraph = target.closest('affine-paragraph') as (HTMLElement & { model?: { id: string } }) | null;
  if (paragraph?.model) lastTextBlockId = paragraph.model.id;
  record('focus', { tag: target.tagName, editable: (target as HTMLElement).isContentEditable });
});
for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionend'] as const) {
  document.addEventListener(type, event => {
    const target = event.target as HTMLElement;
    const surface = target.id === 'handwriting-input' ? 'native' : target.isContentEditable ? 'editor' : null;
    if (!surface) return;
    const input = event as InputEvent;
    // Model-driven editors cancel beforeinput and apply their own Yjs change,
    // so input alone misses valid editor activity. Count editing intentions
    // consistently for both surfaces, keeping raw input counts separately.
    if (type === 'beforeinput') {
      textInputs[surface]++;
      textInputEvents[surface].beforeinput++;
    } else if (type === 'input') textInputEvents[surface].input++;
    record('text-input', { surface, event: type, inputType: input.inputType, composing: input.isComposing, length: input.data?.length ?? 0 });
  }, { capture: true, passive: true });
}

$('device-name').addEventListener('change', event => {
  deviceName = (event.target as HTMLInputElement).value;
  localStorage.setItem('cw-ipad-device-name', deviceName);
});
($('device-name') as HTMLInputElement).value = deviceName;
$('os-version').addEventListener('change', event => {
  osVersion = (event.target as HTMLInputElement).value;
  localStorage.setItem('cw-ipad-os-version', osVersion);
});
($('os-version') as HTMLInputElement).value = osVersion;
$('diagnostics-toggle').onclick = () => {
  closeCanvasMenu();
  const panel = $('diagnostics');
  panel.hidden = !panel.hidden;
  $('diagnostics-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) {
    $('handwriting-panel').hidden = true;
    writingMode = null;
    for (const id of ['handwriting-toggle', 'keyboard-toggle']) {
      $(id).setAttribute('aria-expanded', 'false');
      $(id).setAttribute('aria-pressed', 'false');
    }
  }
};
for (const [id, outcome] of [['pass', 'pass'], ['fail', 'fail']]) {
  $(id).onclick = async () => {
    record('observation', {
      outcome,
      scenario: ($('scenario') as HTMLSelectElement).value,
      note: ($('observation') as HTMLTextAreaElement).value,
    });
    $('report-status').textContent = 'Observation tillagd i loggen.';
    await telemetry();
  };
}
$('download-report').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `cw-ipad-${client}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
($('monitor-link') as HTMLAnchorElement).href = `./monitor.html?${params}`;

const storeManager = new StoreExtensionManager(getInternalStoreExtensions());
const viewManager = new ViewExtensionManager(getInternalViewExtensions());
function createDocument() {
  const workspace = new TestWorkspace({ id: `ipad-lab-${room}` });
  workspace.storeExtensions = storeManager.get('store');
  workspace.meta.initialize();
  workspace.start();
  const doc = workspace.createDoc('ipad-test-document');
  return { workspace, doc, store: doc.getStore({ id: 'ipad-test-document' }) };
}
function seed() {
  const { workspace, doc, store } = createDocument();
  store.load();
  const root = store.addBlock('affine:page', { title: new Text('CW · iPad-baseline') });
  store.addBlock('affine:surface', {}, root);
  const note = store.addBlock('affine:note', { xywh: '[0, 0, 720, 360]' }, root);
  store.addBlock('affine:paragraph', { text: new Text('Skriv här. Testa markering, tangentbord och att flytta block.') }, note);
  store.addBlock('affine:paragraph', { text: new Text('På whiteboarden: välj pennverktyget och rita bredvid anteckningen.') }, note);
  const update = base64(Y.encodeStateAsUpdate(doc.spaceDoc));
  workspace.forceStop();
  workspace.dispose();
  return update;
}

async function start() {
  let cached: Uint8Array | undefined;
  try { cached = await cache('read'); } catch { cacheStatus = 'Lokal lagring ej tillgänglig'; }
  let initial: { update: string; initialized: boolean };
  try {
    initial = await api('state');
    if (!initial.initialized) initial = await api('init', { update: cached ? base64(cached) : seed() });
  } catch (error) {
    if (!cached) throw error;
    initial = { initialized: true, update: base64(cached) };
    record('offline-cache', { message: String(error) });
  }
  const { doc, store } = createDocument();
  Y.applyUpdate(doc.spaceDoc, bytes(initial.update), 'remote');
  if (cached) Y.applyUpdate(doc.spaceDoc, cached, 'cache');
  store.load();
  store.resetHistory();

  const refreshHistory = () => {
    ($('undo') as HTMLButtonElement).disabled = !store.canUndo;
    ($('redo') as HTMLButtonElement).disabled = !store.canRedo;
  };
  for (const [id, action] of [['undo', () => store.undo()], ['redo', () => store.redo()]] as const) {
    $(id).onclick = () => {
      store.captureSync();
      action();
      store.captureSync();
      refreshHistory();
      record('document-history', { action: id });
    };
  }
  doc.spaceDoc.on('afterTransaction', () => queueMicrotask(refreshHistory));
  refreshHistory();

  // A standard textarea is a control case for Safari Scribble. It neither
  // intercepts pen events nor supplies recognition of its own. Explicit commit
  // avoids moving the editor caret or replacing text during OS composition.
  const handwriting = $('handwriting-input') as HTMLTextAreaElement;
  const targets = $('handwriting-target') as HTMLSelectElement;
  let composing = false;
  type Draft = { value: string; start: number; end: number };
  const draftState = (): Draft => ({ value: handwriting.value, start: handwriting.selectionStart, end: handwriting.selectionEnd });
  let drafts: Draft[] = [draftState()];
  let draftIndex = 0;
  const updateInsert = () => {
    ($('handwriting-insert') as HTMLButtonElement).disabled = composing || !handwriting.value.trim();
    ($('draft-undo') as HTMLButtonElement).disabled = composing || draftIndex === 0;
    ($('draft-redo') as HTMLButtonElement).disabled = composing || draftIndex === drafts.length - 1;
  };
  const recordDraft = () => {
    if (!composing && handwriting.value !== drafts[draftIndex].value) {
      drafts = drafts.slice(0, draftIndex + 1);
      drafts.push(draftState());
      if (drafts.length > 100) drafts.shift();
      draftIndex = drafts.length - 1;
      $('handwriting-status').textContent = 'Texten i fältet har inte lagts till i dokumentet ännu.';
    }
    updateInsert();
  };
  for (const [id, direction] of [['draft-undo', -1], ['draft-redo', 1]] as const) {
    $(id).onclick = () => {
      if (composing) return;
      draftIndex = Math.max(0, Math.min(drafts.length - 1, draftIndex + direction));
      const state = drafts[draftIndex];
      handwriting.value = state.value;
      handwriting.setSelectionRange(state.start, state.end);
      $('handwriting-status').textContent = state.value
        ? 'Texten i fältet har inte lagts till i dokumentet ännu.'
        : 'Skriv i fältet och lägg sedan till texten i valt block.';
      updateInsert();
      record('draft-history', { action: id });
    };
  };
  const closeHandwriting = () => {
    $('handwriting-panel').hidden = true;
    writingMode = null;
    for (const id of ['handwriting-toggle', 'keyboard-toggle']) {
      $(id).setAttribute('aria-expanded', 'false');
      $(id).setAttribute('aria-pressed', 'false');
    }
    handwriting.blur();
  };
  $('handwriting-close').onclick = closeHandwriting;
  const openWriting = (input: 'pen' | 'keyboard') => {
    closeCanvasMenu();
    if ($('handwriting-panel').hidden) {
      const previous = lastTextBlockId ?? targets.value;
      targets.replaceChildren();
      store.getBlocksByFlavour('affine:paragraph').forEach(({ model }, index) => {
        targets.add(new Option(`Block ${index + 1} — ${model.text?.toString().slice(0, 45) || 'Tomt'}`, model.id));
      });
      targets.add(new Option('Nytt textblock', 'new'));
      if ([...targets.options].some(option => option.value === previous)) targets.value = previous;
    }
    writingMode = input;
    $('diagnostics').hidden = true;
    $('diagnostics-toggle').setAttribute('aria-expanded', 'false');
    $('handwriting-panel').hidden = false;
    for (const [id, selected] of [['handwriting-toggle', input === 'pen'], ['keyboard-toggle', input === 'keyboard']] as const) {
      $(id).setAttribute('aria-expanded', 'true');
      $(id).setAttribute('aria-pressed', String(selected));
    }
    $('writing-heading').textContent = input === 'pen' ? 'Handskrift till text' : 'Skriv med tangentbord';
    $('writing-instructions').textContent = input === 'pen'
      ? 'Skriv med Apple Pencil i fältet. Växla till Tangentbord när du vill fortsätta med tangenter.'
      : 'Fortsätt skriva i samma fält. Växla till Skriv med penna när du vill använda Pencil igen.';
    // Stay in the actual click gesture: Safari may not show a keyboard after
    // asynchronous focus. Do not use inputmode=none in pen mode; it could change
    // the working Scribble path. iPadOS still controls the keyboard presentation.
    if (input === 'keyboard') handwriting.focus({ preventScroll: true });
    else handwriting.blur();
    record('handwriting-open', { target: targets.value, input });
  };
  for (const [id, input] of [['handwriting-toggle', 'pen'], ['keyboard-toggle', 'keyboard']] as const) {
    ($(id) as HTMLButtonElement).disabled = false;
    $(id).onclick = () => openWriting(input);
  }
  handwriting.addEventListener('input', recordDraft);
  handwriting.addEventListener('compositionstart', () => { composing = true; updateInsert(); });
  handwriting.addEventListener('compositionend', () => { composing = false; recordDraft(); });
  $('handwriting-insert').onclick = () => {
    if (composing || !handwriting.value.trim()) return;
    const content = handwriting.value;
    const block = targets.value === 'new' ? null : store.getBlock(targets.value)?.model;
    if (targets.value !== 'new' && (!block || block.flavour !== 'affine:paragraph')) {
      $('handwriting-status').textContent = 'Textblocket finns inte kvar. Öppna panelen igen och välj ett annat.';
      return;
    }
    if (block?.text) {
      store.captureSync();
      store.transact(() => block.text!.insert(`${block.text!.length ? '\n' : ''}${content}`, block.text!.length));
      store.captureSync();
    } else {
      const note = store.getBlocksByFlavour('affine:note')[0];
      if (!note) { $('handwriting-status').textContent = 'Ingen anteckning finns att lägga texten i.'; return; }
      store.captureSync();
      store.addBlock('affine:paragraph', { text: new Text(content) }, note.id);
      store.captureSync();
    }
    record('handwriting-commit', { target: targets.value, length: content.length });
    handwriting.value = '';
    drafts = [draftState()];
    draftIndex = 0;
    updateInsert();
    $('handwriting-status').textContent = 'Texten har lagts till. Du kan skriva nästa mening eller stänga panelen.';
  };

  let menuJob = 0;
  let feedbackTimer: ReturnType<typeof setTimeout>;
  closeCanvasMenu = () => { menuJob++; $('canvas-tools-panel').hidden = true; };
  $('canvas-tools-close').onclick = closeCanvasMenu;
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCanvasMenu(); });
  const feedback = (message: string) => {
    clearTimeout(feedbackTimer);
    $('canvas-feedback').textContent = message;
    $('canvas-feedback').hidden = false;
    feedbackTimer = setTimeout(() => { $('canvas-feedback').hidden = true; }, 6000);
  };
  async function showCanvasMenu(kind: CanvasMenu, block: BlockComponent) {
    const job = ++menuJob;
    closeHandwriting();
    $('diagnostics').hidden = true;
    $('diagnostics-toggle').setAttribute('aria-expanded', 'false');
    const options = $('canvas-tools-options');
    options.replaceChildren();
    $('canvas-tools-heading').textContent = kind === 'insert' ? 'Infoga objekt' : 'Mallar';
    $('canvas-tools-help').textContent = 'Tryck för att lägga till mitt i vyn. Du behöver inte dra ut någon ikon.';
    $('canvas-tools-panel').hidden = false;
    $('canvas-tools-heading').focus({ preventScroll: true });
    const gfx = block.std.get(GfxControllerIdentifier);
    function addChoice(label: string, action: (bound: Bound) => Promise<string | boolean | null> | string | boolean | null, keepEditing = false) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = async () => {
        closeCanvasMenu();
        gfx.tool.setTool(DefaultTool);
        // At overview zoom a normal new object would be tiny. Bring this explicit
        // insertion to a usable zoom while preserving the viewport's center.
        if (gfx.viewport.zoom < 0.5) gfx.viewport.setZoom(1, undefined, false);
        const center = gfx.viewport.center;
        const bound = new Bound(center.x - 260, center.y - 80, 520, 160);
        store.captureSync();
        try {
          const id = await action(bound);
          if (id && mode === 'edgeless') {
            if (typeof id === 'string' && !keepEditing) gfx.selection.set({ elements: [id], editing: false });
            feedback(`${label} har lagts till i mitten av vyn.`);
          }
          record('canvas-insert', { choice: label, inserted: Boolean(id) });
        } catch (error) {
          feedback('Objektet kunde inte läggas till. Försök igen.');
          record('error', { message: String(error) });
        } finally { store.captureSync(); }
      };
      options.append(button);
    }
    if (kind === 'insert') {
      addChoice('Text', bound => textRender(bound, block), true);
      addChoice('Tankekarta', bound => getMindmapRender(block.std.get(EditPropsStore).lastProps$.value.mindmap.style)(bound, block));
      addChoice('Bild eller fil', bound => mediaRender(bound, block));
    } else {
      options.textContent = 'Läser mallar…';
      try {
        const categories = await EdgelessTemplatePanel.templates.categories();
        const templates = (await Promise.all(categories.map(category => EdgelessTemplatePanel.templates.list(category)))).flat();
        if (job !== menuJob) return;
        options.replaceChildren();
        if (!templates.length) {
          const empty = document.createElement('p');
          empty.textContent = 'Inga mallar är laddade i den här testvyn. Text, tankekarta och former finns i de andra menyerna.';
          options.append(empty);
        }
        for (const template of templates) {
          addChoice(template.name || 'Namnlös mall', async () => {
            const copy = structuredClone(template) as Template;
            const task = createTemplateJob(block.std, copy.type, gfx.viewport.center);
            if (copy.assets) await Promise.all(Object.entries(copy.assets).map(async ([key, url]) => {
              const response = await fetch(url);
              if (!response.ok) throw new Error(`Template asset HTTP ${response.status}`);
              task.job.assets.set(key, await response.blob());
            }));
            const inserted = await task.insertTemplate(copy.content);
            if (!inserted) throw new Error('Template contained no insertable content');
            if (copy.type === 'template') gfx.viewport.setViewportByBound(inserted, [40, 40, 40, 40], false);
            return true;
          });
        }
      } catch (error) {
        if (job === menuJob) options.textContent = 'Mallar kunde inte läsas. Försök igen.';
        record('error', { message: String(error) });
      }
    }
    record('canvas-menu', { kind });
  }

  // Canvas diagnostics. On iPad, selected canvas elements have been seen to
  // vanish while the same document renders fully in Safari on Mac and in an
  // emulated iPad in Chromium. Record what the renderer believes it drew next
  // to what each canvas actually holds, so a blank layer can be told apart
  // from an element the renderer skipped.
  type DebugRenderer = {
    usePlaceholder?: boolean;
    stackingCanvasesAttached?: boolean;
    getDebugMetrics?: () => Record<string, unknown>;
  };
  function canvasState() {
    const renderer = (document.querySelector('affine-surface') as (Element & { renderer?: DebugRenderer }) | null)?.renderer;
    const metrics = renderer?.getDebugMetrics?.() ?? {};
    const gfx = std?.get(GfxControllerIdentifier);
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('affine-edgeless-root canvas')].map(canvas => {
      let painted: number | string = 'unread';
      try {
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width && canvas.height) {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          painted = 0;
          for (let i = 3; i < data.length; i += 4 * 37) if (data[i]) painted++;
        }
      } catch (error) { painted = String(error); }
      const style = getComputedStyle(canvas);
      return {
        layer: canvas.dataset.layerId || 'main', width: canvas.width, height: canvas.height,
        connected: canvas.isConnected, display: style.display, visibility: style.visibility,
        zIndex: style.zIndex, transform: canvas.style.transform, painted,
      };
    });
    // What the main canvas holds, downscaled, and what sits on top of each
    // selected element: tells a missing drawing from a covered or stale layer.
    let image: string | undefined;
    const main = document.querySelector<HTMLCanvasElement>('affine-edgeless-root canvas:not([data-layer-id])')
      ?? document.querySelector<HTMLCanvasElement>('affine-edgeless-root canvas');
    if (main?.width && gfx?.selection.selectedIds.length) {
      try {
        const small = document.createElement('canvas');
        small.width = 480;
        small.height = Math.round(480 * main.height / main.width);
        small.getContext('2d')!.drawImage(main, 0, 0, small.width, small.height);
        image = small.toDataURL('image/png');
      } catch (error) { image = String(error); }
    }
    const covering = (gfx?.selection.selectedElements ?? []).slice(0, 8).map(model => {
      const [x, y] = gfx!.viewport.toViewCoord(model.elementBound.center[0], model.elementBound.center[1]);
      const stack = document.elementsFromPoint(x + gfx!.viewport.left, y + gfx!.viewport.top)
        .slice(0, 4).map(element => `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.split(' ')[0] : ''}`);
      return { type: 'type' in model ? model.type : model.flavour, stack };
    });
    return {
      image, covering,
      zoom: gfx?.viewport.zoom, viewport: [gfx?.viewport.width, gfx?.viewport.height],
      selected: gfx?.selection.selectedIds.length ?? 0,
      placeholder: renderer?.usePlaceholder, stackingAttached: renderer?.stackingCanvasesAttached,
      memoryMB: metrics.canvasMemoryMegabytes, stackingCount: metrics.stackingCanvasCount,
      lastRender: metrics.lastRenderMetrics, canvases,
    };
  }
  let canvasStateTimer: ReturnType<typeof setTimeout> | undefined;
  let selectionWatch: { unsubscribe(): void } | undefined;

  function mount(nextMode: 'page' | 'edgeless') {
    closeCanvasMenu();
    selectionWatch?.unsubscribe();
    selectionWatch = undefined;
    if (std) { render(null, $('editor')); std.unmount(); }
    mode = nextMode;
    $('editor').dataset.mode = mode;
    $('editor').classList.toggle('affine-edgeless-viewport', mode === 'edgeless');
    std = new BlockStdScope({ store, extensions: [
      ...viewManager.get(mode), FontConfigExtension(CommunityCanvasTextFonts),
      ...(mode === 'edgeless' ? [touchToolbar((kind, block) => { void showCanvasMenu(kind, block); })] : []),
    ] });
    render(std.render(), $('editor'));
    $('page-mode').setAttribute('aria-pressed', String(mode === 'page'));
    $('canvas-mode').setAttribute('aria-pressed', String(mode === 'edgeless'));
    record('mode', { mode });
    if (mode === 'edgeless') {
      selectionWatch = std.get(GfxControllerIdentifier).selection.slots.updated.subscribe(() => {
        clearTimeout(canvasStateTimer);
        canvasStateTimer = setTimeout(() => record('canvas-state', canvasState()), 500);
      });
    }
  }
  $('page-mode').onclick = () => mount('page');
  $('canvas-mode').onclick = () => mount('edgeless');
  mount(params.get('mode') === 'page' ? 'page' : 'edgeless');

  let needsCache = true;
  let localRevision = 0;
  doc.spaceDoc.on('update', (_update, origin) => {
    needsCache = true;
    cacheStatus = 'Sparar lokalt';
    if (origin !== 'remote') {
      localRevision++;
      syncStatus = 'Väntar på synk';
      $('sync-status').textContent = syncStatus;
    }
  });
  let writingCache = false;
  setInterval(async () => {
    if (!needsCache || writingCache) return;
    writingCache = true;
    needsCache = false;
    try {
      await cache('write', Y.encodeStateAsUpdate(doc.spaceDoc));
      cacheStatus = needsCache ? 'Sparar lokalt' : 'Sparad lokalt';
    } catch { cacheStatus = 'Lokal lagring ej tillgänglig'; }
    finally { writingCache = false; }
  }, 500);
  // Exchange state vectors rather than an optimistic outbox: after failures and
  // concurrent writes, missing updates are retried without dropping edits.
  async function sync() {
    try {
      const remote = await api('vector');
      const update = Y.encodeStateAsUpdate(doc.spaceDoc, bytes(remote.vector));
      const sentRevision = localRevision;
      const result = await api('sync', { update: base64(update), vector: base64(Y.encodeStateVector(doc.spaceDoc)) });
      Y.applyUpdate(doc.spaceDoc, bytes(result.update), 'remote');
      syncStatus = sentRevision === localRevision ? 'Synkad' : 'Väntar på synk';
    } catch (error) {
      if (syncStatus !== 'Återansluter') record('sync-error', { message: String(error) });
      syncStatus = 'Återansluter';
    }
    $('sync-status').textContent = syncStatus;
    setTimeout(sync, 500);
  }
  void sync();
  // A small read/write probe for meaningful browser checks; not production API.
  Object.assign(window, { ipadLab: {
    summary, snapshot, canvasState,
    paragraphs: () => store.getBlocksByFlavour('affine:note')[0].model.children.filter(block => block.flavour === 'affine:paragraph').map(block => block.text?.toString()),
    append: (text: string) => store.addBlock('affine:paragraph', { text: new Text(text) }, store.getBlocksByFlavour('affine:note')[0].id),
    canvasElements: () => std.get(GfxControllerIdentifier).surface?.elementModels.length ?? 0,
    canvasKinds: () => std.get(GfxControllerIdentifier).surface?.elementModels.map(element => element.type) ?? [],
    ready: true,
  } });
  record('ready');
}
setInterval(() => {
  if (!$('diagnostics').hidden) $('live-diagnostics').textContent = JSON.stringify(summary(), null, 2);
  void telemetry();
}, 2000);
start().catch(error => {
  record('error', { message: String(error) });
  $('sync-status').textContent = 'Kunde inte starta';
  $('editor').textContent = `Kunde inte öppna testdokumentet: ${error}. Öppna hela testlänken från Macens terminal.`;
});
