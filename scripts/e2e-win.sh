#!/usr/bin/env bash
# Roda o teste ponta a ponta (tests/e2e.mjs) no Windows a partir do WSL, onde o Electron não abre.
#
# Na primeira vez baixa, para %TEMP%\nexo-e2e-tools, um Node portátil e o Electron para Windows nas
# mesmas versões do projeto, conferindo o SHA-256 de cada um com a lista oficial. Nada é instalado no
# sistema. O app e o teste rodam direto da pasta do WSL (\\wsl.localhost\...), sem copiar o repositório.
#
# Uso: scripts/e2e-win.sh   (rode `npm run build` antes: o teste usa dist/)
#      NEXO_E2E_WIDTH=1000 scripts/e2e-win.sh   → layout de janela estreita
set -euo pipefail

grep -qi microsoft /proc/version || { echo "e2e-win só funciona dentro do WSL; no Windows use: npm run test:e2e" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$root/dist/index.html" ] || { echo "falta dist/: rode npm run build" >&2; exit 1; }

node_v="$(node -v)"                                                           # ex.: v26.12.1
electron_v="$(node -p "require('$root/node_modules/electron/package.json').version")"
win_tmp="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
tools="$(wslpath -u "$win_tmp")/nexo-e2e-tools"
mkdir -p "$tools"

# baixa $1 para $2 e confere com a linha de $3 (arquivo SHASUMS256) que termina em $4
fetch() {
  local url="$1" out="$2" sums="$3" name="$4"
  curl -fsSL --retry 3 -o "$out" "$url"
  local want got
  want="$(grep -E "[ *]$name\$" "$sums" | awk '{print $1}')"
  got="$(sha256sum "$out" | awk '{print $1}')"
  [ -n "$want" ] && [ "$want" = "$got" ] || { rm -f "$out"; echo "SHA-256 não confere: $name" >&2; exit 1; }
}

node_dir="$tools/node-$node_v-win-x64"
if [ ! -x "$node_dir/node.exe" ]; then
  curl -fsSL -o "$tools/node-SHASUMS256.txt" "https://nodejs.org/dist/$node_v/SHASUMS256.txt"
  fetch "https://nodejs.org/dist/$node_v/node-$node_v-win-x64.zip" "$tools/node.zip" "$tools/node-SHASUMS256.txt" "node-$node_v-win-x64.zip"
  bsdtar -xf "$tools/node.zip" -C "$tools"
  rm -f "$tools/node.zip"
fi

electron_dir="$tools/electron-$electron_v"
if [ ! -f "$electron_dir/electron.exe" ]; then
  base="https://github.com/electron/electron/releases/download/v$electron_v"
  curl -fsSL -o "$tools/electron-SHASUMS256.txt" "$base/SHASUMS256.txt"
  fetch "$base/electron-v$electron_v-win32-x64.zip" "$tools/electron.zip" "$tools/electron-SHASUMS256.txt" "electron-v$electron_v-win32-x64.zip"
  mkdir -p "$electron_dir"
  bsdtar -xf "$tools/electron.zip" -C "$electron_dir"
  rm -f "$tools/electron.zip"
fi

win_root="$(wslpath -w "$root")"
cd /mnt/c # o cmd/powershell não aceitam pasta atual em \\wsl.localhost
NEXO_E2E_ELECTRON="$(wslpath -w "$electron_dir/electron.exe")" WSLENV="NEXO_E2E_ELECTRON${E2E_SHOTS:+:E2E_SHOTS/p}${NEXO_E2E_WIDTH:+:NEXO_E2E_WIDTH}" \
  "$node_dir/node.exe" "$win_root\\tests\\e2e.mjs"
