# Changelog

Todas as mudanças relevantes do Nexo ficam aqui. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Categorias: **Adicionado**, **Alterado**, **Obsoleto**, **Removido**, **Corrigido**, **Segurança**.

## [Não lançado]

## [0.4.0] - 2026-10-23

### Segurança
- A CSP do app passou a liberar `'wasm-unsafe-eval'` (só compilar WebAssembly, para o redutor de ruído); `eval` e scripts inline continuam bloqueados.
- Atualização automática verificada pela chave do projeto (Ed25519), já que o instalador não tem a assinatura da Microsoft: o CI assina versão + SHA-512 do instalador no `latest.yml` e o app recusa o que não confere, antes de rodar o instalador. O workflow de release falha se o segredo `UPDATE_SIGNING_KEY` faltar ou for de outra chave.
- Um membro não consegue mais inutilizar um servidor assinando uma reação com um emoji chamado `constructor`, `toString` etc. (o estado do servidor não era calculado e isso ficava gravado para sempre). O estado também ignora um evento que falhe, em vez de quebrar por inteiro.
- Eventos de rede são validados pela forma (tipos, tamanhos, formatos) antes de entrar no histórico: antes, uma mensagem assinada com `att: [{}]` derrubava a tela de todos a cada abertura do app. Eventos já guardados também passam pela validação ao carregar.
- Atualizações de presença dos peers (`state`) aceitam só chaves conhecidas e validadas: antes um peer podia trocar o próprio `pub` pelo de um admin, forçar a miniatura a ser uma URL externa (vazando o IP de quem assistisse) ou mandar campos de tipo errado que quebravam o painel direito.
- A prévia de links não usa mais um regex quadrático: uma página com milhares de `<meta` travava o app por minutos. O guarda anti-SSRF passou a cobrir todas as faixas reservadas e as formas alternativas de IPv6 (`::ffff:7f00:1`, `0:0:…:1`, NAT64, 6to4).
- Convites (`nexo://join/…`) recusam campos gigantes ou de tipo errado.
- Um registro local que não pode ser lido vai para a quarentena em vez de ser apagado (a identidade pode estar nele).

### Adicionado
- Redutor de ruído por IA na voz: **DeepFilterNet3** compilado do código oficial para WebAssembly e executado num AudioWorklet, no próprio computador (~40 ms de atraso, ~17% de um núcleo). Corta teclado, ventilador, zumbido e vozes ao fundo muito melhor que o do navegador. Se não carregar, o app volta sozinho para o do navegador e avisa. Os arquivos (WASM de 11 MB e modelo de 8 MB, com `SHA256SUMS`, licenças e `scripts/build-denoise.sh` para recompilar com o mesmo resultado, byte a byte) vão no instalador: nada é baixado de fora.
- Atualização no estilo do Discord: instala em silêncio e reabre o app, com progresso, erros em português e *Procurar atualizações* em Configurações → Sobre.
- Suíte de testes unitários (Vitest, ~400 testes) com cobertura mínima no CI, verificação de mutação (`npm run test:mutation`) e `ErrorBoundary`: um erro ao desenhar uma conversa mostra um aviso com "Tentar de novo" em vez de derrubar o app.

### Corrigido
- Live de câmera não cai mais à toa quando a câmera falha por um instante: o app tenta reabrir por alguns segundos e, se a câmera escolhida sumiu, usa outra.
- Ctrl+K funciona também em janelas estreitas (a busca abre na gaveta).
- Em janelas com menos de 1060 px de largura o painel da direita sumia, e com ele os pedidos de entrada: um admin numa tela pequena não conseguia aprovar ninguém ("Ver pedidos" não fazia nada). Agora o painel abre como gaveta por cima do chat, e um botão no topo do canal mostra o "Agora".
- Negrito com itálico dentro (`**negrito *itálico* dentro**`) saía com asteriscos soltos.
- Extração de prévias de links ignorava `<META>` em maiúsculas e entidades numéricas (`&#233;`).

### Alterado
- Interface nova, "Constelação": uma grade de 3 colunas com o topo alinhado (você · servidores · busca), servidores numa barra horizontal, nome do servidor no topo da coluna de canais e mensagens em balões.
- Visual sem cara de template: colunas coladas e planas, separadas só pelo tom (sem cartões com borda, caixas dentro de caixas, degradês, fundo estrelado ou planeta girando); uma cor de destaque só (padrão Argila) sobre um tom base quente; superfícies, menus e campos derivam do fundo escolhido; só Inter nas fontes; novo logo chapado. O tema salvo de versões anteriores volta ao padrão.
- Painel contextual à direita: "Agora" (órbita da sala de voz, lives, tripulação) e, no mesmo lugar, perfil, membros, busca, personalização e notificações, sem janelas flutuantes.
- Busca global no topo (Ctrl+K) com canais, pessoas, lives e mensagens, no lugar da troca rápida.
- Ícones Phosphor no lugar dos desenhados à mão; fonte Inter empacotada no app.

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

[Não lançado]: https://github.com/enrell/nexo/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/enrell/nexo/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/enrell/nexo/releases/tag/v0.3.0
