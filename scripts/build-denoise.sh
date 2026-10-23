#!/usr/bin/env bash
# Recompila o DeepFilterNet3 (libDF, Rust) para WebAssembly a partir do código-fonte oficial.
#
# Só é preciso rodar isto para ATUALIZAR o redutor de ruído: o resultado já vai commitado em
# public/denoise/ (e conferido por tests/unit/denoise-assets.test.ts contra SHA256SUMS).
# Nada é baixado em tempo de execução pelo app.
#
# O resultado é idêntico byte a byte (conferido) se o diretório de trabalho e a versão do rustc forem os
# mesmos, porque o caminho dos fontes entra no .wasm; por isso um novo build costuma mudar o SHA256SUMS.
#
# Uso: scripts/build-denoise.sh [diretório-de-trabalho]   (padrão: /tmp/nexo-denoise-build)
# Precisa de: git, cargo/rustc com o alvo wasm32-unknown-unknown e wasm-bindgen-cli 0.2.118
#   (rustup target add wasm32-unknown-unknown && cargo install wasm-bindgen-cli --version 0.2.118 --locked)
set -euo pipefail

COMMIT=d375b2d8309e0935d165700c91da9de862a99c31   # Rikorose/DeepFilterNet, 2024-10-17
WBG=0.2.118                                         # wasm-bindgen: o cli e a crate precisam ser a mesma versão
MODEL_SHA256=c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-/tmp/nexo-denoise-build}"
out="$root/public/denoise"

command -v wasm-bindgen >/dev/null || { echo "falta o wasm-bindgen-cli $WBG" >&2; exit 1; }
[ "$(wasm-bindgen --version | awk '{print $2}')" = "$WBG" ] || { echo "o wasm-bindgen-cli precisa ser a versão $WBG" >&2; exit 1; }

mkdir -p "$work"
if [ ! -d "$work/src/.git" ]; then git clone --quiet https://github.com/Rikorose/DeepFilterNet.git "$work/src"; fi
cd "$work/src"
git checkout --quiet --force "$COMMIT"
git clean --quiet -fdx -e target

# O modelo não vai embutido no .wasm (ele já é um arquivo separado): economiza ~8 MB.
sed -i '/^wasm = \[/,/^\]/{/"default-model",/d}' libDF/Cargo.toml
# O rustc atual gera binários que o wasm-bindgen 0.2.92 (do Cargo.lock upstream) não processa.
cargo update --quiet -p wasm-bindgen --precise "$WBG"

RUSTFLAGS="-C target-feature=+simd128,+bulk-memory,+nontrapping-fptoint,+mutable-globals" \
  cargo build -p deep_filter --lib --profile release-lto --target wasm32-unknown-unknown --features wasm

tmp="$work/out"
rm -rf "$tmp"
wasm-bindgen target/wasm32-unknown-unknown/release-lto/df.wasm --target web --out-dir "$tmp" --no-typescript

echo "$MODEL_SHA256  models/DeepFilterNet3_onnx.tar.gz" | sha256sum --check --quiet
cp "$tmp/df.js" "$tmp/df_bg.wasm" models/DeepFilterNet3_onnx.tar.gz LICENSE-MIT LICENSE-APACHE "$out/"

# avisos de licença: o .wasm leva dentro todas as crates Rust abaixo
{
  cat <<EOT
# Redutor de ruído: avisos de licença

Os arquivos \`df.js\`, \`df_bg.wasm\` e \`DeepFilterNet3_onnx.tar.gz\` desta pasta vêm do
[DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) (Hendrik Schröter), commit \`$COMMIT\`,
licenciado sob **MIT OR Apache-2.0** (textos em LICENSE-MIT e LICENSE-APACHE do repositório deles).

Compilados com \`scripts/build-denoise.sh\`. O WebAssembly inclui as crates Rust abaixo, todas de
licença permissiva (MIT, Apache-2.0, BSD, Zlib, Unlicense, CC0):

| crate | licença |
| --- | --- |
EOT
  cargo tree -p deep_filter --target wasm32-unknown-unknown --features wasm -e normal --prefix none --format '{p}|{l}' \
    | sed 's/ (\*)$//' | sort -u | awk -F'|' '{ printf "| %s | %s |\n", $1, $2 }'
} > "$out/NOTICE.md"

cd "$out"
sha256sum df.js df_bg.wasm DeepFilterNet3_onnx.tar.gz LICENSE-MIT LICENSE-APACHE worklet.js shim.js framer.js > SHA256SUMS
echo "pronto: $out"
