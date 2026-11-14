import { describe, expect, test, vi } from 'vitest';

import type { PointerEventState } from '../../event/index.js';
import type { GfxController } from '../../gfx/controller.js';
import { GfxViewEventManager } from '../../gfx/interactivity/gfx-view-event-handler.js';

// A 100x40 element at (200, 100) in a viewport mapped 1:1 to model space.
const createManager = () => {
  const view = { dispatch: vi.fn(() => true) };
  const model = {
    includesPoint: (x: number, y: number) =>
      x >= 200 && x <= 300 && y >= 100 && y <= 140,
  };
  const gfx = {
    viewport: { toModelCoord: (x: number, y: number) => [x, y] },
    grid: { search: () => [model] },
    view: { get: () => view },
    std: { host: document.body },
  } as unknown as GfxController;

  return { manager: new GfxViewEventManager(gfx), view };
};

const pointer = (pointerType: string, x: number, y: number) =>
  ({ x, y, raw: { pointerType } }) as unknown as PointerEventState;

const dispatched = (view: { dispatch: ReturnType<typeof vi.fn> }) =>
  view.dispatch.mock.calls.map(([name]) => name);

describe('GfxViewEventManager', () => {
  test.each(['touch', 'pen'])(
    'a %s double tap without prior hover reaches the element under it',
    pointerType => {
      const { manager, view } = createManager();
      const tap = pointer(pointerType, 250, 120);

      for (const name of ['pointerdown', 'click', 'pointerdown'] as const) {
        manager.dispatch(name, tap);
      }
      expect(manager.dispatch('dblclick', tap)).toBe(true);
      expect(dispatched(view)).toEqual([
        'pointerenter',
        'pointerdown',
        'click',
        'pointerdown',
        'dblclick',
      ]);
    }
  );

  test('a touch contact elsewhere replaces a stale hovered element', () => {
    const { manager, view } = createManager();

    manager.dispatch('pointerdown', pointer('touch', 250, 120));
    manager.dispatch('pointerdown', pointer('touch', 20, 20));

    expect(manager.dispatch('dblclick', pointer('touch', 20, 20))).toBe(
      undefined
    );
    expect(dispatched(view)).toEqual([
      'pointerenter',
      'pointerdown',
      'pointerleave',
    ]);
  });

  test('mouse input still relies on the hover stack', () => {
    const { manager, view } = createManager();
    const click = pointer('mouse', 250, 120);

    manager.dispatch('pointerdown', click);
    expect(manager.dispatch('dblclick', click)).toBe(undefined);
    expect(view.dispatch).not.toHaveBeenCalled();

    manager.dispatch('pointermove', click);
    expect(manager.dispatch('dblclick', click)).toBe(true);
    expect(dispatched(view)).toEqual(['pointerenter', 'dblclick']);
  });
});
