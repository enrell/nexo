# Nexo

Chat de texto, voz e lives entre amigos, com cara de Discord e **sem servidor central**. Tudo criptografado e seguro por padrão — veja [SECURITY.md](SECURITY.md).

[![ci](https://github.com/enrell/nexo/actions/workflows/ci.yml/badge.svg)](https://github.com/enrell/nexo/actions/workflows/ci.yml) [![codeql](https://github.com/enrell/nexo/actions/workflows/codeql.yml/badge.svg)](https://github.com/enrell/nexo/actions/workflows/codeql.yml)

## Instalar

Baixe o `Nexo-Setup-<versão>.exe` da [última release](https://github.com/enrell/nexo/releases/latest). Ele instala com um clique (sem pedir administrador), cria atalhos e abre o app. Depois disso o Nexo abre em menos de 1 s e se atualiza sozinho.

O instalador ainda não é assinado digitalmente, então o Windows SmartScreen avisa: clique em *Mais informações → Executar assim mesmo*. Para conferir que o arquivo é o publicado pelo pipeline: `gh attestation verify Nexo-Setup-<versão>.exe -R enrell/nexo` (ou compare com o `SHA256SUMS.txt` da release).

## Como usar

1. Escolha um nome. Sua conta é uma chave criptográfica criada no seu PC.
2. **+** → *Criar servidor* → menu do servidor → *Convidar amigos* → mande o link `nexo://join/...` (ou o código).
3. Quem entrar fica **aguardando aprovação**. Você (ou um admin) clica em **Aprovar** na lista de membros. Para ter certeza de que é a pessoa certa, use *Verificar identidade* e comparem o número de segurança.
4. *Sala de voz* para conversar e **Transmitir** para fazer live.

## Desenvolvimento

```bash
npm install
npm run dev        # Vite + Electron com hot reload
npm run test:e2e   # 21 etapas com várias instâncias reais conectadas por P2P
npm run dist       # gera release/Nexo-Setup-<versão>.exe (sem publicar)
npm run icons      # regenera build/icon.png e build/tray*.png a partir de public/logo.svg
```

### Publicar uma versão

Releases saem **só pelo GitHub Actions**, a partir de uma tag `vX.Y.Z`: o pipeline confere que a tag bate com o `package.json` e com o `CHANGELOG.md`, roda os testes, gera o instalador, publica o `SHA256SUMS.txt` e o atestado de procedência e só então libera a release (os apps instalados se atualizam sozinhos). O passo a passo completo, com versionamento semântico e changelog, está em [`.claude/skills/release/SKILL.md`](.claude/skills/release/SKILL.md).

### Pipelines

| Workflow | Quando | O que faz |
|---|---|---|
| `ci` | push em `main` e PRs | typecheck, build, `npm audit` (produção), e2e, instalador como artefato |
| `release` | tag `vX.Y.Z` | tudo do CI + publica a release com notas do CHANGELOG, SHA256SUMS e atestado |
| `codeql` | push, PRs e semanal | análise estática de segurança (`security-extended`) |
| Dependabot | semanal | atualizações de dependências npm e Actions (fixadas por hash) |

## O que tem

- **Chat**: markdown (negrito, itálico, código, spoiler, citação), @menções com notificação, responder, editar (↑), apagar, reações, emojis, imagens e arquivos de até 25 MB (colar, arrastar ou clipe), prévia de links e YouTube, "digitando…", divisor de novas mensagens, busca no canal, mensagens pendentes quando ninguém está online.
- **Voz**: escolha de microfone, saída e câmera, teste de microfone, volume de entrada e saída, detecção de voz automática ou manual, **push-to-talk global** (funciona dentro do jogo, aceita botões laterais do mouse), supressão de ruído, eco e ganho, anel verde em quem fala, volume individual por pessoa (0–200%), "mutar para mim", sons de entrar, sair e mutar.
- **Live**: tela, janela ou câmera com áudio do PC, presets de qualidade, codec por placa de vídeo (H.264), miniatura ao passar o mouse, lista de espectadores, modo teatro (T), tela cheia (F), janela flutuante, estatísticas, retransmissão em árvore entre espectadores.
- **Moderação**: aprovação de novos membros (ligada por padrão), o dono nomeia admins, admins banem (o banido é recusado por todos), gerenciam canais e renovam o convite.
- **Segurança**: dados locais cifrados (AES-256-GCM, chave protegida pelo Windows), mensagens assinadas (Ed25519), handshake com channel binding contra intermediário, verificação de identidade por número de segurança, backup da conta com senha, prévias de link e conteúdo de notificação desligados por padrão. Detalhes em [SECURITY.md](SECURITY.md).
- **Sistema**: instalador de um clique, atualização automática, links `nexo://join/...` que abrem o app, bandeja (fechar mantém a voz), atalhos globais de mutar e ensurdecer, ausente automático, notificações do Windows, contador na barra de tarefas, Ctrl+K para trocar de servidor ou canal, backup e restauração da conta, exportar diagnóstico.

## Como funciona sem servidor

| Parte | Como é feito |
|---|---|
| Encontrar os amigos | Relays públicos do Nostr (via [Trystero](https://github.com/dmotz/trystero), 6 relays em paralelo) só trocam a sinalização WebRTC, criptografada com a senha do convite. Depois disso nada passa por eles. |
| Identidade | Cada usuário tem um par de chaves Ed25519 guardado só no PC dele (cifrado). No handshake cada peer assina um desafio junto com a impressão digital do seu certificado DTLS, e a conexão é recusada se o certificado real não bater. Banidos são recusados. |
| Chat | Log de **eventos assinados** (mensagem, edição, reação, cargo, ban…) que todo membro guarda (IndexedDB) e aplica com as mesmas regras, então todos chegam ao mesmo estado. Quem chega compara resumos por dia e recebe só o que falta. Ninguém consegue editar ou apagar mensagem de outro, nem se passar por admin. |
| Anexos | Ficam no banco local de quem tem. Quem não tem pede a qualquer peer online e confere pelo hash. |
| Live | Quem transmite manda direto para *N* espectadores; os outros recebem de espectadores que retransmitem. Se um retransmissor cai, quem dependia dele reconecta sozinho. |
| Voz | Malha completa: cada um manda o microfone (já processado) para os outros da sala. |

## Limitações conhecidas

- **NAT restritivo** (alguns 4G/CGNAT): se dois amigos nessa situação não conectarem, configure um TURN em *Configurações → Rede*.
- **Convite renovado**: quem estava offline na hora precisa do convite novo.
- **Histórico**: só existe nos PCs dos membros. Se ninguém que tem uma mensagem estiver online, quem entrar não a recebe até alguém aparecer.
- **Áudio do PC na live** (Windows): captura tudo o que toca. O Nexo pede ao Chromium para excluir o próprio áudio (voz dos amigos), mas, se ela aparecer, transmita uma janela em vez da tela inteira ou use fone.
- **Versões anteriores à 0.3** não conversam com a 0.3 (protocolo novo, com channel binding). Atualize e crie um servidor novo.
- A qualidade da live começa mais baixa e sobe em uns 20–30 s, enquanto o WebRTC mede a banda.

## Estrutura

- `electron/main.cjs`: janela, bandeja, protocolo `nexo://`, atalhos globais, push-to-talk (uiohook), auto-update, prévia de links, captura de tela
- `src/lib/session.ts`: uma sala P2P (handshake, log de eventos, sync, anexos, live em árvore, voz)
- `src/lib/derive.ts`: regras que transformam o log de eventos no estado do servidor
- `src/lib/vault.ts`, `storage.ts`, `db.ts`: cofre (AES-256-GCM), armazenamento local e banco cifrados
- `src/lib/identity.ts`, `rtc.ts`, `audio.ts`: chaves e backup, certificado DTLS/codecs, motor de voz
- `src/lib/app.ts`: estado global (servidores, perfil, configurações, notificações)
- `src/components/`: interface
- `tests/e2e.mjs`: teste ponta a ponta
