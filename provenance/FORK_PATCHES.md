# Fork patches applied to the imported AFFiNE subtree

The `blocksuite/` tree was imported unchanged from AFFiNE commit
`00576e1e7842fb63095cdc5d7a236321957b550c`, subtree SHA
`d0e6e70bfa88943c79dd5608ff3556e9aafb1783`. The patches below are applied on
top of that import, so the built tree is
`3fe97e771913e2eea910f0c3d4e4e5dfae676e47`.

Reviewing the import mechanically therefore takes two steps rather than one:
verify `d0e6e70b…` against upstream, then review the two commits listed here.
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
| `affine/inlines/footnote/src/adapters/markdown/preprocessor.ts` | leading token bounded to 512, label to 128 |

Worst case measured on Node 22.23.1, before and after: 10 174 ms → 0.0 ms,
45 637 ms → 1.1 ms, and 2 548 ms → 93.7 ms respectively. All three now scale
linearly.

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

## Upstream status

Both patches are candidates to propose upstream, which would remove the need to
carry them. Nothing has been submitted. AFFiNE's `SECURITY.md` declines
AI-generated security reports, so any submission must be authored and verified
by a maintainer of this fork.
