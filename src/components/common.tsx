import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import {
  ArrowBendUpLeft,
  Bell,
  BellSlash,
  CaretDown,
  CellSignalFull,
  ChartBar,
  Copy,
  CornersOut,
  Crown,
  DownloadSimple,
  Eye,
  FileText,
  GearSix,
  Hash,
  Headphones,
  House,
  type IconWeight,
  LinkSimple,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  Paperclip,
  PencilSimple,
  PhoneX,
  PictureInPicture,
  Plus,
  ProjectorScreen,
  Screencast,
  ShieldCheck,
  Smiley,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import type { Status } from "../lib/types";

export function Avatar({
  name,
  color,
  src,
  size = 32,
  status,
  speaking,
  live,
  ring = "var(--ring)",
}: {
  name: string;
  color: string;
  src?: string;
  size?: number;
  status?: Status | "offline";
  speaking?: boolean;
  live?: boolean;
  ring?: string;
}) {
  const dot = Math.max(8, Math.round(size * 0.27));
  const border = size >= 56 ? 4 : 2;
  return (
    <div className={"avatar" + (speaking ? " speaking" : "")} style={{ width: size, height: size, background: src ? "transparent" : color, fontSize: size * 0.42 }} title={name}>
      {src ? <img src={src} alt="" draggable={false} /> : (name || "?").slice(0, 1).toUpperCase()}
      {status && <span className={"status-dot " + status} style={{ width: dot, height: dot, borderColor: ring, borderWidth: border }} />}
      {live && <span className="avatar-live">AO VIVO</span>}
    </div>
  );
}

export function MediaView({ stream, muted, volume = 1, className, videoRef }: { stream: MediaStream | null; muted?: boolean; volume?: number; className?: string; videoRef?: React.RefObject<HTMLVideoElement | null> }) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream, ref]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, volume);
  }, [volume, ref]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={"modal" + (wide ? " wide" : "")} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icons.X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Interruptor. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small className="dim">{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={"toggle" + (checked ? " on" : "")} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

type IconProps = { size?: number };
type PhIcon = ComponentType<{ size?: number; weight?: IconWeight; "aria-hidden"?: boolean }>;
const mk = (C: PhIcon, weight: IconWeight = "regular") =>
  function Icon({ size = 20 }: IconProps) {
    return <C size={size} weight={weight} aria-hidden />;
  };

/** Ícones do app (Phosphor). Os nomes ficam estáveis para os componentes. */
export const Icons = {
  Hash: mk(Hash, "bold"),
  Speaker: mk(SpeakerHigh, "duotone"),
  Mic: mk(Microphone, "duotone"),
  MicOff: mk(MicrophoneSlash, "duotone"),
  Headset: mk(Headphones, "duotone"),
  HeadsetOff: mk(SpeakerSlash, "duotone"),
  Gear: mk(GearSix, "duotone"),
  Screen: mk(Screencast, "duotone"),
  Hangup: mk(PhoneX, "fill"),
  Plus: mk(Plus, "bold"),
  Chevron: mk(CaretDown, "bold"),
  Users: mk(UsersThree, "duotone"),
  Fullscreen: mk(CornersOut, "bold"),
  Theater: mk(ProjectorScreen, "duotone"),
  Pip: mk(PictureInPicture, "duotone"),
  Stats: mk(ChartBar, "duotone"),
  Eye: mk(Eye, "duotone"),
  X: mk(X, "bold"),
  Reply: mk(ArrowBendUpLeft, "bold"),
  Edit: mk(PencilSimple, "duotone"),
  Trash: mk(Trash, "duotone"),
  Smile: mk(Smiley, "duotone"),
  Clip: mk(Paperclip, "bold"),
  Crown: mk(Crown, "fill"),
  Shield: mk(ShieldCheck, "duotone"),
  Download: mk(DownloadSimple, "bold"),
  File: mk(FileText, "duotone"),
  Search: mk(MagnifyingGlass, "bold"),
  Bell: mk(Bell, "duotone"),
  BellOff: mk(BellSlash, "duotone"),
  Link: mk(LinkSimple, "bold"),
  Copy: mk(Copy, "duotone"),
  Wifi: mk(CellSignalFull, "fill"),
  Home: mk(House, "duotone"),
};

export function timeLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "Hoje às " + hm;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Ontem às " + hm;
  return d.toLocaleDateString("pt-BR") + " " + hm;
}

export function dateLabel(ts: number) {
  return new Date(ts).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

export function formatBytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export function lastSeenLabel(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dia(s)`;
}

export const STATUS_LABEL: Record<Status | "offline", string> = { online: "Online", idle: "Ausente", dnd: "Não perturbe", offline: "Offline" };

export function keyLabel(code: string) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Mouse")) return "botão " + code.slice(5) + " do mouse";
  return code.replace("Left", " esq.").replace("Right", " dir.").replace("Control", "Ctrl");
}
