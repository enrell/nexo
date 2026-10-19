/**
 * Motor de áudio da voz: pipeline do microfone (volume, detecção de voz,
 * push-to-talk), reprodução dos outros com volume individual, detecção de
 * quem está falando e sons da interface.
 */
import type { Settings } from "./types";

type Remote = { pub: string; el: HTMLAudioElement; src: MediaStreamAudioSourceNode; gain: GainNode; analyser: AnalyserNode; speakingUntil: number };

import { storage } from "./storage";

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
      this.ctx = new AudioContext({ latencyHint: "interactive" });
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
    if (this.master) this.master.gain.value = this.deafened ? 0 : s.outputVolume / 100;
    if (this.inGain) this.inGain.gain.value = s.inputVolume / 100;
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (ctx?.setSinkId) ctx.setSinkId(s.outputDevice === "default" ? "" : s.outputDevice).catch((e) => console.warn("setSinkId", e));
  }

  /** Abre o microfone e devolve a stream processada que vai para os outros. */
  async startMic(): Promise<MediaStream> {
    const ctx = this.ensureCtx();
    this.stopMic();
    const s = this.settings();
    this.raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.inputDevice && s.inputDevice !== "default" ? { exact: s.inputDevice } : undefined,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGain,
        channelCount: 1,
      },
    });
    const src = ctx.createMediaStreamSource(this.raw);
    this.inGain = ctx.createGain();
    this.inAnalyser = ctx.createAnalyser();
    this.inAnalyser.fftSize = 1024;
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.dest = ctx.createMediaStreamDestination();
    src.connect(this.inGain);
    this.inGain.connect(this.inAnalyser);
    this.inGain.connect(this.gate);
    this.gate.connect(this.dest);
    this.applySettings();
    return this.dest.stream;
  }

  get micStream() {
    return this.dest?.stream ?? null;
  }

  /** Troca o dispositivo sem trocar a stream enviada (os outros não percebem). */
  async restartMic() {
    if (!this.raw || !this.ctx || !this.inGain) return;
    const s = this.settings();
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.inputDevice && s.inputDevice !== "default" ? { exact: s.inputDevice } : undefined,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGain,
        channelCount: 1,
      },
    });
    this.raw.getTracks().forEach((t) => t.stop());
    this.raw = raw;
    this.ctx.createMediaStreamSource(raw).connect(this.inGain);
  }

  stopMic() {
    this.raw?.getTracks().forEach((t) => t.stop());
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.raw = null;
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

  play(kind: "join" | "leave" | "mute" | "unmute" | "message" | "mention" | "live") {
    if (!this.settings().uiSounds && kind !== "message" && kind !== "mention") return;
    const ctx = this.ensureCtx();
    const seq: Record<typeof kind, [number, number][]> = {
      join: [
        [523, 0],
        [784, 0.09],
      ],
      leave: [
        [784, 0],
        [523, 0.09],
      ],
      mute: [[392, 0]],
      unmute: [[659, 0]],
      message: [
        [880, 0],
        [1175, 0.06],
      ],
      mention: [
        [988, 0],
        [1319, 0.08],
        [988, 0.16],
      ],
      live: [
        [659, 0],
        [880, 0.08],
        [1047, 0.16],
      ],
    };
    const t0 = ctx.currentTime + 0.01;
    for (const [f, dt] of seq[kind]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(0.12, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18);
      o.connect(g);
      g.connect(this.master!);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.2);
    }
  }
}
