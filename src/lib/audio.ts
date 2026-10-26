/**
 * Motor de áudio da voz: pipeline do microfone (volume, detecção de voz,
 * push-to-talk), reprodução dos outros com volume individual, detecção de
 * quem está falando e sons da interface.
 */
import type { Settings } from "./types";

type Remote = { pub: string; el: HTMLAudioElement; src: MediaStreamAudioSourceNode; gain: GainNode; analyser: AnalyserNode; speakingUntil: number };

import { storage } from "./storage";
import { createDenoiseNode, DENOISE_RATE, loadDenoiseAssets } from "./denoise";

const VOL_KEY = "uservol";
const LOCAL_MUTE_KEY = "localmute";

function levelDb(an: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // microfone
  private raw: MediaStream | null = null;
  private inGain: GainNode | null = null;
  private inAnalyser: AnalyserNode | null = null;
  private gate: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;
  /** redutor de ruído por IA (DeepFilterNet): criado uma vez por AudioContext e reaproveitado */
  private denoise: AudioWorkletNode | null = null;
  private denoising = false;
  private denoiseLoading: Promise<void> | null = null;
  /** o redutor falhou: usa o do navegador até o usuário religar a opção */
  denoiseBroken = false;
  private lastNoiseSuppression: boolean | null = null;
  /** avisos para o usuário (o app mostra como toast) */
  onNotice: (text: string) => void = () => {};
  micLevel = -100;
  private gateOpenUntil = 0;
  private pttUntil = 0;
  pttDown = false;
  muted = false;
  deafened = false;
  localSpeaking = false;

  private remotes = new Map<string, Remote>();
  speaking = new Set<string>();
  userVolumes: Record<string, number> = {};
  localMutes = new Set<string>();

  private timer: number | undefined;
  private buf = new Float32Array(1024);
  onChange: () => void = () => {};

  constructor(private settings: () => Settings) {}

  /** carrega volumes individuais do armazenamento cifrado (depois que o cofre abriu) */
  loadPrefs() {
    this.userVolumes = storage.get<Record<string, number>>(VOL_KEY, {});
    this.localMutes = new Set(storage.get<string[]>(LOCAL_MUTE_KEY, []));
  }

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive", sampleRate: DENOISE_RATE });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applySettings();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 50);
    return this.ctx;
  }

  applySettings() {
    const s = this.settings();
    // desligou e religou a supressão de ruído: dá outra chance ao redutor por IA
    if (s.noiseSuppression && this.lastNoiseSuppression === false) this.denoiseBroken = false;
    this.lastNoiseSuppression = s.noiseSuppression;
    if (this.master) this.master.gain.value = this.deafened ? 0 : s.outputVolume / 100;
    if (this.inGain) this.inGain.gain.value = s.inputVolume / 100;
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (ctx?.setSinkId) ctx.setSinkId(s.outputDevice === "default" ? "" : s.outputDevice).catch((e) => console.warn("setSinkId", e));
  }

  /** `on`: DeepFilterNet · `loading`: carregando (o navegador cobre até lá) · `fallback`: falhou · `off`: desligado · `idle`: microfone fechado */
  get denoiseStatus(): "on" | "loading" | "fallback" | "off" | "idle" {
    if (!this.settings().noiseSuppression) return "off";
    if (this.denoising) return "on";
    if (this.denoiseBroken) return "fallback";
    return this.denoiseLoading ? "loading" : "idle";
  }

  /** o redutor está carregado e deve ser usado agora */
  private denoiseReady() {
    return !!this.denoise && this.settings().noiseSuppression && !this.denoiseBroken;
  }

  /**
   * Carrega o redutor sem segurar o microfone (o modelo leva ~1 s para subir): até lá vale a supressão do
   * navegador, e quando ele fica pronto o microfone troca para ele sem trocar a stream enviada.
   */
  private loadDenoise(ctx: AudioContext) {
    if (this.denoise || this.denoiseLoading || this.denoiseBroken || !this.settings().noiseSuppression) return;
    this.denoiseLoading = (async () => {
      try {
        this.denoise = await createDenoiseNode(ctx, await loadDenoiseAssets(), (m) => this.denoiseFailed(m));
      } catch (e) {
        this.denoiseLoading = null;
        this.denoiseFailed(e instanceof Error ? e.message : String(e));
        return;
      }
      this.denoiseLoading = null;
      if (this.micStream && this.denoiseReady() && !this.denoising) await this.restartMic().catch((e) => console.warn("restartMic", e));
      this.onChange();
    })();
    this.onChange();
  }

  /** para os testes: espera o carregamento em andamento */
  whenDenoiseSettled() {
    return this.denoiseLoading ?? Promise.resolve();
  }

  private denoiseFailed(message: string) {
    console.warn("redutor de ruído indisponível:", message);
    if (this.denoiseBroken) return;
    const wasOn = this.denoising;
    this.denoiseBroken = true;
    this.denoise?.disconnect();
    this.denoise = null;
    this.denoising = false;
    this.onNotice(`O redutor de ruído por IA não carregou (${message}); usando o do navegador.`);
    // se o microfone passava pelo redutor, reabre já com a supressão do navegador
    if (wasOn && this.micStream) this.restartMic().catch((e) => console.warn("restartMic", e));
    this.onChange();
  }

  private openRaw(useDenoise: boolean) {
    const s = this.settings();
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.inputDevice && s.inputDevice !== "default" ? { exact: s.inputDevice } : undefined,
        echoCancellation: s.echoCancellation,
        // com o DeepFilterNet ligado o do navegador sairia por cima dele: duas camadas estragam a voz
        noiseSuppression: s.noiseSuppression && !useDenoise,
        autoGainControl: s.autoGain,
        channelCount: 1,
      },
    });
  }

  /** microfone → (redutor de ruído) → ganho de entrada */
  private wireMic(ctx: AudioContext, raw: MediaStream, useDenoise: boolean) {
    const into = this.inGain!;
    this.micSrc?.disconnect();
    this.denoise?.disconnect();
    this.micSrc = ctx.createMediaStreamSource(raw);
    this.denoising = useDenoise && !!this.denoise;
    if (this.denoising) {
      this.micSrc.connect(this.denoise!);
      this.denoise!.connect(into);
    } else this.micSrc.connect(into);
  }

  /** Abre o microfone e devolve a stream processada que vai para os outros. */
  async startMic(): Promise<MediaStream> {
    const ctx = this.ensureCtx();
    this.stopMic();
    const useDenoise = this.denoiseReady();
    this.raw = await this.openRaw(useDenoise);
    this.inGain = ctx.createGain();
    this.inAnalyser = ctx.createAnalyser();
    this.inAnalyser.fftSize = 1024;
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.dest = ctx.createMediaStreamDestination();
    this.wireMic(ctx, this.raw, useDenoise);
    this.inGain.connect(this.inAnalyser);
    this.inGain.connect(this.gate);
    this.gate.connect(this.dest);
    this.applySettings();
    if (!useDenoise) this.loadDenoise(ctx);
    return this.dest.stream;
  }

  get micStream() {
    return this.dest?.stream ?? null;
  }

  /** Troca o dispositivo (ou o redutor de ruído) sem trocar a stream enviada (os outros não percebem). */
  async restartMic() {
    const current = this.raw;
    const ctx = this.ctx;
    if (!current || !ctx || !this.inGain) return;
    const useDenoise = this.denoiseReady();
    if (!useDenoise) this.loadDenoise(ctx);
    const raw = await this.openRaw(useDenoise);
    if (this.raw !== current) {
      // o microfone foi fechado (ou reiniciado) enquanto esperávamos
      raw.getTracks().forEach((t) => t.stop());
      return;
    }
    current.getTracks().forEach((t) => t.stop());
    this.raw = raw;
    this.wireMic(ctx, raw, useDenoise);
  }

  stopMic() {
    this.raw?.getTracks().forEach((t) => t.stop());
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.micSrc?.disconnect();
    this.denoise?.disconnect();
    this.raw = null;
    this.micSrc = null;
    this.denoising = false;
    this.dest = null;
    this.gate = null;
    this.inGain = null;
    this.inAnalyser = null;
    this.micLevel = -100;
    this.localSpeaking = false;
  }

  setPtt(down: boolean) {
    if (down) this.pttDown = true;
    else {
      this.pttDown = false;
      this.pttUntil = performance.now() + this.settings().pttDelay;
    }
  }

  // ---------------------------------------------------------------- remotos

  addRemote(key: string, pub: string, stream: MediaStream) {
    const ctx = this.ensureCtx();
    this.removeRemote(key);
    // o Chromium só entrega áudio WebRTC ao WebAudio se a stream estiver ligada a um elemento
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    src.connect(gain);
    gain.connect(this.master!);
    const r: Remote = { pub, el, src, gain, analyser, speakingUntil: 0 };
    this.remotes.set(key, r);
    this.applyUserVolume(r);
  }

  removeRemote(key: string) {
    const r = this.remotes.get(key);
    if (!r) return;
    r.src.disconnect();
    r.gain.disconnect();
    r.el.srcObject = null;
    this.remotes.delete(key);
  }

  clearRemotes() {
    for (const k of [...this.remotes.keys()]) this.removeRemote(k);
    this.speaking.clear();
  }

  private applyUserVolume(r: Remote) {
    const v = this.localMutes.has(r.pub) ? 0 : (this.userVolumes[r.pub] ?? 100) / 100;
    r.gain.gain.value = v;
  }

  setUserVolume(pub: string, vol: number) {
    this.userVolumes[pub] = vol;
    storage.set(VOL_KEY, this.userVolumes);
    for (const r of this.remotes.values()) if (r.pub === pub) this.applyUserVolume(r);
    this.onChange();
  }

  toggleLocalMute(pub: string) {
    if (this.localMutes.has(pub)) this.localMutes.delete(pub);
    else this.localMutes.add(pub);
    storage.set(LOCAL_MUTE_KEY, [...this.localMutes]);
    for (const r of this.remotes.values()) if (r.pub === pub) this.applyUserVolume(r);
    this.onChange();
  }

  setDeafened(d: boolean) {
    this.deafened = d;
    this.applySettings();
  }

  // ---------------------------------------------------------------- loop

  private tick() {
    const now = performance.now();
    const s = this.settings();
    let changed = false;

    if (this.inAnalyser && this.gate) {
      this.micLevel = levelDb(this.inAnalyser, this.buf);
      let open: boolean;
      if (s.vadMode === "ptt") open = this.pttDown || now < this.pttUntil;
      else {
        const threshold = s.vadMode === "manual" ? s.vadThreshold : -50;
        if (this.micLevel > threshold) this.gateOpenUntil = now + 300;
        open = now < this.gateOpenUntil;
      }
      open = open && !this.muted && !this.deafened;
      this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx!.currentTime, 0.01);
      if (open !== this.localSpeaking) {
        this.localSpeaking = open;
        changed = true;
      }
    }

    const speakingNow = new Set<string>();
    for (const r of this.remotes.values()) {
      if (levelDb(r.analyser, this.buf) > -55) r.speakingUntil = now + 250;
      if (now < r.speakingUntil) speakingNow.add(r.pub);
    }
    if (speakingNow.size !== this.speaking.size || [...speakingNow].some((p) => !this.speaking.has(p))) {
      this.speaking = speakingNow;
      changed = true;
    }
    if (changed) this.onChange();
  }

  // ---------------------------------------------------------------- sons da interface

  play(kind: UiSound) {
    if (!this.settings().uiSounds && kind !== "message" && kind !== "mention") return;
    const ctx = this.ensureCtx();
    const t0 = ctx.currentTime + 0.01;
    for (const [f, dt, vol = 0.12] of SOUNDS[kind]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(vol, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18);
      o.connect(g);
      g.connect(this.master!);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.2);
    }
  }
}

export type UiSound = keyof typeof SOUNDS;

/** Sons da interface: [frequência Hz, início s, volume]. Mesma voz senoidal curta para tudo; sobe = algo começou, desce = terminou. */
export const SOUNDS = {
  join: [[523, 0], [784, 0.09]],
  leave: [[784, 0], [523, 0.09]],
  mute: [[392, 0]],
  unmute: [[659, 0]],
  // surdo: mais grave e com duas notas, para não confundir com o mudo
  deafen: [[392, 0], [262, 0.08]],
  undeafen: [[392, 0], [659, 0.08]],
  message: [[880, 0], [1175, 0.06]],
  mention: [[988, 0], [1319, 0.08], [988, 0.16]],
  // você ficou ao vivo / sua live acabou
  live: [[659, 0], [880, 0.08], [1047, 0.16]],
  liveEnd: [[1047, 0], [880, 0.08], [659, 0.16]],
  // um amigo começou uma live
  liveOther: [[784, 0], [1047, 0.07], [1568, 0.14, 0.06]],
  // alguém começou a assistir a sua live (discreto: pode acontecer várias vezes)
  viewer: [[1319, 0, 0.06], [1568, 0.05, 0.05]],
  // alguém pedindo para entrar no servidor: "toc toc"
  knock: [[330, 0, 0.16], [330, 0.13, 0.16]],
  // você foi aprovado
  approved: [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.24]],
} satisfies Record<string, readonly (readonly [number, number] | readonly [number, number, number])[]>;
