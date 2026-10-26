# Segurança do Nexo

O Nexo é um app de chat, voz e lives **sem servidor central**. Segurança e privacidade são requisitos, não extras: tudo é criptografado e seguro **por padrão**, desde o primeiro uso, sem precisar configurar nada.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública.** Use o [relato privado de vulnerabilidades do GitHub](https://github.com/enrell/nexo/security/advisories/new) (aba *Security* → *Report a vulnerability*).

- Inclua: versão, passos para reproduzir, impacto esperado e, se possível, uma prova de conceito.
- Resposta inicial em até **72 horas**; correção de falhas críticas o mais rápido possível, com uma release de segurança e crédito a quem reportou (se quiser).
- Pesquisa de boa-fé é bem-vinda. Não teste contra servidores ou contas de outras pessoas sem autorização.

## Versões suportadas

Só a **última versão** recebe correções de segurança. O app se atualiza sozinho; mantenha a atualização automática ligada.

| Versão | Suporte |
|---|---|
| última (`0.3.x`) | ✅ |
| anteriores | ❌ (protocolo incompatível; atualize) |

## Modelo de ameaça

### O que o Nexo protege

| Ameaça | Proteção |
|---|---|
| Alguém na rede (Wi-Fi, provedor) lendo ou alterando conversas, voz e vídeo | Todo o tráfego é WebRTC: **DTLS 1.2+** para dados e **SRTP** para mídia, sempre ligados. |
| Os relays públicos usados para "achar" os amigos lendo o que trocamos | Os relays (Nostr) só veem a sinalização WebRTC **cifrada com AES-GCM** derivada da senha do convite (via Trystero), e o nome da sala passa por hash. Depois da conexão, nada passa por eles. |
| Alguém que conhece o convite se colocar no meio da conexão (MITM) | **Channel binding**: no handshake cada peer assina com Ed25519 (desafio do outro + sala + impressão digital do próprio certificado DTLS + a do outro). Antes de trocar qualquer dado, conferimos que o certificado DTLS **real** da conexão é o assinado. Coberto por teste automatizado. |
| Se passar por outra pessoa | Cada usuário tem um par de chaves **Ed25519**; a chave pública é a identidade. O perfil vem de quem provou a posse da chave. Nomes repetidos ganham um sufixo da chave (`Nome #abcd`). Dá para comparar o **número de segurança** (como no Signal) em *Verificar identidade*. |
| Forjar, alterar ou apagar mensagens de outros | Cada mensagem, edição, reação e ação de moderação é um **evento assinado** (Ed25519 sobre o conteúdo canônico; o ID é o SHA-256). Eventos inválidos são descartados. Só o autor edita; só o autor ou um admin apaga. |
| Estranho entrando com um convite vazado | **Aprovação de entrada ligada por padrão**: quem entra fica "na porta" sem receber histórico, mídia, digitação nem lista de quem está na voz até um admin aprovar. Admins podem **banir** (todos recusam a conexão do banido) e **renovar o convite** (quem está online migra para uma sala nova). |
| Ex-admin "voltando no tempo" para forjar moderação com data antiga | Ações de moderação de quem não é admin no momento do recebimento ficam em quarentena e só valem se o autor voltar a ser admin. |
| Inundação/negação de serviço por um peer | Limite de taxa por peer, tamanho máximo de evento (24 KB) e de mensagem recebida (32 MB), validação estrita de tipos. |
| Roubo do PC desligado ou cópia da pasta do app | **Tudo no disco é cifrado com AES-256-GCM**: chave de identidade, perfil, convites, configurações, mensagens, membros, anexos e a imagem de fundo do tema. A chave do cofre fica protegida pelo **DPAPI** (Windows): só abre na sua conta de usuário, naquele PC. Cada registro tem um "dado associado" com o seu ID, então registros não podem ser trocados de lugar. |
| Perda do PC | Backup da conta **cifrado com senha** (PBKDF2-SHA256, 600 mil iterações + AES-256-GCM). |
| Página maliciosa ou conteúdo de mensagem executando código | Renderer em **sandbox**, `contextIsolation`, sem Node, **CSP** estrita (`script-src 'self' 'wasm-unsafe-eval'`: o segundo só deixa compilar o WebAssembly do redutor de ruído; `eval` e scripts inline seguem bloqueados), interface servida por protocolo próprio (`nexo-app://`, não `file://`), navegação e novas janelas bloqueadas, sem `webview`, IPC só aceito da nossa página e com argumentos validados. Markdown é renderizado como texto (sem HTML). |
| Permissões abusivas | Só câmera, microfone, captura de tela, notificações e tela cheia, e só para a página do app. HID/USB/serial negados. |
| Binário adulterado | **Electron fuses**: `RunAsNode` e `NODE_OPTIONS` desligados, inspeção por linha de comando desligada, integridade do `app.asar` validada, só carrega o app de dentro do asar, `file://` sem privilégios extras. DevTools desligado na versão instalada. |
| Atualização maliciosa | Atualizações só por HTTPS do GitHub Releases, conferidas pelo **SHA-512** do `latest.yml` **e por uma assinatura Ed25519 do projeto** (versão + SHA-512 do instalador), verificada pelo app antes de instalar, sem downgrade. A chave privada existe só como segredo do workflow de release: quem trocar os arquivos da release (ex.: token do GitHub vazado) não consegue produzir uma atualização que o app aceite. Cada instalador também tem **atestado de procedência** (GitHub Artifact Attestations) e o `SHA256SUMS` publicado na release. |
| SSRF pela prévia de links | Prévias são **opt-in** (desligadas por padrão). Quando ligadas: só `https`, sem IP literal nem porta, DNS resolvido e **IPs privados/loopback/link-local recusados no momento da conexão** (anti DNS-rebinding), até 3 redirecionamentos, 512 KB e 6 s. |
| Portas abertas no roteador (UPnP/NAT-PMP) | Só UDP, só para o próprio PC (o roteador recebe o IP local da interface do gateway; outro IP é recusado), só para portas que o WebRTC acabou de abrir, no máximo 64 por vez, concessão de 30 min renovada enquanto a conexão existe, removidas ao fechar a conexão e ao sair do app. Atrás dessas portas só existe o WebRTC: sem a credencial ICE da sessão e o DTLS com o certificado assinado, o pacote é descartado. As respostas do roteador são tratadas como entrada hostil: SSDP só do gateway, descrição e SOAP só por HTTP no próprio gateway, sem redirecionamento, 256 KB e 3 s. Desligável em Configurações → Rede. |
| Arquivos executáveis recebidos | Aviso antes de salvar `.exe`, `.bat`, `.ps1`, `.lnk`, `.msi`, `.js` e outros tipos perigosos. Anexos são conferidos pelo hash. |

### Padrões conservadores (o que vaza só se você ligar)

| Configuração | Padrão | Por quê |
|---|---|---|
| Prévia de links e imagens externas | **desligada** | Buscar a prévia revela seu IP ao site. |
| Fontes e fundos do tema | **locais** | Fontes vêm empacotadas e os fundos prontos são gerados em CSS: a interface não acessa nenhum servidor externo. |
| Texto da mensagem nas notificações | **desligado** | Notificações ficam no histórico do Windows. |
| Aprovação de novos membros | **ligada** em servidores novos | Convite vazado não basta para entrar. |
| Esconder IP (só TURN) | desligado | Exige um servidor TURN seu. |
| Abrir portas no roteador (UPnP/NAT-PMP) | **ligado** | Sem isso, amigos atrás de CGNAT não conectam em você. Com *Esconder meu IP* ligado, nada é aberto (só TURN). |

### O que o Nexo **não** protege (limitações conhecidas)

- **Seu IP é visível para quem está conectado com você**, incluindo o IP da rede local e o endereço IPv6 (os candidatos ICE vão com o endereço real, não com nomes mDNS, porque no IPv6 é ele que conecta direto). É uma consequência do P2P. Para esconder, configure um TURN e ligue *Esconder meu IP*. Os relays Nostr também veem o IP de quem procura uma sala (não o conteúdo).
- **Metadados para os relays**: eles sabem que alguém do seu IP está procurando uma sala (identificada por hash), e quando.
- **Membros são confiáveis com o que recebem**: quem foi aprovado vê e guarda o histórico. Um espectador que retransmite uma live recebe o vídeo decifrado (é como funciona a retransmissão). Ninguém de fora vê.
- **Um PC comprometido** (malware rodando na sua conta) consegue o que você consegue: o DPAPI protege contra cópia dos arquivos, não contra código rodando como você.
- **Convite = credencial de entrada.** Com a aprovação ligada, ele só deixa a pessoa "na porta". Com a aprovação desligada, é a senha do servidor.
- **Quem estava offline** quando o convite foi renovado precisa receber o convite novo.
- **Sem sigilo futuro (forward secrecy) no histórico em repouso**: quem tiver a sua chave do cofre e os arquivos lê o histórico guardado. A comunicação em trânsito (DTLS) tem forward secrecy.
- **Chave de atualização**: quem controlar o workflow de release (push de tags ou edição do workflow) também usa a chave. Se ela vazar, publique uma versão que passe a aceitar uma chave nova (`PUBLIC_KEYS` em `electron/updatesig.cjs` aceita várias) e aposente a antiga; se for perdida, quem já instalou precisa reinstalar à mão.
- **Código não assinado pela Microsoft** (ainda): o Windows SmartScreen avisa na primeira instalação (baixada pelo navegador). As atualizações automáticas são baixadas pelo próprio app e não passam por esse aviso. Confira o `SHA256SUMS` e o atestado de procedência da release (`gh attestation verify Nexo-Setup-X.Y.Z.exe -R enrell/nexo`).
- O áudio do PC numa live pode incluir o som de outros apps; transmita uma janela específica para evitar.

## Inventário criptográfico

| Uso | Algoritmo |
|---|---|
| Identidade e assinaturas | Ed25519 (WebCrypto) |
| IDs de eventos e anexos | SHA-256 |
| Transporte | WebRTC DTLS 1.2+ (ECDSA P-256, certificado por execução) + SRTP |
| Sinalização nos relays | AES-GCM com chave derivada da senha do convite (Trystero) |
| Dados em repouso | AES-256-GCM, IV aleatório de 96 bits por registro, AAD = tipo + ID |
| Chave do cofre | 256 bits aleatórios, protegidos pelo `safeStorage` do Electron (DPAPI) |
| Backup da conta | PBKDF2-SHA256 (600.000 iterações, sal de 128 bits) + AES-256-GCM |
| Número de segurança | SHA-256 iterado 1024× sobre as duas chaves públicas ordenadas |
| Convite | ID de sala (100 bits) + senha (120 bits) + dono + ID do servidor |

## Processo de desenvolvimento

- **CI** em todo push/PR: typecheck, build, `npm audit` das dependências de produção e teste ponta a ponta com várias instâncias reais (inclui ataque de intermediário, conteúdo cifrado em disco e backup com senha errada).
- **CodeQL** (análise estática) em todo push/PR e semanalmente.
- **Dependabot** para dependências npm e GitHub Actions; Actions fixadas por hash de commit.
- Releases só por tag, gerando instalador com atestado de procedência e `SHA256SUMS`.

Mudou algo que afeta o modelo de ameaça? Atualize este arquivo no mesmo PR.
