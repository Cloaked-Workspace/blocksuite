# Fork patches applied to the imported AFFiNE subtree

The `blocksuite/` tree was imported unchanged from AFFiNE commit
`b4c8548c09da21b2898443559a5b846f0ccf5dd8` (tag `v0.27.4`), subtree SHA
`044535822a52dc3134ef70d994901828db35c1ac`. The patches below are applied on
top of that import, so the built tree is
`42b6cdabcbc58cffd358d7dc129171fd9739f67d`.

Reviewing the import mechanically therefore takes two steps rather than one:
verify `04453582…` against upstream, then review the five commits listed here.
Nothing else in `blocksuite/` deviates.

`scripts/build-cw-packages.mjs` refuses to build unless the tree matches the
patched SHA exactly, and `inventory.json` records both SHAs.

## `9d5fc7a2b395d68848af3cfd6d77238b27832653` — bound the polynomial regexes

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

## `f8ba0cb247d8023c8b6f3893ed25158641b64906` — raise the footnote bound to 2048

The leading bound applies to the token before the reference, which is the URL
this preprocessor exists to handle. 512 truncated real URLs carrying query and
tracking parameters. Cost is linear in the bound, so the adversarial 80k-token
case moves from 93 ms to 384 ms — still far from a freeze.

The other two bounds are deliberately left low. `url.ts`'s 32 covers the
delimiters *after* a URL rather than the URL itself, and raising it to 512 costs
100x for no reachable gain; 128 is a footnote label.

## `7e5a6f433259d244c0da9db4ecbca011f60eea1b` — align the console whitelists

Every imported vitest config turns unexpected console output into a thrown
error, but they whitelist different messages, so three configs failed on CI
with all of their tests passing.

| File | Change |
|---|---|
| `affine/shared/vitest.config.ts` | allow the KaTeX quirks-mode warning |
| `affine/gfx/group/vitest.config.ts` | allow the KaTeX quirks-mode warning |
| `affine/gfx/pointer/vitest.config.ts` | allow the KaTeX quirks-mode warning |
| `affine/all/vitest.config.ts` | allow MSW's redundant query-parameter notice and the `nonexistent-blob-id` lookup |

## `c2c50a59d948bf60ef1561731798def52e7f810e` — drop the React icon re-export

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

## `28fb823b7b219780b0a8241e6a5d4aecb2fcfeb5` — pin the drag-and-drop plugins

v0.27.4 moved `@blocksuite/std` to the 2.x drag-and-drop core but declared its
plugins with open ranges whose newest releases require a different core:
auto-scroll `^3.0.0` resolves to 3.2.1, which needs core `^4.0.0`, and hitbox
`^2.0.0` resolves to 2.2.2, which needs core `^3.1.0`. A fresh install therefore
holds three cores. The core keeps its drag registry in module state, so the
auto-scroll monitor watches a core no drag ever starts in and never scrolls.

AFFiNE cannot see this: its root `resolutions` force every copy to a patched
1.4.0. That override does not reach a consumer of the published manifests.

The patch pins both plugins to the last releases on core `^2.0.0`, which are
also the versions AFFiNE's own v0.27.4 lockfile records. A fresh install of the
published ranges resolves one core, 2.0.2.

| File | Change |
|---|---|
| `framework/std/package.json` | auto-scroll `^3.0.0` → `3.0.0`, hitbox `^2.0.0` → `2.0.0` |

The pins should be lifted together, to a plugin pair that shares a core, rather
than one at a time.

## Carried across the v0.27.4 import

The first four patches were made against the earlier import of AFFiNE
`00576e1e7842fb63095cdc5d7a236321957b550c` and were cherry-picked onto v0.27.4
without conflict. Upstream had not touched any of the lines they change.

## Upstream status

All of these patches are candidates to propose upstream, which would remove the need to
carry them. Nothing has been submitted. AFFiNE's `SECURITY.md` declines
AI-generated security reports, so any submission must be authored and verified
by a maintainer of this fork.
