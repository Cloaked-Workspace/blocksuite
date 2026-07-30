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
`653412d2e20ccaf62ec4e262808e2924e6596da12c0dbf08d6a07c97459d8e79`. Unlike the
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

With it gone, two forced rebuilds produced an identical content digest, one on
Node 22.23.1 with npm 10.9.8 and one on Node 24.15.0 with npm 11.12.1.

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
- Disposable CW install with 70 local
  `@cloaked-workspace/blocksuite-*` tarballs and no postinstall: PASS.
- Disposable CW tests: PASS, 16/16.
- Disposable CW Next.js 16.2.12 production build: PASS.
- Installed internal compiled/declaration references to `@blocksuite/*`: zero.
- Source tree after builds: unchanged and exact.

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
- Approve and test an archival immutable GitHub Release process separately.
