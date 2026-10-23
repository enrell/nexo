import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/app";
import { selfId, type LiveStats, type Session } from "../lib/session";
import { storage } from "../lib/storage";
import { ChatView } from "./Chat";
import { Avatar, Icons, MediaView, Modal } from "./common";

const VOL_KEY = "livevol";
const CHAT_W_KEY = "livechatw";
const CHAT_MIN = 260;
const CHAT_MAX = 720;
const clampChat = (w: number) => Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, w)));

export function LiveView({ s, origin }: { s: Session; origin: string }) {
  const a = useApp();
  const mine = origin === selfId;
  const live = mine ? s.myLive : s.peers[origin]?.live;
  const [volume, setVolume] = useState(() => storage.get<number>(VOL_KEY, 1));
  const [chatOpen, setChatOpen] = useState(true);
  const [chatW, setChatW] = useState(() => clampChat(storage.get<number>(CHAT_W_KEY, 330)));
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

  // arrastar a borda do chat muda a largura (fica salva); duplo clique volta ao padrão
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = chatW;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    let w = w0;
    const move = (ev: PointerEvent) => setChatW((w = clampChat(w0 + (x0 - ev.clientX))));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing");
      storage.set(CHAT_W_KEY, w);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

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
  // "Tela cheia" na prévia da live
  useEffect(() => {
    if (!a.liveFullscreen) return;
    a.liveFullscreen = false;
    stageRef.current?.requestFullscreen().catch(() => {});
  }, [a.liveFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps
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
            <MediaView stream={stream} muted={mine || a.deafened || volume === 0} volume={volume} className="stage-video" videoRef={videoRef} sinkId={a.settings.outputDevice} />
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
                  {a.deafened && live?.audio && (
                    <button className="pill warn" onClick={() => a.toggleDeafen()} title="Você está com o som desligado: a live também fica muda">
                      Som desligado · ligar
                    </button>
                  )}
                  {live && !live.audio && <span className="pill">sem áudio</span>}
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
          <div className="live-chat" style={{ width: chatW }}>
            <div
              className="live-chat-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar chat"
              title="Arraste para mudar a largura (duplo clique: padrão)"
              onPointerDown={startResize}
              onDoubleClick={() => (setChatW(330), storage.set(CHAT_W_KEY, 330))}
            />
            <div className="live-chat-head dim small">Chat · #{s.state.channels.find((c) => c.id === a.channelOf(s))?.name}</div>
            <ChatView s={s} compact />
          </div>
        )}
      </div>
    </div>
  );
}

/** Prévia da live (ao clicar no "AO VIVO" da sala de voz): vídeo pequeno, sem som, com "Assistir" e "Tela cheia". */
export function LivePeek({ s, origin, onClose }: { s: Session; origin: string; onClose: () => void }) {
  const a = useApp();
  const mine = origin === selfId;
  const live = mine ? s.myLive : s.peers[origin]?.live;
  const opening = useRef(false);

  useEffect(() => {
    if (mine || !live) return;
    // se a tela principal já mostra outra live, ela volta a ser assistida quando a prévia fechar
    const before = a.view.type === "live" ? a.view.origin : null;
    s.watch(origin);
    return () => {
      if (opening.current) return;
      if (before && before !== origin) s.watch(before);
      else if (!(a.view.type === "live" && a.view.origin === origin)) s.stopWatching();
    };
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  const w = s.watching?.origin === origin ? s.watching : null;
  const stream = mine ? s.myStream : (w?.stream ?? null);
  const name = mine ? "Você" : s.peerName(origin);
  const open = (fullscreen: boolean) => {
    opening.current = true;
    a.openLive(origin, { fullscreen });
    onClose();
  };

  return (
    <Modal
      title={`${name} · ao vivo`}
      onClose={onClose}
      footer={
        live && (
          <>
            <button className="btn ghost" onClick={() => open(true)}>
              Tela cheia
            </button>
            <button className="btn" onClick={() => open(false)}>
              {mine ? "Ver" : "Assistir"}
            </button>
          </>
        )
      }
    >
      <div className="live-peek">
        {!live ? (
          <div className="stage-msg">Essa transmissão acabou.</div>
        ) : stream ? (
          <MediaView stream={stream} muted className="live-peek-video" />
        ) : (
          <div className="stage-msg">{w?.status === "failed" ? (w.error ?? "Não deu pra conectar à live") : "Conectando…"}</div>
        )}
      </div>
      {live && (
        <p className="dim small live-peek-info">
          {live.title} · <Icons.Eye size={13} /> {live.viewers}
        </p>
      )}
    </Modal>
  );
}
