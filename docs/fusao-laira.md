# Laira no Nexo: o que vem, o que fica

Nota de projeto, novembro de 2026. Status: proposta, com o primeiro passo neste PR atrás de uma flag desligada.

O [laira](https://github.com/enrell/laira) faz voz e transmissão de jogo cifradas de ponta a ponta: captura nativa no Linux/Wayland, um SFU mediasoup que só repassa ciphertext e SFrame no cliente nativo e no navegador. O Nexo promete **sem servidor central**. Esta nota decide o que do laira entra no Nexo sem quebrar essa promessa.

## Decisão em uma frase

Vem **só a camada SFrame**, agora, reescrita conforme o RFC 9605 e usando as identidades e o canal autenticado do Nexo. O **SFU** é o próximo passo, mas só depois de medir a live e só como papel opcional de um membro. A **captura nativa**, o `laira-control`, a identidade, o chat e os arquivos do laira **não vêm**.

## Onde o P2P do Nexo deixa de escalar

| Mídia | Como é hoje | Custo por pessoa | Onde pesa |
|---|---|---|---|
| Voz | Malha: cada um manda o microfone para os outros N−1 | ~50–55 kbps por cópia (Opus ~32 kbps + cabeçalhos IP/UDP/RTP/SRTP), N−1 codificações e N−1 decodificações. Com 10 pessoas, ~450 kbps de upload | Banda não é o problema. CPU e número de fluxos começam a pesar acima de ~10–12 pessoas falando. Para grupos de amigos, a malha serve |
| Live | O transmissor manda direto para `streamSlots` espectadores (padrão 3, preset alto 4); os outros recebem de espectadores que retransmitem | Cada conexão tem **o próprio codificador** (o Chromium não divide codificador entre conexões). No preset alto (1080p60, 8 Mbps): 4 × 8 = 32 Mbps de upload e 4 codificações 1080p60 ao mesmo tempo | É aqui que quebra. O codificador da placa de vídeo tem vazão limitada (e as GeForce ainda limitam o número de sessões simultâneas); passando disso, a codificação vai para a CPU. Cada nível da árvore **decodifica e codifica de novo**: perde qualidade, soma latência e depende do upload de um amigo (4G/CGNAT costuma ser fraco) |

Na conta do PLAN.md do laira: 8 Mbps para 6 espectadores são 48 Mbps de upload direto. Com um SFU, o transmissor codifica e sobe **uma vez** (8 Mbps), e o SFU repassa sem decodificar. Na prática, o modelo atual deixa de servir numa live de alta qualidade com uns 4 espectadores ou mais. A voz só precisaria de SFU com mais de ~10–12 pessoas falando ao mesmo tempo.

## O que o laira tem de valor para o Nexo

| Parte do laira | Valor para o Nexo | Custo | Decisão |
|---|---|---|---|
| SFrame (cifra por quadro) | **Hoje, nenhum.** Todo salto da mídia do Nexo é um membro e já é DTLS-SRTP. É o pré-requisito para qualquer repassador que **não** seja membro (um SFU) não ver o conteúdo | Baixo: TypeScript + WebCrypto + Encoded Transform | **Vem agora** (este PR), só no áudio, atrás de flag |
| SFU mediasoup | Real nas lives (ver a tabela acima) | Alto: worker C++ (binário pré-compilado por plataforma), processo a mais, porta UDP alcançável. O mediasoup é ICE Lite e **não atravessa CGNAT** | **Próximo passo**, se a medição pedir |
| Captura nativa Wayland + áudio por app | Real **só no Linux**: hoje a live no Linux sai sem áudio (o `audio: "loopback"` do Chromium só existe no Windows) | Alto: Rust + FFmpeg + PipeWire, e o laira entrega RTP para um SFU, não para o P2P | **Não agora.** No Linux, o pedaço barato (áudio de um app via `pw-record --target`, como o laira faz, virando uma trilha no renderer) pode vir sozinho |
| `laira-control`, identidade, convites, épocas, mailbox | Duplica o que o Nexo já tem (log assinado, aprovação, ban, admins) e traz uma **autoridade central**: o controle do admin gera e sela cada época de chaves | — | **Não vem** |
| Recuperação de admin 2-de-3 | Boa ideia que o Nexo não tem | Médio | Tema separado, fora desta fusão |
| Chat e arquivos | O Nexo já tem, P2P e assinados | — | **Não vem** |
| Failover de SFU com rota assinada | Só faz sentido depois do SFU | — | Depois. No Nexo seria um evento assinado no log, não um serviço |

## Como um SFU cabe em "sem servidor central"

- **É um papel de um membro, não um servidor do projeto.** Quem hospeda é o dono do servidor ou quem abre a live, por escolha (opt-in), do mesmo jeito que hoje alguém ajuda retransmitindo.
- **O SFU só vê ciphertext.** As chaves SFrame andam pelo canal de dados entre membros, que já é autenticado pelo handshake Ed25519 com channel binding. O SFU nunca recebe chave nem o log do servidor.
- **Cair o SFU não derruba nada.** Comunidade, chat e chaves continuam P2P. A live volta para a árvore de hoje.
- **Limites, sem esconder:** o SFU precisa de endereço alcançável (IPv4 público com a porta aberta pelo UPnP/NAT-PMP que o Nexo já faz, IPv6 ou uma VPS; atrás de CGNAT não funciona). Ele vê metadados (IPs de todos, tamanhos, tempos, cabeçalhos RTP, quem está conectado). E rodar o mediasoup dentro do Electron de quem hospeda ainda precisa ser provado.

## O SFrame do laira não é o RFC 9605

Ao ler o código (`crates/media/src/sframe.rs` e `apps/web/src/sframe-worker.ts`), o formato é "inspirado no" RFC, não compatível com ele:

| | RFC 9605 | laira |
|---|---|---|
| Byte de configuração | `X\|K(3)\|Y\|C(3)`: `0x07` = KID 0 e CTR 7, sem bytes de contador | `X\|K(3)\|C(4)` com C = tamanho do contador − 1: `0x07` = contador de 8 bytes |
| Derivação | `HKDF-Extract("", base_key)`, rótulos `"SFrame 1.0 Secret key " + KID(8 bytes) + suíte(2 bytes)` | `HKDF(salt="SFrame 1.0", info="key"/"salt")`, sem KID nem suíte |
| KID | até 64 bits | 3 bits: no máximo 8 remetentes |

Consequência: o cliente nativo do laira e o Nexo não se entendem no SFrame. O Nexo segue o RFC e confere com os vetores do Apêndice C (`tests/unit/sframe.test.ts`). Se a captura nativa vier um dia, o laira é que muda, e os vetores já estão aqui.

## O primeiro passo (este PR)

**Configurações → Voz e vídeo → "Áudio cifrado com SFrame (experimental)"**, desligado por padrão, vale ao reabrir o app.

- **Chaves:** cada pessoa sorteia a própria chave de envio (16 bytes + KID de 32 bits), nova a cada execução. Ela vai pelo canal de dados (`mkey`) **só para membros**, e só se eu também for membro. Pendentes e banidos nunca recebem. Não existe chave de grupo nem quem a distribua.
- **Combinação:** quem tem a flag e um Chromium com `RTCRtpScriptTransform` anuncia `sf` no hello. Numa conexão em que os dois lados anunciaram, **todo áudio** (voz, áudio da live e retransmissões) vai cifrado. Com quem não anunciou, nada muda, então versões antigas continuam funcionando.
- **Envio:** um único worker para todas as conexões, com um contador só. O mesmo microfone vai para cada amigo por uma conexão diferente, e nenhuma repete um nonce. Sem chave pronta, o quadro é descartado, nunca enviado em claro.
- **Recepção:** só vale a chave de quem está do outro lado daquela conexão. O KID é de quem o entregou primeiro, e quadro que não decifra é descartado.
- **Ban:** esquece a chave do banido e, se ele tinha a minha, troca a minha. A nova só passa a ser usada 1,5 s depois de distribuída (RFC 9605 §4.4.1), e a antiga ainda vale por 10 s para os quadros em trânsito.
- **Vídeo fica de fora.** O empacotador H.264 do Chromium lê as NAL units de dentro do quadro, e cifrar o quadro inteiro quebra isso (o laira contornou no envio nativo com um formato próprio). Vídeo cifrado só importa com SFU e entra junto com ele.

Isto **não acrescenta proteção** no P2P de hoje. Ele prova o encanamento (cripto conforme o RFC, chaves dirigidas pela identidade e pela moderação do Nexo, Encoded Transform no ponto certo da negociação) para o dia em que a mídia passar por quem não é membro.

Limites conhecidos do passo:
- A chave de envio é **uma por execução, para todos os servidores**: quem está comigo em dois servidores tem a mesma chave nos dois. Antes do SFU ela tem que passar a ser por servidor.
- Como em todo SFrame com chave simétrica por remetente, um membro que tem a minha chave poderia forjar quadros meus se tivesse por onde injetá-los. No P2P não tem.
- Custa ~9 kbps a mais por fluxo de áudio (cabeçalho de ~7 bytes + tag de 16 bytes a cada 20 ms). O RFC prevê suítes com tag curta para áudio (AES-CTR + HMAC, tag de 4 bytes), que o WebCrypto não tem pronta. Fica para quando a voz passar pelo SFU.
- O caminho WebRTC de verdade não roda nos testes unitários. Ele foi conferido à parte num Chromium 156 headless, com duas conexões do Nexo na mesma página e um tom de 440 Hz. Com a chave, o tom chega e o worker decifra todos os quadros. Sem a chave, chega silêncio e tudo é descartado. Sem o transform no receptor, também silêncio (o fio leva ciphertext). Com quem não anunciou, nada muda. Falta conferir no Electron 44, entre PCs reais e no teste ponta a ponta.

Arquivos: `src/lib/sframe.ts` (RFC 9605), `src/lib/mediakeys.ts` (chave de envio, oferta, regra de quem troca chave), `src/lib/sframe-transform.ts` (lógica do worker), `src/lib/sframe.worker.ts`, `src/lib/e2ee.ts` (liga tudo às conexões), ganchos em `rtc.ts` e `session.ts`.

## Próximos passos, em ordem

1. **Testar a flag entre 2–3 PCs** (voz e áudio de live, uma pessoa com a flag e outra sem, banir no meio) e acrescentar uma etapa no `tests/e2e.mjs`.
2. **Medir a live** no preset alto com 4–6 espectadores: CPU/GPU e upload de quem transmite, qualidade e atraso no segundo nível da árvore. É isso que decide se o SFU vale.
3. **Se valer, SFU de membro:** chave por servidor; mediasoup pré-compilado no processo principal de quem hospeda; entrada no SFU por assinatura Ed25519 de um membro (sem `laira-control`); vídeo cifrado; se o SFU cair, volta para a árvore.
4. **Linux, à parte:** áudio da live por app via PipeWire, sem SFU e sem FFmpeg.

## E o repositório do laira

Proposta: o laira **continua como está até a decisão do passo 3**. É a referência do SFU, da sinalização, do failover, da captura nativa e dos testes de interoperabilidade. Antes disso, vale corrigir no README a frase "SFrame (RFC 9605)" (ou implementar o RFC lá, com os vetores daqui). Se o SFU entrar no Nexo, o laira é **arquivado** (somente leitura), com o README apontando para cá, e a captura nativa fica lá como referência para o passo 4. Se o SFU não entrar, o laira segue como projeto próprio de streaming de jogo no Linux, sem pretensão de ser o motor do Nexo.

## Perguntas em aberto

- Quantas pessoas costumam assistir a uma live? Abaixo de ~4, o SFU não se paga.
- Quem hospedaria o SFU: o PC do dono, o de quem transmite ou uma VPS? Uma VPS de um membro ainda conta como "sem servidor central"?
- Alguém transmite do Linux? Isso decide a prioridade do passo 4.
- Arquivar o laira se o SFU entrar?
- A flag fica visível nas configurações (como neste PR) ou escondida até o passo 1 terminar?
