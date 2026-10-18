import { useEffect, useRef, type ReactNode } from "react";
import type { Status } from "../lib/types";

export function Avatar({
  name,
  color,
  src,
  size = 32,
  status,
  speaking,
  live,
  ring = "var(--bg-side)",
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
  const dot = Math.max(10, Math.round(size * 0.38));
  return (
    <div className={"avatar" + (speaking ? " speaking" : "")} style={{ width: size, height: size, background: src ? "transparent" : color, fontSize: size * 0.42 }} title={name}>
      {src ? <img src={src} alt="" draggable={false} /> : (name || "?").slice(0, 1).toUpperCase()}
      {status && <span className={"status-dot " + status} style={{ width: dot, height: dot, borderColor: ring }} />}
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

/** Interruptor estilo Discord. */
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

const I = (d: string, vb = "0 0 24 24") =>
  function Icon(props: { size?: number }) {
    return (
      <svg width={props.size ?? 20} height={props.size ?? 20} viewBox={vb} fill="currentColor" aria-hidden>
        <path d={d} />
      </svg>
    );
  };

export const Icons = {
  Hash: I("M10.99 3.16A1 1 0 0 0 9.01 2.84L8.15 8H4a1 1 0 0 0 0 2h3.82l-.67 4H3a1 1 0 1 0 0 2h3.82l-.8 4.84a1 1 0 0 0 1.97.32L8.85 16h4.97l-.8 4.84a1 1 0 0 0 1.97.32l.86-5.16H20a1 1 0 1 0 0-2h-3.82l.67-4H21a1 1 0 1 0 0-2h-3.82l.8-4.84a1 1 0 1 0-1.97-.32L15.15 8h-4.97l.8-4.84ZM14.15 14H9.18l.67-4h4.97l-.67 4Z"),
  Speaker: I("M12 3a1 1 0 0 0-1.7-.7L5.6 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.6l4.7 4.7A1 1 0 0 0 12 21V3ZM15.1 7.1a1 1 0 0 1 1.4 0 7 7 0 0 1 0 9.8 1 1 0 1 1-1.4-1.4 5 5 0 0 0 0-7 1 1 0 0 1 0-1.4Z"),
  Mic: I("M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4ZM6 11a1 1 0 1 0-2 0 8 8 0 0 0 7 7.94V21H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 11a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z"),
  MicOff: I("M2.7 2.7a1 1 0 0 1 1.4 0l17.2 17.2a1 1 0 0 1-1.4 1.4l-3.5-3.5A8 8 0 0 1 13 18.94V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.06A8 8 0 0 1 4 11a1 1 0 1 1 2 0 6 6 0 0 0 9 5.2l-1.5-1.5A4 4 0 0 1 8 12V8.8L2.7 4.1a1 1 0 0 1 0-1.4ZM16 6v5.2L8.4 3.6A4 4 0 0 1 16 6Zm2 5a1 1 0 1 1 2 0c0 1-.2 2-.5 2.9l-1.6-1.6c.1-.4.1-.9.1-1.3Z"),
  Headset: I("M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z"),
  HeadsetOff: I("M2.7 2.7a1 1 0 0 1 1.4 0l17.2 17.2a1 1 0 0 1-1.4 1.4l-1.3-1.3A3 3 0 0 1 18 20h-1a2 2 0 0 1-2-2v-1.6L7.6 9H5a7 7 0 0 0 0 1v2h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3v-5c0-2 .6-3.8 1.7-5.3L2.7 4.1a1 1 0 0 1 0-1.4ZM12 3a9 9 0 0 1 9 9v4.2l-2-2V12a7 7 0 0 0-11.6-5.2L6 5.4A9 9 0 0 1 12 3Z"),
  Gear: I("M10.6 2.1a1 1 0 0 1 1-.1h.8a1 1 0 0 1 1 .8l.4 2a7.9 7.9 0 0 1 1.7 1l2-.7a1 1 0 0 1 1.2.4l.4.7a1 1 0 0 1-.2 1.3l-1.5 1.3a8 8 0 0 1 0 2l1.5 1.4a1 1 0 0 1 .2 1.2l-.4.7a1 1 0 0 1-1.2.5l-2-.7a8 8 0 0 1-1.7 1l-.4 2a1 1 0 0 1-1 .8h-.8a1 1 0 0 1-1-.8l-.4-2a7.9 7.9 0 0 1-1.7-1l-2 .7a1 1 0 0 1-1.2-.5l-.4-.7a1 1 0 0 1 .2-1.2l1.5-1.4a8 8 0 0 1 0-2L4.2 7.4A1 1 0 0 1 4 6.1l.4-.7a1 1 0 0 1 1.2-.4l2 .7a8 8 0 0 1 1.7-1l.4-2a1 1 0 0 1 .9-.6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"),
  Screen: I("M4 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4Z"),
  Hangup: I("M21.7 13.4c.3.3.4.7.3 1.1l-.6 2.2a1 1 0 0 1-1.2.7l-3.5-.9a1 1 0 0 1-.7-.8l-.3-2a11.4 11.4 0 0 0-7.4 0l-.3 2a1 1 0 0 1-.7.8l-3.5.9a1 1 0 0 1-1.2-.7L2 14.5c-.1-.4 0-.8.3-1.1 5.3-5 14.1-5 19.4 0Z"),
  Plus: I("M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z"),
  Chevron: I("M5.3 9.3a1 1 0 0 1 1.4 0L12 14.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z"),
  Users: I("M14.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM2 19c0-3.3 4-5 9-5s9 1.7 9 5v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1Zm15.5-11a3 3 0 0 1-1.7 2.7 5.5 5.5 0 0 0 0-5.4A3 3 0 0 1 17.5 8Zm4.5 11v1h-.1a2.8 2.8 0 0 0 .1-1c0-1.7-.8-3.1-2.1-4.2 1.3.6 2.1 1.6 2.1 4.2Z"),
  Fullscreen: I("M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"),
  Theater: I("M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v10h14V5H5Z"),
  Pip: I("M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6h-2V5H5v14h6v2H5a2 2 0 0 1-2-2V5Zm10 9a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-6Z"),
  Stats: I("M4 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0v13h15a1 1 0 1 1 0 2H4Zm4-4a1 1 0 0 1-1-1v-4a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1Zm4 0a1 1 0 0 1-1-1V7a1 1 0 1 1 2 0v8a1 1 0 0 1-1 1Zm4 0a1 1 0 0 1-1-1v-6a1 1 0 1 1 2 0v6a1 1 0 0 1-1 1Z"),
  Eye: I("M12 5c5 0 9 4 10 7-1 3-5 7-10 7S3 15 2 12c1-3 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"),
  X: I("M17.3 5.3a1 1 0 1 1 1.4 1.4L13.4 12l5.3 5.3a1 1 0 0 1-1.4 1.4L12 13.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l5.3-5.3-5.3-5.3a1 1 0 0 1 1.4-1.4l5.3 5.3 5.3-5.3Z"),
  Reply: I("M10 8.3V5a1 1 0 0 0-1.7-.7l-6 6a1 1 0 0 0 0 1.4l6 6A1 1 0 0 0 10 17v-3.2c4.2.2 7.4 1.6 9.6 5 .5.8 1.4.3 1.4-.5C20.6 12.2 16.4 8.9 10 8.3Z"),
  Edit: I("M14.6 3.4a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L9.4 20.6a2 2 0 0 1-1 .5l-4.2.9a1 1 0 0 1-1.2-1.2l.9-4.2c.1-.4.3-.7.5-1L14.6 3.4Z"),
  Trash: I("M9 3a1 1 0 0 0-1 1v1H4a1 1 0 0 0 0 2h1l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9Zm1 6a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Z"),
  Smile: I("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-8.6 6.5a1 1 0 0 1 1.4.2 4.5 4.5 0 0 0 7.4 0 1 1 0 1 1 1.6 1.2 6.5 6.5 0 0 1-10.6 0 1 1 0 0 1 .2-1.4Z"),
  Clip: I("M16.5 6.5a1 1 0 0 1 1.4 1.4l-7 7a1.5 1.5 0 0 0 2.1 2.1l7.5-7.5a3.5 3.5 0 0 0-5-5L7.6 12.3a5.5 5.5 0 0 0 7.8 7.8l6-6a1 1 0 0 1 1.4 1.4l-6 6A7.5 7.5 0 0 1 6.2 10.9l7.9-7.9a5.5 5.5 0 0 1 7.8 7.8l-7.5 7.5a3.5 3.5 0 0 1-5-5l7.1-6.8Z"),
  Crown: I("M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z"),
  Shield: I("M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3Z"),
  Download: I("M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1ZM4 18a1 1 0 0 1 1 1v1h14v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"),
  File: I("M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm7 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5Z"),
  Search: I("M10 3a7 7 0 1 0 4.2 12.6l4.6 4.6a1 1 0 0 0 1.4-1.4l-4.6-4.6A7 7 0 0 0 10 3Zm-5 7a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z"),
  Bell: I("M12 2a7 7 0 0 0-7 7v4l-2 3v1h18v-1l-2-3V9a7 7 0 0 0-7-7Zm-3 17a3 3 0 0 0 6 0H9Z"),
  BellOff: I("M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4L19 17.6V17l-2-3V9a7 7 0 0 0-10.6-6L3.7 2.3ZM5 9.6V13l-2 3v1h11.4L5 7.6V9.6ZM9 19a3 3 0 0 0 6 0H9Z"),
  Link: I("M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4l-3.5 3.5a1 1 0 0 1-1.4 0ZM7 17a3 3 0 0 1 0-4.2l2.1-2.1a1 1 0 1 0-1.4-1.4l-2.1 2.1a5 5 0 0 0 7.1 7.1l2.1-2.1a1 1 0 0 0-1.4-1.4l-2.1 2.1A3 3 0 0 1 7 17Zm10-10a3 3 0 0 1 0 4.2l-2.1 2.1a1 1 0 0 0 1.4 1.4l2.1-2.1a5 5 0 0 0-7.1-7.1L9.2 7.6a1 1 0 0 0 1.4 1.4L12.7 7A3 3 0 0 1 17 7Z"),
  Copy: I("M8 3a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8Zm8 15V8a2 2 0 0 0-2-2H8V5h9v11h-1v2Z"),
  Wifi: I("M12 18.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM4.9 11.5a10 10 0 0 1 14.2 0 1 1 0 0 1-1.4 1.4 8 8 0 0 0-11.4 0 1 1 0 0 1-1.4-1.4Zm3 3a5.7 5.7 0 0 1 8.2 0 1 1 0 0 1-1.4 1.4 3.7 3.7 0 0 0-5.4 0 1 1 0 0 1-1.4-1.4ZM1.8 8.4a14.4 14.4 0 0 1 20.4 0 1 1 0 0 1-1.4 1.4 12.4 12.4 0 0 0-17.6 0 1 1 0 0 1-1.4-1.4Z"),
  Home: I("M11.3 2.3a1 1 0 0 1 1.4 0l9 9a1 1 0 0 1-1.4 1.4l-.3-.3V20a2 2 0 0 1-2 2h-3a1 1 0 0 1-1-1v-5h-4v5a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2v-7.6l-.3.3a1 1 0 0 1-1.4-1.4l9-9Z"),
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
