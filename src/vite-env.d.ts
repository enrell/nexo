/// <reference types="vite/client" />

type NexoSource = { id: string; name: string; isScreen: boolean; thumbnail: string; icon: string | null };
/** Estado da atualização automática, vindo do processo principal. */
type NexoUpdate = { status: "idle" | "checking" | "none" | "downloading" | "ready" | "error"; version?: string; percent?: number; message?: string };
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
