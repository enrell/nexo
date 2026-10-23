export type Status = "online" | "idle" | "dnd";

export type Profile = {
  /** = chave pública Ed25519 */
  userId: string;
  name: string;
  color: string;
  /** data URL 128x128 (jpeg) */
  avatar?: string;
  status: Status;
  /** Quantas pessoas eu aceito retransmitir uma live. 0 = não ajudo. */
  relaySlots: number;
};

export type Quality = "480p30" | "720p30" | "720p60" | "1080p30" | "1080p60" | "1440p60";
export type Codec = "auto" | "h264" | "vp9" | "vp8" | "av1";
export type StreamPreset = "low" | "medium" | "high" | "custom";

export type Settings = {
  // voz e vídeo
  inputDevice: string;
  outputDevice: string;
  videoDevice: string;
  inputVolume: number; // %
  outputVolume: number; // %
  vadMode: "auto" | "manual" | "ptt";
  vadThreshold: number; // dB (-100..0)
  pttKey: string; // nome da tecla (KeyboardEvent.code), ex.: "KeyV"
  pttDelay: number; // ms após soltar
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  // transmissão
  preset: StreamPreset;
  quality: Quality;
  bitrate: number; // kbps por espectador
  streamSlots: number;
  contentHint: "motion" | "detail";
  codec: Codec;
  // notificações
  notifyDesktop: boolean;
  notifySounds: boolean;
  notifyMode: "all" | "mentions" | "none";
  mutedServers: string[];
  mutedChannels: string[];
  uiSounds: boolean;
  // aparência
  fontScale: number; // %
  zoom: number; // %
  // tema
  themeRev: number; // versão do tema salvo (ver THEME_REV em theme.ts)
  themeAccent: string; // id da paleta de destaque
  themeBg: string; // id do fundo ou "custom" (imagem do usuário, guardada cifrada)
  panelAlpha: number; // 55..100 (% de opacidade dos painéis)
  radius: number; // px
  density: "compact" | "normal" | "airy";
  ctxCollapsed: boolean; // painel contextual (direita) recolhido
  // atalhos globais (Electron accelerator)
  keyMute: string;
  keyDeafen: string;
  // rede
  turnUrl: string;
  turnUser: string;
  turnPass: string;
  relayUrls: string; // um por linha; vazio = padrão
  // sistema
  closeToTray: boolean;
  launchAtLogin: boolean;
  linkPreviews: boolean;
  /** mostrar o texto da mensagem nas notificações do Windows */
  notifyPreview: boolean;
  /** só conectar via TURN: os outros não veem seu IP (exige TURN configurado) */
  relayOnly: boolean;
};

export type Channel = { id: string; name: string };

export type ServerInfo = {
  /** id estável do servidor (não muda quando o convite é refeito) */
  sid: string;
  roomId: string;
  password: string;
  /** chave pública de quem criou (dono). Vazio em servidores antigos. */
  owner: string;
  name: string;
  channels: Channel[];
  joinedAt: number;
};

export type Attachment = { id: string; name: string; mime: string; size: number; w?: number; h?: number };

export type EventBody =
  | { k: "msg"; ch: string; text: string; n?: string; reply?: string; att?: Attachment[] }
  | { k: "edit"; target: string; text: string }
  | { k: "del"; target: string }
  | { k: "react"; target: string; emoji: string; on: boolean }
  | { k: "role"; user: string; role: "admin" | "member" }
  | { k: "ban"; user: string; on: boolean; reason?: string }
  | { k: "chan"; id: string; name: string; del?: boolean }
  | { k: "name"; name: string }
  | { k: "move"; r: string; p: string }
  | { k: "admit"; user: string; on: boolean }
  | { k: "policy"; approval: boolean };

/** Evento assinado: a unidade que é guardada por todos e sincronizada. */
export type SignedEvent = { id: string; a: string; ts: number; b: EventBody; s: string };
export type StoredEvent = SignedEvent & { srv: string; pending?: boolean };

export type MsgView = {
  id: string;
  ch: string;
  author: string;
  fallbackName?: string;
  ts: number;
  text: string;
  reply?: string;
  att?: Attachment[];
  edited?: number;
  deleted: boolean;
  reactions: Record<string, string[]>;
  pending?: boolean;
};

export type Member = { srv: string; pub: string; name: string; color: string; avatar?: string; lastSeen: number };

export type LiveInfo = {
  title: string;
  kind: "screen" | "camera";
  startedAt: number;
  viewers: number;
  viewerKeys?: string[];
  audio: boolean;
};

export type PeerInfo = {
  pub: string;
  profile?: Profile;
  live?: LiveInfo | null;
  thumb?: string;
  inVoice?: boolean;
  muted?: boolean;
  deaf?: boolean;
  rtt?: number;
  relayed?: boolean;
};

export type WatchState = {
  origin: string;
  parent: string | null;
  stream: MediaStream | null;
  status: "connecting" | "playing" | "failed";
  error?: string;
};
