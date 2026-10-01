# Cloaked Workspace BlockSuite distribution

This repository maintains an independent, openly available BlockSuite
distribution sourced from the living `blocksuite/` subtree of
[AFFiNE](https://github.com/toeverything/AFFiNE).

The modern line is under local review. No `@cloaked-workspace/*` package has
been published from this repository.

## Source and provenance

`blocksuite/` is imported byte-identical from AFFiNE `v0.27.4`, commit
`b4c8548c09da21b2898443559a5b846f0ccf5dd8`. Its Git tree SHA is
`044535822a52dc3134ef70d994901828db35c1ac`. The fork patches in
[`provenance/FORK_PATCHES.md`](provenance/FORK_PATCHES.md) are applied on top,
producing the built tree `45d74766e7cb98cfaebae2145429011aae13b9f6`.

Fork-owned metadata is deliberately outside that tree:

- `provenance/AFFINE_BLOCKSUITE.json` records the exact source import;
- `provenance/PACKAGE_NAME_MAPPING.json` records all 70 distribution names;
- `LICENSES/` contains the copied AFFiNE notices;
- root configuration and `scripts/` own the standalone build and tests.

The complete legacy 0.22.4 implementation is preserved on `maint/0.22` at
`a5091e72365a47351f370ca23f212ef43a9d42f0`. It is not duplicated on the
modern line.

## Distribution names

Imported source retains its original `@blocksuite/*` names and imports.
Distribution staging deterministically maps the 70-package CW graph to
`@cloaked-workspace/blocksuite-*`, for example:

- `@blocksuite/store` → `@cloaked-workspace/blocksuite-store`;
- `@blocksuite/sync` → `@cloaked-workspace/blocksuite-sync`;
- `@blocksuite/affine` → `@cloaked-workspace/blocksuite-affine`.

The complete mapping is checked into
[`provenance/PACKAGE_NAME_MAPPING.json`](provenance/PACKAGE_NAME_MAPPING.json)
and is verified against the discovered dependency graph on every package build.

The first proposed fork version is `0.27.0-cw.1`. Name, internal dependency,
compiled JavaScript, declaration, export, accessor and Vanilla Extract
transformations occur only in disposable staging output.

`@blocksuite/icons` is an external upstream dependency and is not renamed or
republished by this distribution.

## Build and test

See [BUILDING.md](BUILDING.md). The main commands are:

```sh
yarn install --immutable
yarn build
yarn test:unit
yarn test:unit:browser
BLOCKSUITE_ARTIFACT_DIR=/absolute/path/outside/repository yarn build:packages
BLOCKSUITE_ARTIFACT_DIR=/absolute/path/outside/repository yarn verify:consumer
BLOCKSUITE_ARTIFACT_DIR=/absolute/path/outside/repository yarn verify:consumer:app
```

`verify:consumer` checks that the tarballs install, resolve and link.
`verify:consumer:app` goes further: it builds a real application that imports
only published packages, then drives it in a browser to confirm the editor
mounts, renders, and round-trips edits.

## Publication policy

Publication and release automation are intentionally absent. Any future npm
publication must target the public `@cloaked-workspace` scope using npm Trusted
Publishing/OIDC with provenance. Long-lived npm publication tokens are not
permitted.

## License

The imported public BlockSuite packages declare MIT and their upstream notices
are preserved in `LICENSES/`. This repository also retains its historical root
MPL-2.0 notice. Package and repository license presentation must remain explicit
and must not imply that imported MIT source was relicensed.

This project is not affiliated with or endorsed by ToEverything.
