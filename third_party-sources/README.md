# Pinned npm distribution archives

The extension ships compiled WebAssembly and bundled ESM from two GPL-3.0
packages. These archives are verbatim copies of their published npm
distributions. They preserve the shipped artifacts, but do not include the
complete implementation source trees or native build inputs and do not by
themselves close the source-delivery requirement in ТЗ 7.9:

| Archive | Version | Upstream | sha256 |
|---|---|---|---|
| libredwg-web-0.7.17.tgz | 0.7.17 | https://github.com/mlightcad/libredwg-web (tag v0.7.17) | b2fe9f53502c30006f6b13fe76f86a7d7b4294fd4585867cf9e097b775e611ba |
| libredwg-converter-3.15.17.tgz | 3.15.17 | https://github.com/mlightcad/realdwg-web | 8b011597d2019b71eee1a2bfbdf091f3e3e054ec7d1c97163d6c8fa97ff87f14 |

Both are npm publish tarballs (`npm pack` output) of the pinned versions
vendored by `tools/vendor-build.js`. Actual upstream source references are:

- libredwg-web v0.7.17: `2654a724bce3d5f588a0d16b6426a23e3f0fef46`;
- its jsmn submodule: `85695f3d5903b1cd5b4030efe50db3b4f5f3c928`;
- converter monorepo v1.15.17: `ae0d603bd4e3cad0d8d415c53338d84b14b8c125`
  (package libredwg-converter 3.15.17).

## Component source delivery

`dwg-viewer-gpl-component-sources.tar.gz` contains the exact preferred-source
snapshots, licenses, build inputs, provenance and `BOOTSTRAP/BUILD.md`. It is
25,241,603 bytes, SHA-256
`d5f7bb3a2ece04de3d5951bf294538f038a9182ac3c07039360397cdbe5360a9`.

Keep that archive together with all three history bundles listed below.
The bundles are release assets rather than Git-tracked files (the web
bundle exceeds GitHub's individual-file limit). They preserve the history
and refs used by upstream's normal version/bootstrap scripts. Download the
matching delivery set from:
https://github.com/anastasialekasova-hub/dwg-viewer/releases/tag/v1.0.1

| Required bundle | Bytes | SHA-256 |
|---|---:|---|
| libredwg-web-history.bundle | 152787531 | 70989e40c4556f8ab0333fe3801e8a2dc078305ebc77b4712af2f2aa26150a2c |
| jsmn-history.bundle | 642025 | 83bb7e5aeabfd1af24f350dc665283ee23c8584d10c1770a13bbae7f9795b724 |
| realdwg-web-history.bundle | 5662376 | 4172233cf0630e858d6bb097f1d4fdd302f1d59b90cb6ffc2ffa09445cfb851e |

Extract the source archive into a new empty directory, and place the three
bundles under its `git-bundles/` directory. Follow `BOOTSTRAP/BUILD.md` for
the exact local-only restore commands. The archive alone lacks Git history;
the old npm tarballs are not substitutes for any of these assets.

An independent fresh offline restore checked all three pinned commits and
2,004 Git blobs against the archive. The restored WASM is byte-for-byte equal
to the extension's vendored binary (SHA-256
`2bd963e881cfa08d645e1c869f31ca7ae3e47552276c29e41829cd84250e301a`).
All 2,174 inventory entries and delivery checksums were also verified. Native
bootstrap, package installation, builds and bit-for-bit reproduction were
**not run**; this is not a legal-compliance certification. Do not relabel the
npm distributions as source trees. See THIRD_PARTY_NOTICES.md.
