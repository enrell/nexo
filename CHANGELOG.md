# Changelog

Todas as mudanças relevantes do Nexo ficam aqui. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Categorias: **Adicionado**, **Alterado**, **Obsoleto**, **Removido**, **Corrigido**, **Segurança**.

## [Não lançado]

### Alterado
- Interface nova, "Constelação": uma grade de 3 colunas com o topo alinhado (você · servidores · busca), servidores como planetas numa barra horizontal, nome do servidor no topo da coluna de canais e mensagens em balões.
- Painel contextual à direita: "Agora" (órbita da sala de voz, lives, tripulação) e, no mesmo lugar, perfil, membros, busca, personalização e notificações, sem janelas flutuantes.
- Busca global no topo (Ctrl+K) com canais, pessoas, lives e mensagens, no lugar da troca rápida.
- Ícones Phosphor no lugar dos desenhados à mão; fontes Inter e Space Grotesk empacotadas no app.

### Adicionado
- Personalização: 6 cores de destaque, 6 fundos e imagem própria, opacidade dos painéis, cantos e densidade.
- Planeta "Início" com visão geral dos servidores e do que está acontecendo agora.
- Perfil no painel com verificação de identidade, volume individual e moderação.

### Segurança
- A imagem de fundo escolhida pelo usuário é reduzida e guardada cifrada no banco local; os fundos prontos são gerados em CSS (nenhum download).
- Fontes empacotadas: nada é carregado do Google Fonts ou de outro servidor.

## [0.3.0] - 2026-10-18

Primeira versão pública. Tudo criptografado e seguro por padrão.

### Segurança
- Dados locais cifrados com AES-256-GCM (identidade, perfil, convites, configurações, mensagens, membros e anexos), com a chave do cofre protegida pelo DPAPI do Windows.
- Handshake com *channel binding*: a assinatura Ed25519 cobre a impressão digital do certificado DTLS, e a conexão é recusada se o certificado real não bater. Isso impede um intermediário que conheça o convite.
- Aprovação de novos membros ligada por padrão: quem entra com o convite fica "na porta" até um admin aprovar, sem receber histórico, mídia ou presença.
- Verificação de identidade com número de segurança (como no Signal) e sufixo de chave em nomes repetidos.
- Backup da conta cifrado com senha (PBKDF2-SHA256 600k + AES-256-GCM).
- Validação estrita de eventos recebidos: limite de tamanho, tipos conhecidos, autor banido descartado e quarentena para moderação "retroativa" de quem não é admin.
- Limite de taxa por peer e de tamanho de mensagem recebida.
- Electron endurecido: sandbox, CSP estrita, protocolo próprio `nexo-app://` no lugar de `file://`, IPC validado por origem, permissões mínimas, DevTools desligado na versão instalada, fuses (`RunAsNode`, `NODE_OPTIONS` e inspect desligados; integridade do asar).
- Prévia de links passa a ser opt-in e é protegida contra SSRF (IPs privados recusados no momento da conexão).
- Notificações sem o texto da mensagem por padrão.
- Aviso antes de salvar anexos executáveis.
- Opção de esconder o IP usando só TURN.
- Releases com atestado de procedência (GitHub Artifact Attestations) e `SHA256SUMS`.

### Adicionado
- `SECURITY.md` com modelo de ameaça, inventário criptográfico e canal de relato de vulnerabilidades.
- Seção "Privacidade e segurança" nas configurações.
- Pipeline de CI (typecheck, build, auditoria de dependências, testes ponta a ponta), CodeQL, Dependabot e release automatizada por tag.

### Alterado
- Protocolo P2P v3: não é compatível com versões anteriores.

## [0.2.0] - 2026-10-18

### Adicionado
- Identidade Ed25519 e log de eventos assinados sincronizado entre membros.
- Anexos P2P, reações, respostas, edição, menções, prévias, "digitando…" e busca.
- Voz com escolha de dispositivos, push-to-talk global e indicador de quem fala.
- Live com presets, modo teatro, janela flutuante, estatísticas e retransmissão em árvore.
- Moderação: dono, admins, banimento e renovação de convite.
- Configurações em tela cheia, bandeja, links `nexo://`, atalhos globais, instalador de um clique e atualização automática.

## [0.1.0] - 2026-10-18

### Adicionado
- Demonstração inicial: chat, voz e live P2P com interface parecida com a do Discord.

[Não lançado]: https://github.com/enrell/nexo/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/enrell/nexo/releases/tag/v0.3.0
