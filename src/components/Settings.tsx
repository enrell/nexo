import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLORS, useApp } from "../lib/app";
import { logs } from "../lib/logs";
import { mediaErrorMessage } from "../lib/rtc";
import type { Session } from "../lib/session";
import { PRESETS, encodeInvite, inviteLink } from "../lib/storage";
import type { Codec, Quality, Settings, StreamPreset } from "../lib/types";
import { Avatar, Icons, Toggle, lastSeenLabel } from "./common";
import { keyLabel } from "./Sidebar";

type Section = { id: string; label: string; group: string; render: () => ReactNode };

function FullScreen({ sections, onClose, title }: { sections: Section[]; onClose: () => void; title?: string }) {
  const [cur, setCur] = useState(sections[0].id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest?.(".recording") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const groups = [...new Set(sections.map((s) => s.group))];
  const section = sections.find((s) => s.id === cur) ?? sections[0];
  return (
    <div className="fullscreen-settings">
      <nav className="fs-nav">
        <div className="fs-nav-inner">
          {title && <div className="fs-title ellipsis">{title}</div>}
          {groups.map((g) => (
            <div key={g}>
              <div className="fs-group">{g}</div>
              {sections
                .filter((s) => s.group === g)
                .map((s) => (
                  <button key={s.id} className={"fs-item" + (s.id === cur ? " on" : "")} onClick={() => setCur(s.id)}>
                    {s.label}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="fs-content">
        <div className="fs-content-inner">
          <h1>{section.label}</h1>
          {section.render()}
        </div>
        <button className="fs-close" onClick={onClose} aria-label="Fechar (Esc)">
          <Icons.X size={18} />
          <span>ESC</span>
        </button>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="dim">{hint}</small>}
    </div>
  );
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------------ configurações do usuário

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const a = useApp();
  const st = a.settings;
  const set = (patch: Partial<Settings>) => a.setSettings({ ...a.settings, ...patch });

  const sections: Section[] = [
    { id: "account", label: "Minha conta", group: "Configurações de usuário", render: () => <AccountSection /> },
    { id: "voice", label: "Voz e vídeo", group: "Configurações de usuário", render: () => <VoiceSection /> },
    { id: "stream", label: "Transmissão", group: "Configurações de usuário", render: () => <StreamSection /> },
    { id: "network", label: "Rede e ajuda ao servidor", group: "Configurações de usuário", render: () => <NetworkSection /> },
    {
      id: "notify",
      label: "Notificações",
      group: "Configurações do app",
      render: () => (
        <>
          <Field label="Notificar sobre">
            <Select
              value={st.notifyMode}
              onChange={(v) => set({ notifyMode: v })}
              options={[
                ["all", "Todas as mensagens"],
                ["mentions", "Só @menções"],
                ["none", "Nada"],
              ]}
            />
          </Field>
          <Toggle label="Notificações do Windows" hint="Mostra um aviso quando chega mensagem com o Nexo em segundo plano." checked={st.notifyDesktop} onChange={(v) => set({ notifyDesktop: v })} />
          <Toggle label="Som de mensagem" checked={st.notifySounds} onChange={(v) => set({ notifySounds: v })} />
          <Toggle label="Sons da interface" hint="Entrar/sair da voz, mutar, desmutar." checked={st.uiSounds} onChange={(v) => set({ uiSounds: v })} />
          <button className="btn ghost" onClick={() => a.audio.play("mention")}>
            Testar som
          </button>
          <p className="dim small">Status “Não perturbe” silencia todas as notificações. Servidores e canais podem ser silenciados no clique direito.</p>
        </>
      ),
    },
    {
      id: "appearance",
      label: "Aparência",
      group: "Configurações do app",
      render: () => (
        <>
          <Field label={`Tamanho da fonte do chat: ${st.fontScale}%`}>
            <input type="range" min={80} max={140} step={5} value={st.fontScale} onChange={(e) => set({ fontScale: +e.target.value })} />
          </Field>
          <Field label={`Zoom da interface: ${st.zoom}%`}>
            <input type="range" min={70} max={150} step={5} value={st.zoom} onChange={(e) => set({ zoom: +e.target.value })} />
          </Field>
          <Toggle label="Modo compacto" hint="Mensagens mais juntas, avatares menores." checked={st.compact} onChange={(v) => set({ compact: v })} />
          <Toggle label="Prévia de links" hint="Mostra título e imagem de links. Seu PC acessa o site para buscar a prévia." checked={st.linkPreviews} onChange={(v) => set({ linkPreviews: v })} />
        </>
      ),
    },
    {
      id: "keys",
      label: "Atalhos",
      group: "Configurações do app",
      render: () => (
        <>
          <p className="dim">Funcionam mesmo com o Nexo em segundo plano (dentro do jogo, por exemplo).</p>
          <Field label="Mutar / desmutar">
            <AcceleratorInput value={st.keyMute} onChange={(v) => set({ keyMute: v })} />
          </Field>
          <Field label="Ensurdecer">
            <AcceleratorInput value={st.keyDeafen} onChange={(v) => set({ keyDeafen: v })} />
          </Field>
          <Field label="Push-to-talk" hint="Ative em Voz e vídeo → Modo de entrada.">
            <KeyInput value={st.pttKey} onChange={(v) => set({ pttKey: v })} />
          </Field>
          <h3>Dentro do app</h3>
          <table className="keys-table">
            <tbody>
              <tr>
                <td>Trocar de servidor/canal</td>
                <td>
                  <kbd>Ctrl</kbd> + <kbd>K</kbd>
                </td>
              </tr>
              <tr>
                <td>Servidor anterior / próximo</td>
                <td>
                  <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>↑/↓</kbd>
                </td>
              </tr>
              <tr>
                <td>Editar última mensagem</td>
                <td>
                  <kbd>↑</kbd> com o campo vazio
                </td>
              </tr>
              <tr>
                <td>Live: tela cheia / teatro / mudo</td>
                <td>
                  <kbd>F</kbd> / <kbd>T</kbd> / <kbd>M</kbd>
                </td>
              </tr>
              <tr>
                <td>Fechar janelas</td>
                <td>
                  <kbd>Esc</kbd>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: "system",
      label: "Sistema",
      group: "Configurações do app",
      render: () => (
        <>
          <Toggle label="Fechar para a bandeja" hint="O X esconde a janela; a voz continua. Saia pelo ícone perto do relógio." checked={st.closeToTray} onChange={(v) => set({ closeToTray: v })} />
          <Toggle label="Abrir com o Windows" hint="Inicia minimizado na bandeja." checked={st.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
        </>
      ),
    },
    { id: "about", label: "Sobre e diagnóstico", group: "Configurações do app", render: () => <AboutSection /> },
  ];
  return <FullScreen sections={sections} onClose={onClose} />;
}

function AccountSection() {
  const a = useApp();
  const p = a.profile!;
  const [name, setName] = useState(p.name);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const save = (patch: Partial<typeof p>) => a.setProfile({ ...a.profile!, ...patch });

  const pickAvatar = async (f: File) => {
    try {
      const bmp = await createImageBitmap(f);
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const side = Math.min(bmp.width, bmp.height);
      c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 128, 128);
      save({ avatar: c.toDataURL("image/jpeg", 0.85) });
    } catch {
      a.showToast("Não consegui ler essa imagem.", "error");
    }
  };

  const backup = () => {
    const data = JSON.stringify({ nexoBackup: 1, identity: a.identity.exportBackup(), profile: a.profile, servers: a.servers }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const el = document.createElement("a");
    el.href = url;
    el.download = `nexo-conta-${p.name}.json`;
    el.click();
    URL.revokeObjectURL(url);
  };

  const restore = async (f: File) => {
    try {
      const d = JSON.parse(await f.text());
      if (d.nexoBackup !== 1 || !d.identity) throw new Error("arquivo inválido");
      if (!confirm("Restaurar esta conta? A conta atual deste PC será substituída e o app vai reiniciar.")) return;
      localStorage.setItem("nexo:identity", d.identity);
      if (d.profile) localStorage.setItem("nexo:profile", JSON.stringify(d.profile));
      if (Array.isArray(d.servers)) localStorage.setItem("nexo:servers", JSON.stringify(d.servers));
      location.reload();
    } catch (e) {
      a.showToast("Backup inválido: " + (e instanceof Error ? e.message : e), "error");
    }
  };

  return (
    <>
      <div className="profile-card" style={{ ["--banner" as string]: p.color }}>
        <div className="profile-banner" />
        <div className="profile-row">
          <button className="avatar-edit" onClick={() => fileRef.current?.click()} title="Trocar foto">
            <Avatar name={p.name} color={p.color} src={p.avatar} size={80} status={p.status} ring="var(--bg-rail)" />
            <span>Trocar</span>
          </button>
          <div>
            <div className="profile-name">{p.name}</div>
            <div className="dim small" title={a.identity.pub}>
              ID: {a.identity.pub.slice(0, 16)}…
            </div>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickAvatar(e.target.files[0])} />
      {p.avatar && (
        <button className="btn ghost small" onClick={() => save({ avatar: undefined })}>
          Remover foto
        </button>
      )}
      <Field label="Nome de exibição">
        <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && save({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </Field>
      <Field label="Cor">
        <div className="colors">
          {COLORS.map((c) => (
            <button key={c} className={"color" + (c === p.color ? " sel" : "")} style={{ background: c }} onClick={() => save({ color: c })} aria-label={c} />
          ))}
        </div>
      </Field>
      <h3>Backup da conta</h3>
      <p className="dim small">
        Sua conta é uma chave criptográfica guardada só neste PC — é ela que prova que você é você. Faça um backup para usar a mesma conta em outro computador ou não perdê-la ao formatar.{" "}
        <strong>Não compartilhe o arquivo</strong>: quem tiver ele pode se passar por você.
      </p>
      <div className="row">
        <button className="btn" onClick={backup}>
          Exportar backup
        </button>
        <button className="btn ghost" onClick={() => restoreRef.current?.click()}>
          Restaurar backup
        </button>
      </div>
      <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
    </>
  );
}

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () => navigator.mediaDevices.enumerateDevices().then(setDevices);
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, []);
  return devices;
}

function VoiceSection() {
  const a = useApp();
  const st = a.settings;
  const set = (patch: Partial<Settings>) => a.setSettings({ ...a.settings, ...patch });
  const devices = useDevices();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(-100);
  const monitor = useRef<HTMLAudioElement | null>(null);
  const opts = (kind: MediaDeviceKind): [string, string][] => [
    ["default", "Padrão do Windows"],
    ...devices.filter((d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications").map((d, i) => [d.deviceId, d.label || `Dispositivo ${i + 1}`] as [string, string]),
  ];
  const inVoice = !!a.voiceSession;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setLevel(a.audio.micLevel);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [a]);

  const stopTest = () => {
    monitor.current?.pause();
    monitor.current = null;
    if (!a.voiceSession) a.audio.stopMic();
    setTesting(false);
  };
  useEffect(() => () => stopTest(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTest = async () => {
    try {
      const out = a.audio.micStream ?? (await a.audio.startMic());
      if (!inVoice) {
        const el = new Audio();
        el.srcObject = out;
        const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (st.outputDevice !== "default") await sink.setSinkId?.(st.outputDevice).catch(() => {});
        await el.play();
        monitor.current = el;
      }
      setTesting(true);
    } catch (e) {
      a.showToast(mediaErrorMessage(e, "microfone"), "error");
    }
  };

  const pct = Math.max(0, Math.min(100, ((level + 100) / 100) * 100));
  const thrPct = ((st.vadThreshold + 100) / 100) * 100;

  return (
    <>
      <div className="grid2">
        <Field label="Microfone">
          <Select value={st.inputDevice} onChange={(v) => set({ inputDevice: v })} options={opts("audioinput")} />
        </Field>
        <Field label="Saída de áudio">
          <Select value={st.outputDevice} onChange={(v) => set({ outputDevice: v })} options={opts("audiooutput")} />
        </Field>
        <Field label={`Volume do microfone: ${st.inputVolume}%`}>
          <input type="range" min={0} max={200} value={st.inputVolume} onChange={(e) => set({ inputVolume: +e.target.value })} />
        </Field>
        <Field label={`Volume de saída: ${st.outputVolume}%`}>
          <input type="range" min={0} max={200} value={st.outputVolume} onChange={(e) => set({ outputVolume: +e.target.value })} />
        </Field>
      </div>

      <Field label="Teste de microfone" hint={inVoice ? "Você está na voz: o medidor mostra seu microfone de verdade." : "Fale algo: você vai se ouvir do jeito que os outros ouvem."}>
        <div className="row center">
          {testing || inVoice ? (
            !inVoice && (
              <button className="btn danger" onClick={stopTest}>
                Parar teste
              </button>
            )
          ) : (
            <button className="btn" onClick={startTest}>
              Vamos testar
            </button>
          )}
          <div className="meter">
            <div className="meter-fill" style={{ width: pct + "%", background: a.audio.localSpeaking ? "var(--green)" : "#4e5058" }} />
          </div>
        </div>
      </Field>

      <h3>Modo de entrada</h3>
      <div className="radio-group">
        {(
          [
            ["auto", "Detecção de voz automática", "O Nexo decide quando você está falando."],
            ["manual", "Detecção de voz manual", "Você escolhe a sensibilidade abaixo."],
            ["ptt", "Aperte para falar (push-to-talk)", "Só transmite enquanto a tecla estiver pressionada — funciona dentro do jogo."],
          ] as const
        ).map(([v, l, h]) => (
          <label key={v} className={"radio" + (st.vadMode === v ? " on" : "")}>
            <input type="radio" checked={st.vadMode === v} onChange={() => set({ vadMode: v })} />
            <span>
              {l}
              <small className="dim">{h}</small>
            </span>
          </label>
        ))}
      </div>
      {st.vadMode === "manual" && (
        <Field label={`Sensibilidade: ${st.vadThreshold} dB`} hint="Arraste até onde a barra só passa da marca quando você fala.">
          <div className="meter threshold">
            <div className="meter-fill" style={{ width: pct + "%", background: level > st.vadThreshold ? "var(--green)" : "#f0b232" }} />
            <div className="meter-mark" style={{ left: thrPct + "%" }} />
            <input type="range" min={-100} max={0} value={st.vadThreshold} onChange={(e) => set({ vadThreshold: +e.target.value })} />
          </div>
        </Field>
      )}
      {st.vadMode === "ptt" && (
        <div className="grid2">
          <Field label="Tecla">
            <KeyInput value={st.pttKey} onChange={(v) => set({ pttKey: v })} />
          </Field>
          <Field label={`Atraso ao soltar: ${st.pttDelay} ms`}>
            <input type="range" min={0} max={1000} step={20} value={st.pttDelay} onChange={(e) => set({ pttDelay: +e.target.value })} />
          </Field>
        </div>
      )}

      <h3>Processamento de voz</h3>
      <Toggle label="Supressão de ruído" hint="Corta ventilador, teclado e barulho de fundo." checked={st.noiseSuppression} onChange={(v) => set({ noiseSuppression: v })} />
      <Toggle label="Cancelamento de eco" hint="Evita que os outros se ouçam de volta se você usa caixa de som." checked={st.echoCancellation} onChange={(v) => set({ echoCancellation: v })} />
      <Toggle label="Ganho automático" hint="Equilibra o volume da sua voz." checked={st.autoGain} onChange={(v) => set({ autoGain: v })} />

      <h3>Câmera</h3>
      <Field label="Câmera (para lives de câmera)">
        <Select value={st.videoDevice} onChange={(v) => set({ videoDevice: v })} options={opts("videoinput")} />
      </Field>
    </>
  );
}

function StreamSection() {
  const a = useApp();
  const st = a.settings;
  const set = (patch: Partial<Settings>) => a.setSettings({ ...a.settings, ...patch });
  const applyPreset = (p: StreamPreset) => set(p === "custom" ? { preset: p } : { preset: p, ...PRESETS[p] });
  return (
    <>
      <h3>Qualidade rápida</h3>
      <div className="presets">
        {(
          [
            ["low", "Internet fraca", "720p 30fps · 1,5 Mbps"],
            ["medium", "Internet média", "1080p 30fps · 4 Mbps"],
            ["high", "Internet boa", "1080p 60fps · 8 Mbps"],
            ["custom", "Personalizado", "Você escolhe tudo"],
          ] as [StreamPreset, string, string][]
        ).map(([v, l, h]) => (
          <button key={v} className={"preset" + (st.preset === v ? " on" : "")} onClick={() => applyPreset(v)}>
            <strong>{l}</strong>
            <span className="dim small">{h}</span>
          </button>
        ))}
      </div>
      {st.preset === "custom" && (
        <div className="grid2">
          <Field label="Resolução e FPS">
            <Select
              value={st.quality}
              onChange={(v: Quality) => set({ quality: v })}
              options={(["480p30", "720p30", "720p60", "1080p30", "1080p60", "1440p60"] as Quality[]).map((q) => [q, q.replace("p", "p ") + "fps"])}
            />
          </Field>
          <Field label={`Bitrate máximo: ${(st.bitrate / 1000).toFixed(1)} Mbps`}>
            <input type="range" min={500} max={15000} step={250} value={st.bitrate} onChange={(e) => set({ bitrate: +e.target.value })} />
          </Field>
          <Field label={`Espectadores direto de você: ${st.streamSlots}`} hint={`Upload estimado: ${((st.bitrate * st.streamSlots) / 1000).toFixed(1)} Mbps. O resto recebe repassado por outros espectadores.`}>
            <input type="range" min={1} max={10} value={st.streamSlots} onChange={(e) => set({ streamSlots: +e.target.value })} />
          </Field>
        </div>
      )}
      <div className="grid2">
        <Field label="Otimizar para">
          <Select
            value={st.contentHint}
            onChange={(v) => set({ contentHint: v })}
            options={[
              ["motion", "Movimento (jogos, vídeos)"],
              ["detail", "Nitidez (texto, código)"],
            ]}
          />
        </Field>
        <Field label="Codec de vídeo" hint="“Automático” usa H.264, que normalmente é codificado pela placa de vídeo (menos CPU enquanto você joga).">
          <Select
            value={st.codec}
            onChange={(v: Codec) => set({ codec: v })}
            options={[
              ["auto", "Automático (recomendado)"],
              ["h264", "H.264"],
              ["vp9", "VP9 (melhor qualidade, mais CPU)"],
              ["vp8", "VP8 (mais compatível)"],
              ["av1", "AV1 (experimental)"],
            ]}
          />
        </Field>
      </div>
    </>
  );
}

function NetworkSection() {
  const a = useApp();
  const st = a.settings;
  const p = a.profile!;
  const set = (patch: Partial<Settings>) => a.setSettings({ ...a.settings, ...patch });
  const [relay, setRelay] = useState(p.relaySlots);
  const [turnDraft, setTurnDraft] = useState({ turnUrl: st.turnUrl, turnUser: st.turnUser, turnPass: st.turnPass, relayUrls: st.relayUrls });
  const [testing, setTesting] = useState(false);
  const [up, setUp] = useState<number | null>(null);

  const speedTest = async () => {
    setTesting(true);
    setUp(null);
    try {
      // mede o upload enviando 8 MB para um serviço público de teste
      const data = new Uint8Array(8 * 1024 * 1024);
      const t0 = performance.now();
      await fetch("https://speed.cloudflare.com/__up", { method: "POST", body: data, mode: "no-cors" });
      const mbps = (data.length * 8) / ((performance.now() - t0) / 1000) / 1e6;
      setUp(mbps);
      const suggestion = Math.max(0, Math.min(8, Math.floor((mbps * 0.6) / (st.bitrate / 1000))));
      setRelay(suggestion);
      a.setProfile({ ...a.profile!, relaySlots: suggestion });
    } catch {
      a.showToast("Não consegui medir sua internet agora.", "error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <h3>Ajudar o servidor</h3>
      <p className="dim small">Quando você assiste uma live, pode repassar o vídeo para outros amigos, assim quem transmite não precisa mandar para todo mundo sozinho.</p>
      <Field label={`Retransmitir lives para até ${relay} pessoa(s)`} hint={`Cada pessoa usa ~${(st.bitrate / 1000).toFixed(1)} Mbps do seu upload. Use 0 se sua internet for fraca.`}>
        <input type="range" min={0} max={8} value={relay} onChange={(e) => setRelay(+e.target.value)} onMouseUp={() => a.setProfile({ ...a.profile!, relaySlots: relay })} onKeyUp={() => a.setProfile({ ...a.profile!, relaySlots: relay })} />
      </Field>
      <div className="row center">
        <button className="btn ghost" disabled={testing} onClick={speedTest}>
          {testing ? "Medindo upload…" : "Medir minha internet e sugerir"}
        </button>
        {up !== null && <span className="dim">Upload: {up.toFixed(1)} Mbps → sugerido {relay}</span>}
      </div>

      <h3>Conexões agora</h3>
      {[...a.sessions.values()].map((s) => (
        <div key={s.server.sid} className="conn-list">
          <strong>{s.name}</strong>
          {Object.values(s.peers).length === 0 && <div className="dim small">Ninguém online</div>}
          {Object.values(s.peers).map((p) => (
            <div key={p.pub} className="conn-row small">
              <span className="ellipsis">{p.profile?.name ?? "…"}</span>
              <span className={"conn " + ((p.rtt ?? 999) < 80 ? "good" : (p.rtt ?? 999) < 200 ? "ok" : "bad")}>{p.rtt ?? "?"} ms</span>
              <span className="dim">{p.relayed === undefined ? "" : p.relayed ? "via TURN" : "direta"}</span>
            </div>
          ))}
        </div>
      ))}

      <h3>TURN (avançado)</h3>
      <p className="dim small">Se algum amigo nunca conecta (NAT restritivo, alguns 4G/CGNAT), um servidor TURN repassa o tráfego. Um amigo pode hospedar um coturn, ou use um serviço gratuito.</p>
      <Field label="URL do TURN">
        <input value={turnDraft.turnUrl} placeholder="turn:meuturn.exemplo.com:3478" onChange={(e) => setTurnDraft({ ...turnDraft, turnUrl: e.target.value })} />
      </Field>
      <div className="row">
        <input value={turnDraft.turnUser} placeholder="usuário" onChange={(e) => setTurnDraft({ ...turnDraft, turnUser: e.target.value })} />
        <input value={turnDraft.turnPass} placeholder="senha" type="password" onChange={(e) => setTurnDraft({ ...turnDraft, turnPass: e.target.value })} />
      </div>
      <Field label="Relays de descoberta (Nostr), um por linha" hint="Vazio = lista pública padrão (recomendado).">
        <textarea rows={3} value={turnDraft.relayUrls} placeholder="wss://relay.exemplo.com" onChange={(e) => setTurnDraft({ ...turnDraft, relayUrls: e.target.value })} />
      </Field>
      <button
        className="btn"
        onClick={() => {
          set(turnDraft);
          if (confirm("Reiniciar o Nexo agora para aplicar a configuração de rede?")) location.reload();
        }}
      >
        Salvar e reiniciar
      </button>
    </>
  );
}

function AboutSection() {
  const a = useApp();
  const [version, setVersion] = useState("dev");
  useEffect(() => {
    window.nexo?.getVersion().then(setVersion);
  }, []);
  const exportDiag = () => {
    const diag = {
      version,
      date: new Date().toISOString(),
      platform: navigator.userAgent,
      settings: { ...a.settings, turnPass: a.settings.turnPass ? "***" : "" },
      servers: [...a.sessions.values()].map((s) => ({
        name: s.name,
        peers: Object.values(s.peers).map((p) => ({ rtt: p.rtt, relayed: p.relayed, live: !!p.live, voice: !!p.inVoice })),
        events: s.events.size,
        joinError: s.joinError,
        live: !!s.myLive,
        watching: s.watching ? { status: s.watching.status, error: s.watching.error } : null,
      })),
      logs: logs.list(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(diag, null, 2)], { type: "application/json" }));
    const el = document.createElement("a");
    el.href = url;
    el.download = `nexo-diagnostico-${Date.now()}.json`;
    el.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="about">
        <img src="./logo.svg" alt="" width={64} height={64} />
        <div>
          <h2>Nexo {version}</h2>
          <p className="dim">Chat, voz e lives entre amigos, direto de PC pra PC. Sem servidor central.</p>
        </div>
      </div>
      {a.update?.status === "ready" ? (
        <button className="btn" onClick={() => window.nexo?.installUpdate()}>
          Reiniciar e atualizar para {a.update.version}
        </button>
      ) : a.update?.status === "downloading" ? (
        <p className="dim">Baixando a versão {a.update.version}…</p>
      ) : (
        <p className="dim small">O Nexo procura atualizações sozinho ao abrir.</p>
      )}
      <h3>Diagnóstico</h3>
      <p className="dim small">Se algo der errado, exporte o diagnóstico e mande para quem está ajudando. Não inclui mensagens, senhas nem sua chave.</p>
      <button className="btn ghost" onClick={exportDiag}>
        Exportar diagnóstico
      </button>
    </>
  );
}

// ------------------------------------------------------------------ gravação de teclas

function KeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") onChange(e.code);
      setRec(false);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button >= 3) {
        e.preventDefault();
        onChange("Mouse" + (e.button + 1));
        setRec(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
    };
  }, [rec, onChange]);
  return (
    <button className={"key-input" + (rec ? " recording" : "")} onClick={() => setRec(true)}>
      {rec ? "Pressione uma tecla ou botão lateral do mouse…" : keyLabel(value)}
    </button>
  );
}

function AcceleratorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return setRec(false);
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey) parts.push("CommandOrControl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      let k = e.code;
      if (k.startsWith("Key")) k = k.slice(3);
      else if (k.startsWith("Digit")) k = k.slice(5);
      else if (k.startsWith("Numpad")) k = "num" + k.slice(6).toLowerCase();
      parts.push(k);
      onChange(parts.join("+"));
      setRec(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rec, onChange]);
  const label = value ? value.replace("CommandOrControl", "Ctrl").split("+").join(" + ") : "Nenhum";
  return (
    <div className="row center">
      <button className={"key-input" + (rec ? " recording" : "")} onClick={() => setRec(true)}>
        {rec ? "Pressione a combinação…" : label}
      </button>
      {value && (
        <button className="btn ghost small" onClick={() => onChange("")}>
          Remover
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ configurações do servidor

export function ServerSettingsScreen({ s, onClose }: { s: Session; onClose: () => void }) {
  const a = useApp();
  const st = s.state;
  const [name, setName] = useState(st.name);
  const [newChan, setNewChan] = useState("");
  const owner = s.isOwner();

  const sections: Section[] = [
    {
      id: "overview",
      label: "Visão geral",
      group: st.name,
      render: () => (
        <>
          <Field label="Nome do servidor">
            <div className="row">
              <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <button className="btn" disabled={!name.trim() || name === st.name} onClick={() => s.rename(name)}>
                Salvar
              </button>
            </div>
          </Field>
          <p className="dim small">
            Dono: <strong>{s.server.owner ? s.profileOf(s.server.owner).name : "ninguém (servidor antigo, todos são administradores)"}</strong>
          </p>
        </>
      ),
    },
    {
      id: "channels",
      label: "Canais",
      group: st.name,
      render: () => (
        <>
          <div className="row">
            <input value={newChan} placeholder="novo-canal" onChange={(e) => setNewChan(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newChan.trim() && (s.addChannel(newChan), setNewChan(""))} />
            <button className="btn" disabled={!newChan.trim()} onClick={() => (s.addChannel(newChan), setNewChan(""))}>
              Criar canal
            </button>
          </div>
          <div className="list">
            {st.channels.map((c) => (
              <div key={c.id} className="list-row">
                <Icons.Hash size={18} />
                <span className="grow">{c.name}</span>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    const n = prompt("Novo nome", c.name);
                    if (n) s.renameChannel(c.id, n);
                  }}
                >
                  Renomear
                </button>
                {st.channels.length > 1 && (
                  <button className="btn ghost small danger-text" onClick={() => confirm(`Apagar #${c.name}?`) && s.deleteChannel(c.id)}>
                    Apagar
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      id: "members",
      label: "Membros e cargos",
      group: st.name,
      render: () => (
        <>
          {!owner && <p className="dim small">Só o dono pode nomear administradores. Administradores podem banir, gerenciar canais e renovar o convite.</p>}
          <div className="list">
            {Object.values(s.members)
              .concat(s.members[s.me] ? [] : [{ srv: "", pub: s.me, name: a.profile!.name, color: a.profile!.color, avatar: a.profile!.avatar, lastSeen: Date.now() }])
              .filter((m) => !st.banned.has(m.pub))
              .map((m) => {
                const isAdm = st.admins.has(m.pub);
                const online = s.profileOf(m.pub).online;
                return (
                  <div key={m.pub} className="list-row">
                    <Avatar name={m.name} color={m.color} src={m.avatar} size={32} status={online ? "online" : "offline"} ring="var(--bg-main)" />
                    <div className="grow">
                      <div>
                        {m.name} {s.isOwner(m.pub) && <span className="pill tiny">Dono</span>} {!s.isOwner(m.pub) && isAdm && <span className="pill tiny">Admin</span>}
                      </div>
                      <div className="dim small">{online ? "online" : `visto ${lastSeenLabel(m.lastSeen)}`}</div>
                    </div>
                    {owner && m.pub !== s.me && (
                      <button className="btn ghost small" onClick={() => s.setRole(m.pub, isAdm ? "member" : "admin")}>
                        {isAdm ? "Remover admin" : "Tornar admin"}
                      </button>
                    )}
                    {s.isAdmin() && m.pub !== s.me && !s.isOwner(m.pub) && (
                      <button className="btn ghost small danger-text" onClick={() => confirm(`Banir ${m.name}?`) && s.ban(m.pub, true)}>
                        Banir
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      ),
    },
    {
      id: "bans",
      label: "Banidos",
      group: st.name,
      render: () => (
        <div className="list">
          {st.banned.size === 0 && <p className="dim">Ninguém banido.</p>}
          {[...st.banned].map((pub) => (
            <div key={pub} className="list-row">
              <span className="grow">{s.profileOf(pub).name}</span>
              <button className="btn ghost small" onClick={() => s.ban(pub, false)}>
                Revogar banimento
              </button>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "invite",
      label: "Convite",
      group: st.name,
      render: () => (
        <>
          <Field label="Link de convite">
            <div className="invite-box">
              <code>{inviteLink(s.server)}</code>
              <button className="btn" onClick={() => (navigator.clipboard.writeText(inviteLink(s.server)), a.showToast("Link copiado"))}>
                Copiar
              </button>
            </div>
          </Field>
          <h3>Convite vazou?</h3>
          <p className="dim small">
            Gera um convite novo: todo mundo que estiver online agora migra junto e o código antigo para de funcionar. Quem estiver offline vai precisar do convite novo. Para tirar alguém específico, use “Banir”.
          </p>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm("Gerar um convite novo e invalidar o atual?")) s.regenerateInvite();
            }}
          >
            Renovar convite
          </button>
          <p className="dim small">Código atual (para colar): {encodeInvite(s.server).slice(0, 24)}…</p>
        </>
      ),
    },
  ];
  return <FullScreen sections={sections} onClose={onClose} title={st.name} />;
}
