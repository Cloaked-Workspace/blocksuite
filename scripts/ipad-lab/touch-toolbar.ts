import { SeniorToolIdentifier, type SeniorTool, type ToolBuilder } from '@blocksuite/affine-widget-edgeless-toolbar';
import type { BlockComponent } from '@blocksuite/affine/std';
import type { ExtensionType } from '@blocksuite/affine/store';
import { html } from 'lit';

export type CanvasMenu = 'insert' | 'template';

// Override only the host's ambiguous insertion and template entries through the
// toolbar's extension API. The native shape tool stays: it shows each shape,
// its style, and lets the user draw a shape at the intended size and place.
// Imported toolbar source and quick tools stay intact.
export function touchToolbar(open: (kind: CanvasMenu, block: BlockComponent) => void): ExtensionType {
  return {
    setup(di) {
      for (const [id, kind, label, hint, accessible] of [
        ['mindMap', 'insert', 'Infoga', 'Text, bild…', 'Infoga objekt'],
        ['template', 'template', 'Mallar', 'Färdiga upplägg', 'Mallar'],
      ] as const) {
        const builder: ToolBuilder<SeniorTool> = ({ block }) => ({
          name: label,
          content: html`<button
            type="button" aria-label=${accessible} aria-haspopup="dialog"
            style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:90px;min-height:48px;padding:5px;border:1px solid var(--affine-border-color,#becbc5);border-radius:9px;background:var(--affine-background-primary-color,#fff);color:var(--affine-text-primary-color,#172c2b);font:600 14px system-ui;cursor:pointer;touch-action:manipulation"
            @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
            @click=${(event: MouseEvent) => { event.stopPropagation(); open(kind, block); }}
          >
            <span>${label} ▾</span>
            <span style="font-size:10px;font-weight:400">${hint}</span>
          </button>`,
        });
        di.override(SeniorToolIdentifier(id), () => builder);
      }
    },
  };
}
