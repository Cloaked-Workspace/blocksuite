# Fork patches applied to the imported AFFiNE subtree

The `blocksuite/` tree was imported unchanged from AFFiNE commit
`00576e1e7842fb63095cdc5d7a236321957b550c`, subtree SHA
`d0e6e70bfa88943c79dd5608ff3556e9aafb1783`. The patches below are applied on
top of that import, so the built tree is
`b699c53e343224f4c71a9dbf10884e85fc7b477d`.

Reviewing the import mechanically therefore takes two steps rather than one:
verify `d0e6e70b…` against upstream, then review the six commits listed here.
Nothing else in `blocksuite/` deviates.

`scripts/build-cw-packages.mjs` refuses to build unless the tree matches the
patched SHA exactly, and `inventory.json` records both SHAs.

## `cf644440ab60b6d3f674ed57cfa88014f6b35429` — bound the polynomial regexes

Addresses the three CodeQL polynomial-ReDoS findings. Each is only pathological
on input no real document produces, so the patches bound the work instead of
restructuring the code. Matches are identical on realistic input.

| File | Change |
|---|---|
| `affine/shared/src/utils/url.ts` | trailing-delimiter run bounded to 32 |
| `affine/shared/src/adapters/pdf/css-utils.ts` | `var(` match anchored to offset 0 |
| `affine/inlines/footnote/src/adapters/markdown/preprocessor.ts` | leading token bounded, label to 128 |

Worst case measured on Node 22.23.1, before and after: 10 174 ms → 0.0 ms,
45 637 ms → 1.1 ms, and 2 548 ms → 93.7 ms respectively. All three now scale
linearly.

## `eb61b3443730cb97f61eff4a301084fbe2b30cd6` — raise the footnote bound to 2048

The leading bound applies to the token before the reference, which is the URL
this preprocessor exists to handle. 512 truncated real URLs carrying query and
tracking parameters. Cost is linear in the bound, so the adversarial 80k-token
case moves from 93 ms to 384 ms — still far from a freeze.

The other two bounds are deliberately left low. `url.ts`'s 32 covers the
delimiters *after* a URL rather than the URL itself, and raising it to 512 costs
100x for no reachable gain; 128 is a footnote label.

## `1ac84f9b0d2480c017d13977800606d4f3b0467f` — align the console whitelists

Every imported vitest config turns unexpected console output into a thrown
error, but they whitelist different messages, so three configs failed on CI
with all of their tests passing.

| File | Change |
|---|---|
| `affine/shared/vitest.config.ts` | allow the KaTeX quirks-mode warning |
| `affine/gfx/group/vitest.config.ts` | allow the KaTeX quirks-mode warning |
| `affine/gfx/pointer/vitest.config.ts` | allow the KaTeX quirks-mode warning |
| `affine/all/vitest.config.ts` | allow MSW's redundant query-parameter notice and the `nonexistent-blob-id` lookup |

## `f41192bbe129fe33bb9a1844a1eee76f8d918343` — drop the React icon re-export

`affine/components/src/icons/index.ts` re-exported `./file-icons-rc`, which
imports `@blocksuite/icons/rc` and so `react/jsx-runtime`. Thirty-six modules
import that barrel and the view extensions reach it, so every consumer needed
React installed to bundle the editor at all. No distribution package declares
`react`; the monorepo's root manifest carries it as a development dependency,
which is why the edge always resolved here and failed only outside.

The re-exported module contributes one symbol, `getAttachmentFileIconRC`, used
nowhere in the tree — it exists for AFFiNE's React application. The patch drops
the re-export and adds an opt-in `./icons/rc` export entry, so the capability
survives and only a consumer that asks for it pulls React.

| File | Change |
|---|---|
| `affine/components/src/icons/index.ts` | drop `export * from './file-icons-rc'` |
| `affine/components/package.json` | add the `./icons/rc` export entry |

`yarn verify:consumer:app` covers the result: the proof application declares no
React and mounts an editor.

## `66ed6f6128bdac68cc07341f490feba1335849d6` — make whiteboard taps work with touch and Apple Pencil

Found with the iPad lab (`scripts/ipad-lab/`) on an iPad Pro 11-inch M4 with
Apple Pencil Pro. Mouse input behaves exactly as before.

| File | Change |
|---|---|
| `framework/std/src/event/control/pointer.ts` | group touch and pen contacts into double taps by kind, within 16px (pen) or 32px (touch) instead of by `pointerId` and 2px; a contact that travels up to 10px still counts as a click |
| `framework/std/src/gfx/interactivity/gfx-view-event-handler.ts` | hit-test at a touch or pen `pointerdown`, since the hover stack only follows `pointermove` |
| `affine/gfx/shape/src/text/edgeless-shape-text-editor.ts` | after a touch or pen press, Enter inserts a line break in a mind map node |
| `affine/gfx/shape/src/element-view.ts` | start recording the last press kind per editor host |
| `affine/gfx/shape/src/draggable/shape-menu.ts` | on coarse pointers, name each shape and frame the chosen one |
| `framework/std/src/__tests__/pointer-click.unit.spec.ts` | new: double-tap grouping for touch, pen and mouse |
| `framework/std/src/__tests__/gfx/view-event.unit.spec.ts` | new: touch and pen taps reach the element without hover |

Tap distances come from the lab's device reports: Pencil taps travel a median
2.2px between down and up, and finger double taps land up to 26px apart.

## `d1c35de405dc4f1bb23854ceab4e4bdc569f46f6` — stop iPad Safari losing whiteboard content

| File | Change |
|---|---|
| `affine/blocks/surface/src/renderer/canvas-renderer.ts` | re-attach stacking canvases when a pan ends; draw every layer on the main canvas while they are detached; redraw the main canvas whenever a render resizes it |
| `affine/gfx/shape/src/element-renderer/shape/index.ts` | let a shape's text line borrow half the horizontal padding before wrapping |

On iOS below 50% zoom a pan detaches the stacking canvases, and only the end
of a zoom re-attached them; the next render, typically a selection, then left
everything invisible. Reproduced in Chromium with iPad Safari's user agent,
`navigator.vendor` and touch points. Text wrapping differs because Safari
measures a line slightly wider than the Chromium that sized the shape.

## Upstream status

All six patches are candidates to propose upstream, which would remove the need
to carry them. Nothing has been submitted. AFFiNE's `SECURITY.md` declines
AI-generated security reports, so any submission must be authored and verified
by a maintainer of this fork.
