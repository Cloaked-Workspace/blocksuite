/**
 * Pins the runtime results of the zod schemas whose behaviour differs between
 * zod 3 and zod 4: `.default()` on objects, the deep-optional editor props,
 * the intersected inline-attribute schema, function-valued option fields and
 * the data-view value validators.
 *
 * Written and snapshotted on zod 3 before the fork moved to zod 4, and kept
 * unchanged across that move, so "no behaviour change" is measured rather
 * than read off the changelog.
 */
import { ParagraphViewExtension } from '@blocksuite/affine-block-paragraph/view';
import { InlineCommentViewExtension } from '@blocksuite/affine-inline-comment/view';
import { DefaultInlineManagerExtension } from '@blocksuite/affine-inline-preset';
import { NoteBlockSchema } from '@blocksuite/affine-model';
import { GeneralSettingSchema } from '@blocksuite/affine-shared/services';
import type { AffineTextAttributes } from '@blocksuite/affine-shared/types';
import { makeDeepOptional, NodePropsSchema } from '@blocksuite/affine-shared/utils';
import { LinkedDocViewExtension } from '@blocksuite/affine-widget-linked-doc/view';
import { t } from '@blocksuite/data-view';
import { Container, type ServiceIdentifier } from '@blocksuite/global/di';
import { StdIdentifier } from '@blocksuite/std';
import { dynamicSchema, type InlineManager } from '@blocksuite/std/inline';
import {
  baseTextAttributes,
  BlockSchema,
  type ExtensionType,
} from '@blocksuite/store';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  CodeBlockInlineManagerExtension,
  CodeBlockUnitSpecExtension,
} from '../../../blocks/code/src/code-block-inline.js';
import { LatexEditorUnitSpecExtension } from '../../../inlines/latex/src/inline-spec.js';
import { LatexEditorInlineManagerExtension } from '../../../inlines/latex/src/latex-node/latex-editor-menu.js';
import { defaultInlineSpecExtensions } from './utils/inline-specs';

// Resolves an inline manager the way the editor does, with a stand-in std:
// building the attribute schema only reads the specs.
function inlineSchema(
  manager: ExtensionType & {
    identifier: ServiceIdentifier<InlineManager<AffineTextAttributes>>;
  },
  specs: ExtensionType[]
) {
  const container = new Container();
  container.addImpl(StdIdentifier, () => ({}) as never);
  for (const extension of [...specs, manager]) {
    extension.setup(container);
  }
  return container.provider().get(manager.identifier).getSchema();
}

describe('edgeless props defaults', () => {
  const keys = Object.keys(NodePropsSchema.shape) as Array<
    keyof typeof NodePropsSchema.shape
  >;

  test('each key parses undefined to its default', () => {
    const defaults = Object.fromEntries(
      keys.map(key => [key, NodePropsSchema.shape[key].parse(undefined)])
    );
    expect(defaults).toMatchSnapshot();
  });

  test('the assembled defaults round-trip through the full schema', () => {
    const defaults = Object.fromEntries(
      keys.map(key => [key, NodePropsSchema.shape[key].parse(undefined)])
    );
    expect(NodePropsSchema.parse(defaults)).toEqual(defaults);
  });

  test('an empty editor setting parses to every default', () => {
    expect(GeneralSettingSchema.parse({})).toMatchSnapshot();
  });
});

describe('deep-optional edgeless props', () => {
  const optional = makeDeepOptional(NodePropsSchema);

  test('an empty object stays empty', () => {
    expect(optional.parse({})).toEqual({});
    expect(optional.parse(undefined)).toBeUndefined();
  });

  test('a partial update keeps only what was given', () => {
    expect(
      optional.parse({
        connector: { stroke: '#ff0000', labelStyle: { fontSize: 20 } },
        'shape:rect': { filled: false },
        'affine:note': { edgeless: { style: { borderSize: 2 } } },
        unknown: { whatever: true },
      })
    ).toMatchSnapshot();
  });

  test('a wrong type is still rejected', () => {
    expect(() => optional.parse({ brush: { lineWidth: 'wide' } })).toThrow();
  });
});

describe('inline text attributes', () => {
  const schema = inlineSchema(
    DefaultInlineManagerExtension,
    defaultInlineSpecExtensions
  );

  test('known attributes survive and unknown ones are dropped', () => {
    const result = schema.safeParse({
      bold: true,
      italic: true,
      link: 'https://example.com/',
      color: 'var(--affine-text-highlight-foreground-red)',
      latex: 'x^2',
      reference: { type: 'LinkedPage', pageId: 'page-1' },
      'comment-abc': true,
      'comment-def': false,
      notAnAttribute: 1,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchSnapshot();
  });

  test('invalid values fall back to undefined instead of failing', () => {
    const result = schema.safeParse({
      bold: false,
      code: 'yes',
      link: 42,
      reference: { type: 'Nonsense' },
      'comment-abc': 'resolved',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchSnapshot();
  });

  test('base attributes alone behave the same', () => {
    expect(
      baseTextAttributes.parse({ bold: true, strike: null, other: 1 })
    ).toMatchSnapshot();
  });

  test('the code block accepts attributes without its unit marker', () => {
    const codeBlock = inlineSchema(CodeBlockInlineManagerExtension, [
      ...defaultInlineSpecExtensions,
      CodeBlockUnitSpecExtension,
    ]);
    expect(codeBlock.safeParse({}).success).toBe(true);
    expect(codeBlock.safeParse({ bold: true }).data).toMatchSnapshot();
  });

  test('the latex editor accepts attributes without its unit marker', () => {
    const latexEditor = inlineSchema(LatexEditorInlineManagerExtension, [
      LatexEditorUnitSpecExtension,
    ]);
    expect(latexEditor.safeParse({}).success).toBe(true);
  });

  test('a dynamic schema keeps matching keys only', () => {
    const comments = dynamicSchema(
      (key): key is `c-${string}` => key.startsWith('c-'),
      z.boolean()
    );
    expect(comments.parse({ 'c-1': true, other: true })).toEqual({
      'c-1': true,
    });
    expect(comments.parse('not a record')).toEqual({});
    expect(() => comments.parse({ 'c-1': 'yes' })).toThrow();
  });
});

describe('block schema validation', () => {
  test('a real block schema is accepted', () => {
    expect(() => BlockSchema.parse(NoteBlockSchema)).not.toThrow();
  });

  test('a block schema whose props is not a function is rejected', () => {
    expect(() =>
      BlockSchema.parse({
        ...NoteBlockSchema,
        model: { ...NoteBlockSchema.model, props: 'not a function' },
      })
    ).toThrow();
  });

  test('a block schema with a transformer function is accepted', () => {
    expect(() =>
      BlockSchema.parse({ ...NoteBlockSchema, transformer: () => ({}) })
    ).not.toThrow();
  });
});

describe('view extension options', () => {
  test('a function option is accepted and a non-function is rejected', () => {
    const paragraph = new ParagraphViewExtension();
    expect(() =>
      paragraph.schema.parse({ getPlaceholder: () => 'text' })
    ).not.toThrow();
    expect(() =>
      paragraph.schema.parse({ getPlaceholder: 'text' })
    ).toThrow();
  });

  test('nested function options are checked as functions', () => {
    const linkedDoc = new LinkedDocViewExtension();
    expect(() =>
      linkedDoc.schema.parse({
        triggerKeys: ['@', '['],
        getMenus: () => [],
        mobile: { scrollTopOffset: () => 0 },
      })
    ).not.toThrow();
    expect(() =>
      linkedDoc.schema.parse({ mobile: { scrollTopOffset: 'top' } })
    ).toThrow();
  });

  test('an option default applies when the option is omitted', () => {
    expect(new InlineCommentViewExtension().schema.parse({})).toEqual({
      enabled: true,
    });
  });
});

describe('data-view value validation', () => {
  test('data types accept their own values only', () => {
    expect(t.number.instance().valueValidate(1)).toBe(true);
    expect(t.number.instance().valueValidate('1')).toBe(false);
    // A tag's value is the selected option's id; its options are type data.
    expect(t.tag.instance().valueValidate('option-id')).toBe(true);
    expect(t.tag.instance().valueValidate(1)).toBe(false);
  });

  test('composite types validate arrays and functions', () => {
    const numbers = t.array.instance(t.number.instance());
    expect(numbers.valueValidate([1, 2])).toBe(true);
    expect(numbers.valueValidate([1, '2'])).toBe(false);
    const fn = t.fn.instance([t.number.instance()], t.number.instance());
    expect(fn.valueValidate((value: number) => value)).toBe(true);
    expect(fn.valueValidate(1)).toBe(false);
  });
});
