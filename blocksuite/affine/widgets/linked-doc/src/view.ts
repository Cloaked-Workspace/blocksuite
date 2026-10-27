import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import type { AffineInlineEditor } from '@blocksuite/affine-shared/types';
import type { EditorHost } from '@blocksuite/std';
import { z } from 'zod';

import { type LinkedMenuGroup, LinkedWidgetConfigExtension } from './config';
import { effects } from './effects';
import { linkedDocWidget } from './widget';

// zod 4's `z.function()` is a function factory rather than a schema; the
// options were only ever checked for being functions.
const functionSchema = <Fn extends (...args: never[]) => unknown>() =>
  z.custom<Fn>(value => typeof value === 'function');

const optionsSchema = z.object({
  triggerKeys: z.optional(z.tuple([z.string()]).rest(z.string())),
  convertTriggerKey: z.boolean().optional(),
  ignoreBlockTypes: z.array(z.string()).optional(),
  ignoreSelector: z.string().optional(),
  getMenus: z.optional(
    functionSchema<
      (
        query: string,
        abort: () => void,
        editorHost: EditorHost,
        inlineEditor: AffineInlineEditor,
        abortSignal: AbortSignal
      ) => Promise<LinkedMenuGroup[]> | LinkedMenuGroup[]
    >()
  ),

  autoFocusedItemKey: z.optional(
    functionSchema<
      (
        menus: LinkedMenuGroup[],
        query: string,
        currentActiveKey: string | null,
        editorHost: EditorHost,
        inlineEditor: AffineInlineEditor
      ) => string | null
    >()
  ),

  mobile: z
    .object({
      scrollContainer: z.optional(
        z.union([z.string(), z.instanceof(HTMLElement), z.custom<Window>()])
      ),
      scrollTopOffset: z.optional(
        z.union([z.number(), functionSchema<() => number>()])
      ),
    })
    .optional(),
});

export type LinkedDocViewExtensionOptions = z.infer<typeof optionsSchema>;

export class LinkedDocViewExtension extends ViewExtensionProvider<LinkedDocViewExtensionOptions> {
  override name = 'affine-linked-doc-widget';

  override schema = optionsSchema;

  override effect() {
    super.effect();
    effects();
  }

  override setup(
    context: ViewExtensionContext,
    options?: LinkedDocViewExtensionOptions
  ) {
    super.setup(context);
    context.register(linkedDocWidget);
    if (options) {
      context.register(LinkedWidgetConfigExtension(options));
    }
  }
}
