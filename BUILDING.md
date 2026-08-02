# Building and testing

## Required environment

- Node.js `22.23.1` (`.nvmrc`)
- vendored Yarn `4.13.0`
- npm `10.9.8`, bundled with the pinned Node.js distribution

Do not substitute a newly resolved dependency graph. The checked-in lockfile is
part of the pinned AFFiNE source-build provenance.

## Install

```sh
corepack enable
yarn install --immutable
```

An immutable install may report inherited peer-dependency warnings. It must not
modify `package.json`, `yarn.lock`, `.nvmrc`, `.yarnrc.yml`, or the TypeScript
configuration.

## Build

```sh
yarn build
```

This builds the complete 70-project TypeScript reference graph from the
byte-identical `blocksuite/` source.

## Unit tests

```sh
yarn test:unit
yarn exec playwright install chromium
yarn test:unit:browser
```

The first command runs the Node and happy-dom configurations. The second test
command runs the browser unit configurations against Chromium.

## Local distribution artifacts

Choose an absolute disposable output directory outside the repository:

```sh
BLOCKSUITE_ARTIFACT_DIR=/private/tmp/cw-blocksuite-artifacts \
  yarn build:packages
```

The builder:

1. verifies `HEAD:blocksuite` against the recorded patched tree SHA;
2. builds and packs the original `@blocksuite/*` workspaces;
3. verifies the checked-in 70-package mapping and stages the CW dependency
   closure under `@cloaked-workspace/blocksuite-*`;
4. assigns prerelease version `0.27.0-cw.1`;
5. rewrites only staged package metadata, internal compiled imports and
   declaration imports;
6. rewrites exports to `dist`, verifies supported accessor syntax and compiles
   Vanilla Extract output;
7. removes each package's `tsconfig.tsbuildinfo`, which is TypeScript's
   incremental build cache rather than published content;
8. packs 70 local tarballs and writes `inventory.json` with hashes and
   transformation counts;
9. removes repository-local staging.

Packing invokes the npm CLI bundled with the running Node.js binary rather
than an arbitrary `npm` from `PATH`. The recorded npm version is therefore
part of the exact-byte artifact provenance.

No package script is executed by `npm pack`, and this command does not publish.

### Consumer proof

```sh
BLOCKSUITE_ARTIFACT_DIR=/private/tmp/cw-blocksuite-artifacts \
  yarn verify:consumer
```

Installs the tarballs into a disposable project outside the repository with
scripts disabled, and asserts that all 70 packages install, that no unrewritten
`@blocksuite/*` specifier survives apart from the external `@blocksuite/icons`,
that every entry point and declared `types` path resolves, and that esbuild links
the editor into a bundle above a size floor.

The floor matters: every package declares `sideEffects: false`, so a bare
`import 'pkg'` is tree-shaken to nothing and an empty bundle would otherwise
look like a pass. The probe re-exports each package as a namespace instead.

The distribution targets bundlers. Compiled output uses extensionless and
directory-relative specifiers, which every bundler resolves and Node's ESM
resolver rejects, so only a handful of packages load in plain Node. The script
reports that count without failing on it.

### Consumer application proof

```sh
BLOCKSUITE_ARTIFACT_DIR=/private/tmp/cw-blocksuite-artifacts \
  yarn verify:consumer:app
```

The consumer proof above answers whether a bundler can link the packages. It
cannot answer whether the editor works, because a bundle above a size floor only
shows the modules were reachable. This command builds the application in
`scripts/consumer-app/` — which imports nothing from this repository — into a
disposable project, serves it, and drives it in Chromium. It asserts that the
custom elements register, that the document renders, that typing reaches the
block model, and that a model mutation reaches the view.

Set `CHROMIUM_PATH` to use a browser Playwright did not install itself, and
`CONSUMER_APP_SCREENSHOT` to write a screenshot of the mounted editor.

Two requirements the application had to satisfy are not visible from the package
metadata, and a consumer will hit both:

- `react` must be installed. `blocksuite-affine-components` re-exports
  `@blocksuite/icons/rc` from its public icon barrel, so any bundle that reaches
  the view extensions must resolve `react/jsx-runtime`. None of the 70 packages
  declares it.
- The distribution ships no CSS and no editor shell. Theme tokens come from
  `@toeverything/theme`, and the host must provide both an ancestor carrying
  `.affine-page-viewport` — the root block registers
  `ViewportElementExtension('.affine-page-viewport')` and throws without it —
  and its own container element built on `BlockStdScope`.

Note also that `@cloaked-workspace/blocksuite-affine/effects` registers nothing.
Its source is type-only imports, so it compiles to binding-free imports and the
package stays `sideEffects: false`. Element registration comes from the view
extensions, which call each block's `effects()` during setup.

### Comparing two builds

`inventory.json` records two kinds of hash per package, and they answer
different questions.

`archiveSha256` is SHA-256 over the `.tgz` bytes npm produced. It is only
meaningful for a given archiver.

`contentSha256` is SHA-256 over what the package publishes, with npm taking no
part in producing the bytes. For each file in the set `npm pack --json` reports,
sorted by path, the digest is fed:

```
path, NUL byte, file bytes read from the staged tree, NUL byte
```

`inventoryContentSha256` aggregates those. Take one line per package,

```
<distribution name>@<version> <contentSha256>
```

sort the lines, join with `\n`, append a trailing `\n`, and take SHA-256 of the
result. The builder prints this value when it finishes.

Use `inventoryContentSha256` to decide whether two independent builds staged the
same content. It is invariant across archivers by construction, and changes if
any published byte changes or if npm's inclusion rules change. It is a
pre-publication check only, and is not a substitute for npm provenance
attestations once publishing is configured.

## Publication safety

There is no publication workflow. Do not add one until all of the following are
approved:

- release and compatibility policy;
- npm Trusted Publishing/OIDC configuration for every public package;
- provenance and SBOM production;
- immutable GitHub Release archival policy;
- remediation or replacement of the audited ESLint/Next tooling chain used by
  the downstream CW application.

Never add a long-lived npm publication token.
