/// <reference types="vite/client" />

type NexoSource = { id: string; name: string; isScreen: boolean; thumbnail: string; icon: string | null };
/** Estado da atualização automática, vindo do processo principal. */
type NexoUpdate = { status: "idle" | "checking" | "none" | "downloading" | "ready" | "error"; version?: string; percent?: number; message?: string };
/** Portas abertas no roteador (UPnP/NAT-PMP). "cgnat": o roteador respondeu, mas o IP externo dele não é público. */
type NexoPortMapStatus = { state: "off" | "searching" | "upnp" | "natpmp" | "cgnat" | "none"; gateway?: string; externalIp?: string | null; mapped?: number; via?: string };
type NexoPreview = { title: string; description: string; image: string | null; site: string } | null;

interface Window {
  /** Exposto pelo preload do Electron (ausente no navegador comum). */
  nexo?: {
    platform: string;
    /** ganchos de teste/depuração (nunca no app instalado) */
    debug: boolean;
    getVaultKey: () => Promise<string>;
    resetVault: () => Promise<void>;
    getSources: () => Promise<NexoSource[]>;
    selectSource: (id: string, audio: boolean) => Promise<void>;
    getPendingUrl: () => Promise<string | null>;
    getIdleSeconds: () => Promise<number>;
    getVersion: () => Promise<string>;
    fetchPreview: (url: string) => Promise<NexoPreview>;
    portMap: (ip: string, port: number) => Promise<{ ip: string; port: number } | null>;
    portMapRelease: (port: number) => Promise<void>;
    portMapStatus: () => Promise<NexoPortMapStatus>;
    /** credenciais temporárias do TURN da Cloudflare (o token fica no processo principal) */
    cfTurn: (keyId: string, token: string) => Promise<{ ok: true; iceServers: RTCIceServer[]; ttl: number } | { ok: false; error: string }>;
    installUpdate: () => Promise<void>;
    checkUpdate: () => Promise<void>;
    setConfig: (c: { closeToTray: boolean; launchAtLogin: boolean; keyMute: string; keyDeafen: string; pttKey: string; zoom: number }) => void;
    setBadge: (count: number, dataUrl?: string) => void;
    focus: () => void;
    onShortcut: (cb: (name: "mute" | "deafen" | "ptt", down: boolean) => void) => () => void;
    onOpenUrl: (cb: (url: string) => void) => () => void;
    onUpdate: (cb: (u: NexoUpdate) => void) => () => void;
    onTray: (cb: (action: "mute" | "deafen") => void) => () => void;
  };
}
