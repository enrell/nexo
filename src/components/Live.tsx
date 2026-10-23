import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/app";
import { selfId, type LiveStats, type Session } from "../lib/session";
import { storage } from "../lib/storage";
import { ChatView } from "./Chat";
import { Avatar, Icons, MediaView } from "./common";

const VOL_KEY = "livevol";

export function LiveView({ s, origin }: { s: Session; origin: string }) {
  const a = useApp();
  const mine = origin === selfId;
  const live = mine ? s.myLive : s.peers[origin]?.live;
  const [volume, setVolume] = useState(() => storage.get<number>(VOL_KEY, 1));
  const [chatOpen, setChatOpen] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // a minha live acabou (parei, fechei a janela compartilhada, a câmera caiu): não há o que mostrar aqui, volta ao chat
  useEffect(() => {
    if (mine && !live) a.closeLive();
  }, [mine, !!live]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mine && live && s.watching?.origin !== origin) s.watch(origin);
  }, [origin, mine, !!live, s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showStats || mine) return;
    const t = setInterval(async () => setStats(await s.liveStats()), 1000);
    return () => clearInterval(t);
  }, [showStats, mine, s]);

  useEffect(() => {
    storage.set(VOL_KEY, volume);
  }, [volume]);

  // atalhos: F = tela cheia, T = modo teatro, M = mudo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "f") fullscreen();
      if (e.key === "t") a.toggleTheater();
      if (e.key === "m") setVolume((v) => (v > 0 ? 0 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const w = s.watching?.origin === origin ? s.watching : null;
  const stream = mine ? s.myStream : (w?.stream ?? null);
  const via = w?.parent && w.parent !== origin ? s.peerName(w.parent) : null;
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen());
  const pip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch (e) {
      a.showToast("Janela flutuante indisponível: " + (e instanceof Error ? e.message : e), "error");
    }
  };
  const minutes = live ? Math.max(0, Math.floor((Date.now() - live.startedAt) / 60000)) : 0;
  const viewers = live?.viewerKeys ?? [];

  return (
    <div className="live-view">
      <header className="main-head">
        <span className="live-dot" />
        <span className="strong">{s.peerName(origin)}</span>
        <span className="dim ellipsis">{live?.title ?? "Live encerrada"}</span>
        {live && (
          <>
            <span className="head-sep" />
            <button className="dim small viewers-btn" onClick={() => setShowViewers(!showViewers)}>
              <Icons.Eye size={14} /> {live.viewers} assistindo
            </button>
            <span className="dim small">· {minutes} min</span>
          </>
        )}
        <div className="grow" />
        <button className={"icon-btn" + (a.theater ? " active" : "")} title="Modo teatro (T)" onClick={() => a.toggleTheater()}>
          <Icons.Theater />
        </button>
        <button className={"icon-btn" + (chatOpen ? " active" : "")} title={chatOpen ? "Esconder chat" : "Mostrar chat"} onClick={() => setChatOpen(!chatOpen)}>
          <Icons.Users />
        </button>
        {!mine && w && (
          <button className="btn ghost small" onClick={() => a.closeLive()}>
            Sair da live
          </button>
        )}
        {mine && live && (
          <button className="btn danger small" onClick={() => s.stopLive()}>
            Parar transmissão
          </button>
        )}
      </header>
      <div className="live-body">
        <div className="stage" ref={stageRef} onDoubleClick={fullscreen}>
          {!live ? (
            <div className="stage-msg">
              Essa transmissão acabou.
              <button className="btn" onClick={() => a.closeLive()}>
                Voltar ao chat
              </button>
            </div>
          ) : stream ? (
            <MediaView stream={stream} muted={mine || a.deafened || volume === 0} volume={volume} className="stage-video" videoRef={videoRef} />
          ) : w?.status === "failed" ? (
            <div className="stage-msg">
              <strong>Não deu pra conectar à live</strong>
              <span className="dim">{w.error}</span>
              <span className="dim small">Se acontecer sempre com a mesma pessoa, um de vocês pode estar atrás de um NAT restritivo — configure um TURN em Configurações → Rede.</span>
              <button className="btn" onClick={() => s.watch(origin, "__retry__")}>
                Tentar de novo
              </button>
            </div>
          ) : (
            <div className="stage-msg">
              <div className="spinner" /> Conectando à live…
            </div>
          )}

          {showViewers && live && (
            <div className="viewers-pop" onDoubleClick={(e) => e.stopPropagation()}>
              <div className="dim small">ASSISTINDO — {viewers.length}</div>
              {viewers.length === 0 && <div className="dim small">Ninguém ainda</div>}
              {viewers.map((pub) => {
                const p = s.profileOf(pub);
                return (
                  <div key={pub} className="viewer-row">
                    <Avatar name={p.name} color={p.color} src={p.avatar} size={22} />
                    <span className="ellipsis">{p.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {showStats && !mine && (
            <div className="stats-pop">
              {stats ? (
                <>
                  <div>Resolução: {stats.res}</div>
                  <div>FPS: {stats.fps}</div>
                  <div>Bitrate: {(stats.kbps / 1000).toFixed(1)} Mbps</div>
                  <div>Codec: {stats.codec}</div>
                  <div>Perda: {stats.loss}%</div>
                  <div>Recebendo de: {via ?? s.peerName(origin)}</div>
                  <div>Ping: {s.peers[w?.parent ?? origin]?.rtt ?? "?"} ms</div>
                </>
              ) : (
                <div>Medindo…</div>
              )}
            </div>
          )}

          {stream && (
            <div className="stage-bar" onDoubleClick={(e) => e.stopPropagation()}>
              {mine ? (
                <span className="pill">
                  Você está ao vivo · {live?.viewers ?? 0} espectador(es){live && !live.audio ? " · sem áudio" : ""}
                </span>
              ) : (
                <>
                  <button className="icon-btn" title="Mudo (M)" onClick={() => setVolume(volume > 0 ? 0 : 1)}>
                    {volume === 0 ? <Icons.HeadsetOff /> : <Icons.Speaker />}
                  </button>
                  <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(+e.target.value)} aria-label="Volume da live" />
                  {via && <span className="pill">via {via} (retransmissão P2P)</span>}
                </>
              )}
              <div className="grow" />
              {!mine && (
                <button className={"icon-btn" + (showStats ? " active" : "")} title="Estatísticas" onClick={() => setShowStats(!showStats)}>
                  <Icons.Stats />
                </button>
              )}
              <button className="icon-btn" title="Janela flutuante" onClick={pip}>
                <Icons.Pip />
              </button>
              <button className="icon-btn" title="Tela cheia (F)" onClick={fullscreen}>
                <Icons.Fullscreen />
              </button>
            </div>
          )}
        </div>
        {chatOpen && (
          <div className="live-chat">
            <div className="live-chat-head dim small">Chat · #{s.state.channels.find((c) => c.id === a.channelOf(s))?.name}</div>
            <ChatView s={s} compact />
          </div>
        )}
      </div>
    </div>
  );
}
