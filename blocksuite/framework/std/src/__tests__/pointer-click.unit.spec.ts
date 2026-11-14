import {
  createAutoIncrementIdGenerator,
  TestWorkspace,
} from '@blocksuite/store/test';
import { afterEach, describe, expect, test } from 'vitest';

import { effects } from '../effects.js';
import { TestEditorContainer } from './test-editor.js';
import { RootBlockSchemaExtension } from './test-schema.js';
import { testSpecs } from './test-spec.js';

effects();

let container: TestEditorContainer | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

const setup = async () => {
  const collection = new TestWorkspace({
    id: 'test-collection',
    idGenerator: createAutoIncrementIdGenerator(),
  });
  collection.meta.initialize();
  const doc = collection.createDoc('home');
  const store = doc.getStore({ extensions: [RootBlockSchemaExtension] });
  doc.load();
  store.addBlock('test:page');

  container = new TestEditorContainer();
  container.doc = store;
  container.specs = testSpecs;
  document.body.append(container);
  await container.updateComplete;

  const { event, host } = container.std;
  event.active = true;
  const received: string[] = [];
  for (const name of ['click', 'doubleClick'] as const) {
    event.add(name, () => {
      received.push(name);
    });
  }

  const tap = (pointerType: string, pointerId: number, x: number, upX = x) => {
    const init = (clientX: number) => ({
      pointerType,
      pointerId,
      isPrimary: true,
      clientX,
      clientY: 20,
      bubbles: true,
      composed: true,
    });
    host.dispatchEvent(new PointerEvent('pointerdown', init(x)));
    host.dispatchEvent(new PointerEvent('pointerup', init(upX)));
  };

  return { tap, received };
};

// Distances follow taps measured on an iPad Pro with Apple Pencil Pro.
describe('click controller', () => {
  test.each([
    ['pen', 14],
    ['touch', 26],
  ])(
    'two %s contacts with new pointer ids %ipx apart form a double tap',
    async (pointerType, apart) => {
      const { tap, received } = await setup();

      tap(pointerType, 11, 20);
      tap(pointerType, 12, 20 + apart);

      expect(received).toEqual(['click', 'click', 'doubleClick']);
    }
  );

  test.each([
    ['pen', 25],
    ['touch', 45],
  ])(
    '%s contacts %ipx apart stay single taps',
    async (pointerType, apart) => {
      const { tap, received } = await setup();

      tap(pointerType, 11, 20);
      tap(pointerType, 12, 20 + apart);

      expect(received).toEqual(['click', 'click']);
    }
  );

  test('a pen tap that travels a few pixels still counts', async () => {
    const { tap, received } = await setup();

    tap('pen', 11, 20, 24);
    tap('pen', 12, 22, 27);
    tap('pen', 13, 20, 40);

    expect(received).toEqual(['click', 'click', 'doubleClick']);
  });

  test('different kinds of pointer do not combine', async () => {
    const { tap, received } = await setup();

    tap('touch', 11, 20);
    tap('pen', 12, 20);

    expect(received).toEqual(['click', 'click']);
  });

  test('mouse keeps the exact pointer and 2px slop', async () => {
    const { tap, received } = await setup();

    tap('mouse', 1, 20);
    tap('mouse', 1, 27);
    expect(received).toEqual(['click', 'click']);

    received.length = 0;
    tap('mouse', 1, 27);
    expect(received).toEqual(['click', 'doubleClick']);

    received.length = 0;
    tap('mouse', 1, 40, 44);
    expect(received).toEqual([]);
  });
});
