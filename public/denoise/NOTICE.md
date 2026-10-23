# Redutor de ruído: avisos de licença

Os arquivos `df.js`, `df_bg.wasm` e `DeepFilterNet3_onnx.tar.gz` desta pasta vêm do
[DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) (Hendrik Schröter), commit `d375b2d8309e0935d165700c91da9de862a99c31`,
licenciado sob **MIT OR Apache-2.0** (textos em LICENSE-MIT e LICENSE-APACHE do repositório deles).

Compilados com `scripts/build-denoise.sh`. O WebAssembly inclui as crates Rust abaixo, todas de
licença permissiva (MIT, Apache-2.0, BSD, Zlib, Unlicense, CC0):

| crate | licença |
| --- | --- |
| addr2line v0.21.0 | Apache-2.0 OR MIT |
| adler v1.0.2 | 0BSD OR MIT OR Apache-2.0 |
| ahash v0.8.11 | MIT OR Apache-2.0 |
| aho-corasick v1.1.3 | Unlicense OR MIT |
| anyhow v1.0.82 | MIT OR Apache-2.0 |
| backtrace v0.3.71 | MIT OR Apache-2.0 |
| bit-set v0.5.3 | MIT/Apache-2.0 |
| bit-vec v0.6.3 | MIT/Apache-2.0 |
| bumpalo v3.16.0 | MIT OR Apache-2.0 |
| byteorder v1.5.0 | Unlicense OR MIT |
| bytes v1.6.0 | MIT |
| cfg-if v1.0.0 | MIT/Apache-2.0 |
| claxon v0.4.3 | Apache-2.0 |
| console_error_panic_hook v0.1.7 | Apache-2.0/MIT |
| const-random-macro v0.1.16 (proc-macro) | MIT OR Apache-2.0 |
| const-random v0.1.18 | MIT OR Apache-2.0 |
| crc32fast v1.4.0 | MIT OR Apache-2.0 |
| crossbeam-channel v0.5.12 | MIT OR Apache-2.0 |
| crossbeam-utils v0.8.19 | MIT OR Apache-2.0 |
| crunchy v0.2.2 | MIT |
| deep_filter v0.5.7-pre (/tmp/dfn-build/src/libDF) | MIT/Apache-2.0 |
| derive-new v0.5.9 (proc-macro) | MIT |
| dlv-list v0.5.2 | MIT OR Apache-2.0 |
| downcast-rs v1.2.1 | MIT/Apache-2.0 |
| dyn-clone v1.0.17 | MIT OR Apache-2.0 |
| either v1.11.0 | MIT OR Apache-2.0 |
| filetime v0.2.23 | MIT/Apache-2.0 |
| flate2 v1.0.30 | MIT OR Apache-2.0 |
| getrandom v0.2.14 | MIT OR Apache-2.0 |
| gimli v0.28.1 | MIT OR Apache-2.0 |
| half v2.4.1 | MIT OR Apache-2.0 |
| hashbrown v0.14.5 | MIT OR Apache-2.0 |
| itertools v0.10.5 | MIT/Apache-2.0 |
| itertools v0.12.1 | MIT OR Apache-2.0 |
| js-sys v0.3.69 | MIT OR Apache-2.0 |
| lazy_static v1.4.0 | MIT/Apache-2.0 |
| lewton v0.10.2 | MIT OR Apache-2.0 |
| libc v0.2.191 | MIT OR Apache-2.0 |
| libm v0.2.8 | MIT OR Apache-2.0 |
| log v0.4.21 | MIT OR Apache-2.0 |
| maplit v1.0.2 | MIT/Apache-2.0 |
| matrixmultiply v0.3.8 | MIT/Apache-2.0 |
| memchr v2.7.2 | Unlicense OR MIT |
| memmap2 v0.9.4 | MIT OR Apache-2.0 |
| minimal-lexical v0.2.1 | MIT/Apache-2.0 |
| miniz_oxide v0.7.2 | MIT OR Zlib OR Apache-2.0 |
| ndarray v0.15.6 | MIT OR Apache-2.0 |
| nom v7.1.3 | MIT |
| num-complex v0.4.5 | MIT OR Apache-2.0 |
| num-integer v0.1.46 | MIT OR Apache-2.0 |
| num-traits v0.2.19 | MIT OR Apache-2.0 |
| object v0.32.2 | Apache-2.0 OR MIT |
| ogg v0.8.0 | BSD-3-Clause |
| once_cell v1.19.0 | MIT OR Apache-2.0 |
| ordered-multimap v0.7.3 | MIT |
| paste v1.0.14 (proc-macro) | MIT OR Apache-2.0 |
| ppv-lite86 v0.2.17 | MIT/Apache-2.0 |
| primal-check v0.3.3 | MIT OR Apache-2.0 |
| proc-macro2 v1.0.107 | MIT OR Apache-2.0 |
| prost-derive v0.11.9 (proc-macro) | Apache-2.0 |
| prost v0.11.9 | Apache-2.0 |
| quote v1.0.36 | MIT OR Apache-2.0 |
| rand_chacha v0.3.1 | MIT OR Apache-2.0 |
| rand_core v0.6.4 | MIT OR Apache-2.0 |
| rand_distr v0.4.3 | MIT OR Apache-2.0 |
| rand v0.8.5 | MIT OR Apache-2.0 |
| rawpointer v0.2.1 | MIT/Apache-2.0 |
| realfft v3.3.0 | MIT |
| regex-automata v0.4.6 | MIT OR Apache-2.0 |
| regex-syntax v0.8.3 | MIT OR Apache-2.0 |
| regex v1.10.4 | MIT OR Apache-2.0 |
| rubato v0.14.1 | MIT |
| rustc-demangle v0.1.23 | MIT/Apache-2.0 |
| rustfft v6.2.0 | MIT OR Apache-2.0 |
| rust-ini v0.21.0 | MIT |
| same-file v1.0.6 | Unlicense/MIT |
| scan_fmt v0.2.6 | MIT |
| serde v1.0.200 | MIT OR Apache-2.0 |
| smallvec v1.13.2 | MIT OR Apache-2.0 |
| strength_reduce v0.2.4 | MIT OR Apache-2.0 |
| string-interner v0.15.0 | MIT/Apache-2.0 |
| syn v1.0.109 | MIT OR Apache-2.0 |
| syn v2.0.60 | MIT OR Apache-2.0 |
| tar v0.4.40 | MIT/Apache-2.0 |
| thiserror-impl v1.0.59 (proc-macro) | MIT OR Apache-2.0 |
| thiserror v1.0.59 | MIT OR Apache-2.0 |
| tiny-keccak v2.0.2 | CC0-1.0 |
| tinyvec_macros v0.1.1 | MIT OR Apache-2.0 OR Zlib |
| tinyvec v1.6.0 | Zlib OR Apache-2.0 OR MIT |
| tract-core v0.21.4 | MIT OR Apache-2.0 |
| tract-data v0.21.4 | MIT OR Apache-2.0 |
| tract-hir v0.21.4 | MIT OR Apache-2.0 |
| tract-linalg v0.21.4 | MIT OR Apache-2.0 |
| tract-nnef v0.21.4 | MIT OR Apache-2.0 |
| tract-onnx-opl v0.21.4 | MIT OR Apache-2.0 |
| tract-onnx v0.21.4 | MIT OR Apache-2.0 |
| tract-pulse-opl v0.21.4 | MIT OR Apache-2.0 |
| tract-pulse v0.21.4 | MIT OR Apache-2.0 |
| transpose v0.2.3 | MIT OR Apache-2.0 |
| trim-in-place v0.1.7 | MIT |
| unicode-ident v1.0.12 | (MIT OR Apache-2.0) AND Unicode-DFS-2016 |
| walkdir v2.5.0 | Unlicense/MIT |
| wasm-bindgen-macro-support v0.2.118 | MIT OR Apache-2.0 |
| wasm-bindgen-macro v0.2.118 (proc-macro) | MIT OR Apache-2.0 |
| wasm-bindgen-shared v0.2.118 | MIT OR Apache-2.0 |
| wasm-bindgen v0.2.118 | MIT OR Apache-2.0 |
| zerocopy v0.7.33 | BSD-2-Clause OR Apache-2.0 OR MIT |
