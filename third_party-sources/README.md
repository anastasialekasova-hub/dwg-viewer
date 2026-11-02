# Upstream source archives (GPL-3.0 obligation, ТЗ 7.9)

The extension ships compiled WebAssembly and bundled ESM from two GPL-3.0
packages. Complete, verbatim copies of the exact published versions are kept
here so the sources stay available even if upstream disappears:

| Archive | Version | Upstream | sha256 |
|---|---|---|---|
| libredwg-web-0.7.17.tgz | 0.7.17 | https://github.com/mlightcad/libredwg-web (tag v0.7.17) | b2fe9f53502c30006f6b13fe76f86a7d7b4294fd4585867cf9e097b775e611ba |
| libredwg-converter-3.15.17.tgz | 3.15.17 | https://github.com/mlightcad/realdwg-web | 8b011597d2019b71eee1a2bfbdf091f3e3e054ec7d1c97163d6c8fa97ff87f14 |

Both are the npm publish tarballs (`npm pack` output) of the pinned versions
vendored by `tools/vendor-build.js`. The LibreDWG wasm build scripts are the
libredwg-web repository at tag v0.7.17 (see THIRD_PARTY_NOTICES.md).
