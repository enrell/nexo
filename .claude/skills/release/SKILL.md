---
name: release
description: Publica uma nova versão do Nexo (versionamento semântico, CHANGELOG, tag anotada, GitHub Release com instalador, SHA256SUMS e atestado). Use quando o usuário pedir para "lançar", "publicar", "soltar uma versão/release", "fazer tag" ou "subir uma atualização para os amigos".
---

# Publicar uma release do Nexo

A release é feita **pelo GitHub Actions** (`.github/workflows/release.yml`) quando uma tag `vX.Y.Z` é enviada. Nunca publique o instalador da máquina local: o pipeline roda os testes, gera o instalador, publica `SHA256SUMS.txt`, cria o atestado de procedência e só então tira a release do rascunho. Os apps instalados se atualizam a partir das releases publicadas (`electron-updater` ignora rascunhos).

Repositório: `enrell/nexo`. Branch: `main`.

## Regras que não mudam

- **Commits e tags saem só no nome do usuário** (`git config user.name/email`). Nada de `Co-Authored-By`, "Generated with Claude Code" ou link de sessão, em commit, tag ou notas de release. Confira antes do push (passo 7).
- **Nunca mova nem reutilize uma tag que já foi publicada.** Se uma release publicada tiver problema, lance uma nova versão de correção.
- Nada de `--no-verify`, `--force` em `main` ou pular os testes.
- Se a mudança afeta o modelo de ameaça (criptografia, protocolo, permissões, rede), o `SECURITY.md` precisa estar atualizado **antes** da release.

## 1. Pré-condições

```bash
git switch main && git pull --ff-only
git status --porcelain            # tem que estar vazio
gh run list --branch main --limit 3   # o último "ci" do HEAD tem que estar verde
git describe --tags --abbrev=0    # última versão publicada
```

Se o CI do HEAD não estiver verde, pare e resolva primeiro.

## 2. Escolher a versão (SemVer)

Enquanto estiver em `0.x`:

| Mudança | Incremento |
|---|---|
| Quebra de compatibilidade (protocolo P2P, `APP_ID`/`PROTO`, formato dos dados locais, convites antigos param de funcionar) | **minor** (`0.3.0 → 0.4.0`) e registre em **Alterado** |
| Funcionalidade nova compatível | **minor** |
| Só correções, incluindo correções de segurança | **patch** (`0.3.0 → 0.3.1`) |

A partir da `1.0.0`: quebra = **major**, funcionalidade = **minor**, correção = **patch**.

Correção de **vulnerabilidade**: release de patch o quanto antes, com a seção **Segurança** descrevendo o impacto sem dar receita de exploração. Se veio de um relato privado, publique o advisory do GitHub junto.

## 3. Levantar o que mudou

```bash
git log --no-merges --format='%h %s' "$(git describe --tags --abbrev=0)"..HEAD
```

Mapeie os commits (Conventional Commits) para as categorias do Keep a Changelog:

| Commit | Categoria |
|---|---|
| `feat:` | Adicionado |
| `fix:` | Corrigido |
| `perf:`, `refactor:` visível ao usuário | Alterado |
| qualquer coisa com impacto de segurança (`security:`, `fix(security):`, endurecimento) | **Segurança** |
| remoção de recurso | Removido |
| `chore:`, `ci:`, `docs:`, `test:` | normalmente fora, a não ser que interesse ao usuário |

Escreva para quem usa o app, em português, uma linha por item, dizendo o efeito e não o detalhe interno.

## 4. Atualizar o CHANGELOG.md

1. Mova os itens de `## [Não lançado]` para uma seção nova logo abaixo dela: `## [X.Y.Z] - AAAA-MM-DD` (data de hoje). Deixe `## [Não lançado]` vazia no topo.
2. Atualize os links no fim do arquivo:
   ```
   [Não lançado]: https://github.com/enrell/nexo/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/enrell/nexo/compare/vANTERIOR...vX.Y.Z
   ```
3. Confira que as notas saem certas (é exatamente o que vai para a release):
   ```bash
   node scripts/release-notes.mjs X.Y.Z
   ```

## 5. Subir a versão

```bash
npm version X.Y.Z --no-git-tag-version   # atualiza package.json e package-lock.json
```

## 6. Validar localmente

```bash
npm run build
npm audit --omit=dev --audit-level=high
node tests/e2e.mjs
```

Todas as etapas do e2e têm que passar. Se falhar por rede (relays públicos), rode de novo uma vez; se falhar de novo, investigue.

## 7. Commit e tag (no nome do usuário)

```bash
git add CHANGELOG.md package.json package-lock.json SECURITY.md
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "Nexo vX.Y.Z"
# se o usuário tiver chave de assinatura configurada (git config user.signingkey), use: git tag -s vX.Y.Z -m "Nexo vX.Y.Z"

# conferir autoria e ausência de co-autoria antes de enviar:
git log -1 --format='%an <%ae>%n%B'
git log "$(git describe --tags --abbrev=0 HEAD^)"..HEAD --format='%B' | grep -i 'co-authored-by\|claude' && echo "PARE: tem atribuição" || echo ok
```

## 8. Enviar

```bash
git push origin main
git push origin vX.Y.Z
```

## 9. Acompanhar o pipeline

```bash
gh run list --workflow release --limit 1
gh run watch "$(gh run list --workflow release --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

## 10. Conferir a release publicada

```bash
gh release view vX.Y.Z --json isDraft,isLatest,assets -q '{draft: .isDraft, latest: .isLatest, assets: [.assets[].name]}'
```

Tem que existir **uma única** release para a tag (`gh api repos/enrell/nexo/releases --jq '[.[] | select(.tag_name=="vX.Y.Z")] | length'` → `1`). Ela tem que estar `draft: false` e `latest: true`, e conter: `Nexo-Setup-X.Y.Z.exe`, `Nexo-Setup-X.Y.Z.exe.blockmap`, `latest.yml` e `SHA256SUMS.txt`. Verifique o atestado:

```bash
gh release download vX.Y.Z -p 'Nexo-Setup-*.exe' -D "$TMP/nexo-rel" --clobber
gh attestation verify "$TMP/nexo-rel/Nexo-Setup-X.Y.Z.exe" -R enrell/nexo
```

## Se algo der errado

- **O pipeline falhou antes de publicar** (a release ficou em rascunho ou nem existe): apague o rascunho e a tag, corrija, faça um commit novo e refaça a tag na mesma versão.
  ```bash
  gh release delete vX.Y.Z --yes --cleanup-tag   # só se ainda for rascunho!
  git tag -d vX.Y.Z
  ```
- **Duas releases para a mesma tag** (uma publicada sem o `.exe`/`latest.yml` e um rascunho com eles): baixe os arquivos do rascunho pela API (`gh api -H "Accept: application/octet-stream" repos/enrell/nexo/releases/assets/<id> > arquivo`), confira com o `SHA256SUMS.txt` e com `gh attestation verify`, apague o rascunho (`gh api -X DELETE repos/enrell/nexo/releases/<id>`) e envie os arquivos para a publicada (`gh release upload vX.Y.Z ...`). O workflow já cria o rascunho antes do electron-builder para evitar isso.
- **A release já foi publicada**: não apague nem mova a tag (os apps podem já ter baixado). Corrija e lance `X.Y.(Z+1)`.

## 11. Avisar o usuário

Mande o link da release (`https://github.com/enrell/nexo/releases/tag/vX.Y.Z`), o resumo das notas e lembre que quem já tem o Nexo instalado recebe a atualização sozinho, e quem é novo baixa o `Nexo-Setup-X.Y.Z.exe`.
