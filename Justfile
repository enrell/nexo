# Nexo — compilar, empacotar e instalar no Windows e no Linux.
# `just` sem argumentos lista as receitas. Primeira vez: `just setup`.

set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

version := `node -p "require('./package.json').version"`
win_exe := "release/Nexo-Setup-" + version + ".exe"
linux_app := "release/Nexo-" + version + ".AppImage"

# lista as receitas
default:
    @just --list --unsorted

# ---------------------------------------------------------------- desenvolvimento

# instala as dependências e baixa o binário do Electron (o npm bloqueia o postinstall dele)
setup:
    npm ci
    node node_modules/electron/install.js

# Vite + Electron com hot reload
dev:
    npm run dev

# só a interface no navegador (Vite)
dev-web:
    npm run dev:web

# compila e abre o app como pacote local, sem instalar
start:
    npm start

# checagem de tipos (app e testes)
typecheck:
    npm run typecheck

# typecheck + build da interface em dist/
build:
    npm run build

# testes unitários (rápidos, sem rede nem Electron)
test:
    npm test

# testes unitários com relatório de cobertura e limite mínimo
coverage:
    npm run test:cov

# quebra regras de segurança de propósito, uma por vez, e confere que os testes falham (ex.: just mutation derive)
mutation filtro="":
    node scripts/mutation-check.mjs {{ filtro }}

# teste ponta a ponta (várias instâncias reais via P2P; precisa de rede e de um Electron que abra)
e2e:
    npm run test:e2e

# e2e no Windows a partir do WSL (aqui o Electron não abre); baixa Node e Electron portáteis para %TEMP% na 1ª vez
e2e-win: build
    scripts/e2e-win.sh

# tudo o que o CI confere, na ordem dele
check: typecheck build coverage
    npm audit --omit=dev --audit-level=high
    node tests/e2e.mjs

# gera o par de chaves que assina as atualizações (a privada vai para um arquivo; a pública imprime na tela)
update-keygen arquivo:
    node scripts/update-keygen.mjs {{ arquivo }}

# recompila o redutor de ruído (DeepFilterNet3 → WebAssembly) em public/denoise/; só para atualizá-lo (precisa de rust + wasm32 + wasm-bindgen-cli, veja o script)
denoise-build:
    scripts/build-denoise.sh

# regenera build/icon.png e build/tray*.png a partir de public/logo.svg
icons:
    npm run icons

# ---------------------------------------------------------------- empacotar (release/)

# instalador do sistema atual
[linux]
dist: dist-linux

[windows]
dist: dist-win

# Windows: release/Nexo-Setup-<versão>.exe (NSIS)
[windows]
dist-win: build
    npx electron-builder --win --publish never

# Windows a partir do Linux. Com wine usa ele; no WSL roda os .exe do electron-builder direto no Windows
[linux]
dist-win: build
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v wine >/dev/null; then
        npx electron-builder --win --publish never
    elif grep -qi microsoft /proc/version; then
        # wine falso (scripts/wsl-wine) + Z: apontando para a raiz do WSL, onde o electron-builder espera o disco do wine
        mapped=0
        if ! cmd.exe /c 'if exist Z:\ (exit 0) else (exit 1)' >/dev/null 2>&1; then
            (cd /mnt/c && powershell.exe -NoProfile -Command 'net use Z: \\wsl$\$env:WSL_DISTRO_NAME' >/dev/null) || { echo 'não consegui mapear o Z: para o WSL' >&2; exit 1; }
            mapped=1
        fi
        trap '[ "$mapped" = 1 ] && (cd /mnt/c && powershell.exe -NoProfile -Command "net use Z: /delete /y" >/dev/null 2>&1) || true' EXIT
        PATH="$PWD/scripts/wsl-wine:$PATH" npx electron-builder --win --publish never
    else
        echo 'falta o wine para gerar o instalador do Windows no Linux (Arch: sudo pacman -S wine; Debian/Ubuntu: sudo apt install wine64).' >&2
        echo 'Alternativa: rode `just dist` no Windows, ou use o workflow release do GitHub.' >&2
        exit 1
    fi

# Linux: release/Nexo-<versão>.AppImage
dist-linux: build
    npx electron-builder --linux --publish never

# Windows e Linux de uma vez (no Linux exige o wine, como dist-win)
dist-all: dist-linux dist-win

# ---------------------------------------------------------------- instalar

# instala o pacote já gerado neste sistema (rode `just dist`)
[windows]
install: dist
    if (-not (Test-Path '{{ win_exe }}')) { throw 'falta {{ win_exe }}: rode `just dist`' }
    Start-Process -Wait '{{ win_exe }}'

# Linux: instala só para o usuário, sem sudo (~/.local), com atalho no menu e o link nexo://
[linux]
install: dist
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f '{{ linux_app }}' ] || { echo 'falta {{ linux_app }}: rode `just dist`' >&2; exit 1; }
    data="${XDG_DATA_HOME:-$HOME/.local/share}"
    mkdir -p "$data/nexo" "$data/applications" "$data/icons/hicolor/512x512/apps" "$HOME/.local/bin"
    install -m 755 '{{ linux_app }}' "$data/nexo/Nexo.AppImage"
    install -m 644 build/icon.png "$data/icons/hicolor/512x512/apps/nexo.png"
    ln -sf "$data/nexo/Nexo.AppImage" "$HOME/.local/bin/nexo"
    cat > "$data/applications/nexo.desktop" <<EOF
    [Desktop Entry]
    Type=Application
    Name=Nexo
    Comment=Chat, voz e lives P2P entre amigos
    Exec=$data/nexo/Nexo.AppImage %U
    Icon=nexo
    Categories=Network;Chat;InstantMessaging;
    MimeType=x-scheme-handler/nexo;
    StartupWMClass=Nexo
    Terminal=false
    EOF
    command -v update-desktop-database >/dev/null && update-desktop-database "$data/applications" || true
    command -v xdg-mime >/dev/null && xdg-mime default nexo.desktop x-scheme-handler/nexo || true
    echo "Nexo {{ version }} instalado em $data/nexo (comando: nexo)"

# Linux: remove o que `just install` colocou em ~/.local (os dados da conta ficam em ~/.config/Nexo)
[linux]
uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    data="${XDG_DATA_HOME:-$HOME/.local/share}"
    rm -rf "$data/nexo" "$data/applications/nexo.desktop" "$data/icons/hicolor/512x512/apps/nexo.png" "$HOME/.local/bin/nexo"
    command -v update-desktop-database >/dev/null && update-desktop-database "$data/applications" || true
    echo "Nexo removido (dados da conta preservados)"

# WSL: gera o instalador do Windows (dist-win) e roda no Windows hospedeiro
[linux]
install-win: dist-win
    #!/usr/bin/env bash
    set -euo pipefail
    grep -qi microsoft /proc/version || { echo 'install-win só funciona dentro do WSL; no Windows use `just install`' >&2; exit 1; }
    [ -f '{{ win_exe }}' ] || { echo 'falta {{ win_exe }}: rode `just dist-win`' >&2; exit 1; }
    tmp="$(wslpath -u "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")"
    cp '{{ win_exe }}' "$tmp/"
    "$tmp/Nexo-Setup-{{ version }}.exe"

# ---------------------------------------------------------------- limpeza

# apaga dist/ e release/
[linux]
clean:
    rm -rf dist release

[windows]
clean:
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue dist, release
