# Publication-readiness review

Date: 2026-07-29

Status: **local package proof passed; publication remains disabled.**

## Owner decisions

- Permanent public npm scope: `@cloaked-workspace`.
- Every owned distribution package has a `blocksuite-` prefix; for example,
  `@blocksuite/store` becomes `@cloaked-workspace/blocksuite-store`.
- Imported AFFiNE source retains original `@blocksuite/*` names and imports.
- Distribution-only staged outputs are renamed.
- Initial version: `0.27.0-cw.1`.
- Public npm is the primary future channel.
- Future publishing must use npm Trusted Publishing/OIDC and provenance.
- GitHub Release tarballs, checksums, SBOM and attestations are a possible
  secondary archival channel.
- No publication or release automation is authorized.

## npm organization verification

`npm org ls cloaked-workspace --json` completed successfully on 2026-07-29.
The superseded `cw-blocksuite` check returned `E404 Scope not found`.

The owner confirmed that npm user `releez` owns the organization and has 2FA
enabled. No package, publishing token or automation account has been created.

This confirms the selected organization exists; it does not authorize a
publication or prove that every future publisher/trusted workflow has been
configured.

## Review branch structure

1. deletion-only removal of the legacy 0.22 implementation;
2. exact AFFiNE subtree import;
3. provenance and licenses outside the imported tree;
4. standalone Node/Yarn/TypeScript workspace;
5. staged `@cloaked-workspace/*@0.27.0-cw.1` distribution transform;
6. documentation, CI test proof and this evidence record;
7. fork patches applied on top of the imported tree.

The exact import commit has `blocksuite` tree SHA
`d0e6e70bfa88943c79dd5608ff3556e9aafb1783`, matching AFFiNE commit
`00576e1e7842fb63095cdc5d7a236321957b550c`.

The imported tree is no longer what gets built. Seven files carry fork patches,
recorded in `provenance/FORK_PATCHES.md`, producing built tree
`0994a6d42d505b516cc4183be69f2084e5fdc839`. Three bound the polynomial regular
expressions CodeQL reported; four align the console whitelists that made the
imported vitest configurations fail on CI.

Mechanical review is therefore two steps rather than one: verify `d0e6e70b…`
against upstream, then review those three commits. `scripts/build-cw-packages.mjs`
refuses to build any other tree, and `inventory.json` records both SHAs.

## Package transformation proof

Two independent forced rebuilds using vendored Yarn 4.13.0 produced an identical
published-content digest for all 70 packages, one on Node 22.23.1 with npm
10.9.8 and one on Node 24.15.0 with npm 11.12.1. The builder invokes the npm
bundled with the running Node binary and records its version rather than
resolving an uncontrolled `npm` from `PATH`.

| Transformation | Count |
|---|---:|
| Package names | 70 |
| Internal manifest dependency specifiers | 651 |
| Compiled JavaScript specifiers | 3,716 |
| Declaration specifiers | 4,426 |
| Export entries mapped to `dist` | 438 |
| Vanilla Extract files compiled | 10 |
| Accessor files requiring extra downleveling | 0 |

The checked-in exact name-mapping file SHA-256 was
`203a1a41ea8b4e05336b7eb8b1b3c66f23a725f3fa8087ac4a33281fdb9b7805`.

The aggregate published-content digest was
`506485c983a6f8addc791636d10c16c1779d65cb169e2e88a9e8462995d39e07`. Unlike the
value removed from an earlier revision of this record, it is defined and
reproducible: `BUILDING.md` states the formula and the builder prints it.

Introducing that digest immediately falsified this record's determinism claim.
Two builds that reused an incremental `dist` agreed, but a forced rebuild
produced different published content. Comparing the artifacts showed exactly one
cause across the whole 70-package graph: `tsconfig.tsbuildinfo`, TypeScript's
incremental build cache, whose `latestChangedDtsFile` varies with build
scheduling. Every compiled `.js`, `.d.ts` and `.map` was already deterministic.

That file is build state and is now removed before packing. It should never have
been published: dropping it took the 70 tarballs from 9.39 MB to 5.15 MB.

With it gone, the digest was reproduced by three independent builds: macOS on
Node 22.23.1 with npm 10.9.8, macOS on Node 24.15.0 with npm 11.12.1, and the
Linux CI runner. That is the first cross-platform reproducibility evidence this
record carries. The two builds it previously described were both on one machine,
which is why they agreed on output that later proved not to be deterministic.

Those three builds agreed on `653412d2e20ccaf62ec4e262808e2924e6596da12c0dbf08d6a07c97459d8e79`.
The value has moved twice since, both times because the builder started
correcting a manifest defect: first dropping a `types` field that pointed at a
missing file, then replacing the blanket `sideEffects: false` with the actual
list of effect-bearing files. The cross-platform claim therefore belongs to the
earlier value; the current one has so far been reproduced by two forced local
rebuilds, and CI confirms it on each push.

An earlier claim in this record, that a comparison build resolving npm 11 from
`PATH` produced different gzip bytes, does not reproduce against npm 11.12.1.
It is unverified as written and should not be relied on.

No package in the 70-package graph was unreproducible from the tag;
`@blocksuite/icons` remains externally sourced.

`@blocksuite/icons@^2.2.17` is the sole external dependency remaining in the
original scope. It is consumed from upstream and is not renamed or republished.

## Local verification

- Node 22.23.1 / Yarn 4.13.0 immutable install: PASS.
- TypeScript build: PASS, 70 projects.
- Node/happy-dom unit tests: PASS, 49 files / 520 tests.
- Chromium unit tests: PASS, 14 files / 124 tests.
- Disposable consumer proof, `yarn verify:consumer`: PASS. All 70 tarballs
  install with scripts disabled, every entry point and declared `types` path
  resolves, and esbuild links the editor into a 1.77 MB bundle.
- Installed internal compiled/declaration references to `@blocksuite/*`: zero,
  apart from the external `@blocksuite/icons`.
- Source tree after builds: unchanged and exact.

- Consumer application proof, `yarn verify:consumer:app`: PASS. An application
  built only from published packages mounts an editor, registers its custom
  elements, renders the document, accepts typed input into the block model, and
  re-renders on a model mutation.

The application proof was added because the consumer proof stops one step short
of the question. It links the packages and measures the bundle, which shows the
modules were reachable, not that the editor works. Building an actual
application immediately surfaced three things the link-only proof could not.

`react` is a hard requirement that no package declares. Zero of the 70 manifests
name it in `dependencies`, `peerDependencies` or `optionalDependencies`, yet
`blocksuite-affine-components` re-exports `@blocksuite/icons/rc` from its public
icon barrel, so any bundle reaching the view extensions fails to resolve
`react/jsx-runtime`. The monorepo hides this: the root manifest carries `react`
as a development dependency. The existing proof missed it because its probe
re-exports four packages whose entry points never reach that barrel.

Two options close it, and they are not equivalent. The builder can declare
`react` a peer dependency of the affected package, which is the same class of
manifest correction it already performs and which changes every consumer's
install graph. Or the fork can patch the barrel to stop re-exporting the React
icons, which is the better fix and changes the imported tree SHA and the
provenance record. This is an owner decision and is listed as a release gate.

The distribution also ships no CSS and no editor element. Theme tokens come from
the external `@toeverything/theme`, and the consumer must supply both an
ancestor carrying `.affine-page-viewport`, which the root block requires and
throws without, and a container built on `BlockStdScope`. Neither is a defect —
AFFiNE supplies its own — but neither was documented, and an application cannot
be assembled without knowing them. `BUILDING.md` now records all three.

The consumer proof is now a script in this repository and a step in CI. It
previously existed only as the three claims below, recorded from a manual run
that nothing could repeat:

- Disposable CW tests: PASS, 16/16.
- Disposable CW Next.js 16.2.12 production build: PASS.

Those two are retained as history rather than evidence. Neither is reproducible
from this repository, and the CW project they ran against is not part of it.
Automating an equivalent against the real consumer is the remaining work.

Writing the script immediately surfaced two things the manual claims had not.
`@blocksuite/global` shipped a `types` field pointing at a file that does not
exist in the package, invisible under `node16` and `bundler` resolution and
broken under classic `node`; the builder now drops such fields. And the
distribution is bundler-only: compiled output uses extensionless and
directory-relative specifiers, so 6 of 70 packages load under Node's ESM
resolver. Every bundler resolves them, which is why no earlier check noticed.

## Tooling audit gate

The original disposable CW lock reported nine high-severity package nodes. All
derive from the `brace-expansion` denial-of-service advisory through
`minimatch` and the ESLint/`eslint-config-next` development toolchain. The
affected nodes are not part of the deployed CW runtime.

Testing ESLint 10 removed three audit nodes but was not a valid remediation:
the current Next ESLint plugins reject ESLint 10 and six vulnerable plugin
nodes remain. Forcing `minimatch@10` into those plugins is also incompatible
with their CommonJS callable API.

Therefore no publication workflow is enabled. Before publication CI is added,
the owner must choose one reviewed remediation:

1. upgrade to a future compatible `eslint-config-next`/plugin set whose glob
   graph is fixed; or
2. replace that downstream lint stack with an equivalent maintained
   configuration and demonstrate lint parity.

This is a build/tooling availability risk, not evidence of a CW runtime
vulnerability.

## Remaining release gates

- Review the final diff and commit hashes locally.
- Approve package compatibility and versioning policy.
- Configure npm Trusted Publishing independently for all packages, with no
  long-lived token.
- Add provenance/SBOM generation and signature verification.
- Repeat the disposable CW proof from clean, published-shape artifacts.
- Decide how the undeclared `react` requirement is resolved: a builder-declared
  peer dependency, or a fork patch removing the React icon re-export.
- Approve and test an archival immutable GitHub Release process separately.
