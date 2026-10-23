// O pipeline do microfone com o redutor de ruído: por onde o som passa, quando o redutor falha e o que
// o navegador recebe para fazer o trabalho no lugar dele. (Os nós de áudio são de mentira: o que se
// confere é a ligação entre eles e os pedidos de microfone.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../src/lib/types";

const denoiseMock = vi.hoisted(() => ({ create: vi.fn(), load: vi.fn() }));
vi.mock("../../src/lib/denoise", () => ({ DENOISE_RATE: 48000, loadDenoiseAssets: denoiseMock.load, createDenoiseNode: denoiseMock.create }));

import { AudioEngine } from "../../src/lib/audio";

class FNode {
  to: FNode[] = [];
  gain = { value: 1, setTargetAtTime() {} };
  fftSize = 0;
  constructor(public tag: string, public stream?: FStream) {}
  connect(n: FNode) {
    this.to.push(n);
    return n;
  }
  disconnect() {
    this.to = [];
  }
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(0); // o ciclo de 50 ms do motor lê o nível do microfone
  }
}
class FStream {
  stopped = 0;
  constructor(public id: number) {}
  getTracks() {
    return [{ stop: () => this.stopped++ }];
  }
}
let ctxOptions: unknown;
let sources: FNode[];
class FCtx {
  sampleRate = 48000;
  state = "running";
  currentTime = 0;
  destination = new FNode("out");
  constructor(o: unknown) {
    ctxOptions = o;
  }
  createGain() {
    return new FNode("gain");
  }
  createAnalyser() {
    return new FNode("analyser");
  }
  createMediaStreamSource(s: FStream) {
    const n = new FNode("mic-src", s);
    sources.push(n);
    return n;
  }
  createMediaStreamDestination() {
    return new FNode("dest", new FStream(-1));
  }
  resume() {
    return Promise.resolve();
  }
}

/** `a` alcança `b` seguindo as ligações? */
const reaches = (a: FNode, b: FNode): boolean => a === b || a.to.some((n) => reaches(n, b));
/** nós ligados diretamente à saída de `a` */
const direct = (a: FNode) => a.to.map((n) => n.tag);

let settings: Settings;
let engine: AudioEngine;
let streams: FStream[];
let constraints: Array<Record<string, unknown>>;
let pending: Array<(s: FStream) => void> | null;
let denoiseNode: FNode;
let onWorkletError: (m: string) => void;
const notices: string[] = [];

const inGain = () => (engine as unknown as { inGain: FNode }).inGain;
const dest = () => (engine as unknown as { dest: FNode }).dest;

beforeEach(() => {
  vi.useFakeTimers();
  settings = { noiseSuppression: true, echoCancellation: true, autoGain: true, inputDevice: "default", inputVolume: 100, outputVolume: 100, outputDevice: "default" } as Settings;
  streams = [];
  constraints = [];
  sources = [];
  pending = null;
  notices.length = 0;
  denoiseNode = new FNode("denoise");
  denoiseMock.load.mockReset().mockResolvedValue({ module: {}, model: new ArrayBuffer(1) });
  denoiseMock.create.mockReset().mockImplementation(async (_ctx, _assets, onError) => ((onWorkletError = onError), denoiseNode));
  vi.stubGlobal("AudioContext", FCtx);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn((c: { audio: Record<string, unknown> }) => {
        constraints.push(c.audio);
        const s = new FStream(streams.length);
        streams.push(s);
        return pending ? new Promise<FStream>((r) => pending!.push(() => r(s))) : Promise.resolve(s);
      }),
    },
  });
  engine = new AudioEngine(() => settings);
  engine.onNotice = (t) => notices.push(t);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  engine.stopMic();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** abre o microfone e espera o redutor terminar de carregar (e o microfone trocar para ele) */
async function startAndSettle() {
  const out = await engine.startMic();
  await engine.whenDenoiseSettled();
  return out;
}

describe("microfone com redutor de ruído (DeepFilterNet)", () => {
  it("o contexto de áudio roda a 48 kHz, que é o que o modelo exige", async () => {
    await engine.startMic();
    expect(ctxOptions).toMatchObject({ sampleRate: 48000 });
  });

  it("o microfone abre na hora, sem esperar o modelo: até lá o navegador faz a supressão", async () => {
    let finish!: (n: FNode) => void;
    denoiseMock.create.mockImplementation((_c, _a, onError) => ((onWorkletError = onError), new Promise((r) => (finish = r))));
    const out = await engine.startMic();
    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({ noiseSuppression: true });
    expect(direct(sources[0])).toEqual(["gain"]);
    expect(engine.denoiseStatus).toBe("loading");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(denoiseNode);
    await engine.whenDenoiseSettled();
    // pronto: troca para o redutor, sem trocar a stream enviada
    expect(constraints[1]).toMatchObject({ noiseSuppression: false, echoCancellation: true, autoGainControl: true, channelCount: 1 });
    expect(streams[0].stopped).toBe(1);
    expect(engine.micStream).toBe(out);
    expect(engine.denoiseStatus).toBe("on");
  });

  it("microfone → redutor → ganho: o som cru nunca chega ao ganho sem passar pelo redutor", async () => {
    await startAndSettle();
    const src = sources.at(-1)!;
    expect(direct(src)).toEqual(["denoise"]);
    expect(direct(denoiseNode)).toEqual(["gain"]);
    expect(denoiseNode.to[0]).toBe(inGain());
    expect(sources.slice(0, -1).every((n) => n.to.length === 0)).toBe(true); // a fonte provisória foi desligada
  });

  it("a stream enviada passa pelo ganho e pelo portão depois do redutor", async () => {
    const out = await startAndSettle();
    expect(reaches(denoiseNode, dest())).toBe(true);
    expect(out).toBe(dest().stream);
  });

  it("com o redutor já carregado, abrir o microfone de novo vai direto para ele (sem o navegador)", async () => {
    await startAndSettle();
    engine.stopMic();
    expect(engine.denoiseStatus).toBe("idle");
    const n = constraints.length;
    await engine.startMic();
    expect(constraints).toHaveLength(n + 1);
    expect(constraints[n]).toMatchObject({ noiseSuppression: false });
    expect(direct(sources.at(-1)!)).toEqual(["denoise"]);
    expect(denoiseMock.create).toHaveBeenCalledTimes(1);
  });

  it("com a opção desligada: nada de redutor, o navegador não faz supressão e o estado é 'off'", async () => {
    settings.noiseSuppression = false;
    await startAndSettle();
    expect(denoiseMock.load).not.toHaveBeenCalled();
    expect(denoiseMock.create).not.toHaveBeenCalled();
    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({ noiseSuppression: false });
    expect(direct(sources[0])).toEqual(["gain"]);
    expect(engine.denoiseStatus).toBe("off");
  });

  it("se o modelo não carrega, o navegador continua e o usuário é avisado uma vez, com o motivo", async () => {
    denoiseMock.create.mockRejectedValue(new Error("sem wasm"));
    await startAndSettle();
    expect(constraints).toHaveLength(1); // não reabre o microfone: ele já estava com o navegador
    expect(constraints[0]).toMatchObject({ noiseSuppression: true });
    expect(direct(sources[0])).toEqual(["gain"]);
    expect(notices).toEqual(["O redutor de ruído por IA não carregou (sem wasm); usando o do navegador."]);
    expect(engine.denoiseStatus).toBe("fallback");
    // não fica tentando de novo a cada vez que abre o microfone
    await startAndSettle();
    expect(denoiseMock.create).toHaveBeenCalledTimes(1);
    expect(constraints[1]).toMatchObject({ noiseSuppression: true });
    expect(notices).toHaveLength(1);
  });

  it("se os arquivos não carregam (rede/CSP), o resultado é o mesmo", async () => {
    denoiseMock.load.mockRejectedValue(new Error("HTTP 404"));
    await startAndSettle();
    expect(denoiseMock.create).not.toHaveBeenCalled();
    expect(constraints[0]).toMatchObject({ noiseSuppression: true });
    expect(engine.denoiseStatus).toBe("fallback");
  });

  it("desligar e religar a opção depois de uma falha tenta o redutor de novo", async () => {
    denoiseMock.create.mockRejectedValueOnce(new Error("falhou"));
    await startAndSettle();
    expect(engine.denoiseStatus).toBe("fallback");
    settings.noiseSuppression = false;
    engine.applySettings();
    expect(engine.denoiseBroken).toBe(true); // desligar sozinho não limpa a falha
    settings.noiseSuppression = true;
    engine.applySettings();
    expect(engine.denoiseBroken).toBe(false);
    await engine.restartMic();
    await engine.whenDenoiseSettled();
    expect(engine.denoiseStatus).toBe("on");
    expect(constraints.at(-1)).toMatchObject({ noiseSuppression: false });
  });

  it("mexer em outras configurações não apaga a falha do redutor", async () => {
    denoiseMock.create.mockRejectedValue(new Error("falhou"));
    await startAndSettle();
    engine.applySettings();
    settings.inputVolume = 50;
    engine.applySettings();
    expect(engine.denoiseBroken).toBe(true);
    await startAndSettle();
    expect(denoiseMock.create).toHaveBeenCalledTimes(1);
  });

  it("se o worklet falha com o microfone passando por ele, volta para o navegador na hora, sem trocar a stream enviada", async () => {
    const out = await startAndSettle();
    const n = sources.length;
    const before = streams.at(-1)!;
    onWorkletError("trap");
    await vi.waitFor(() => expect(sources).toHaveLength(n + 1));
    expect(constraints.at(-1)).toMatchObject({ noiseSuppression: true });
    expect(before.stopped).toBe(1);
    expect(direct(sources.at(-1)!)).toEqual(["gain"]);
    expect(denoiseNode.to).toEqual([]);
    expect(engine.micStream).toBe(out);
    expect(notices).toEqual(["O redutor de ruído por IA não carregou (trap); usando o do navegador."]);
    expect(engine.denoiseStatus).toBe("fallback");
    onWorkletError("de novo"); // não avisa duas vezes
    expect(notices).toHaveLength(1);
  });

  it("desligar a opção no meio da chamada tira o redutor do caminho; religar reaproveita o mesmo nó", async () => {
    await startAndSettle();
    settings.noiseSuppression = false;
    await engine.restartMic();
    expect(constraints.at(-1)).toMatchObject({ noiseSuppression: false });
    expect(direct(sources.at(-1)!)).toEqual(["gain"]);
    expect(denoiseNode.to).toEqual([]);
    expect(engine.denoiseStatus).toBe("off");
    settings.noiseSuppression = true;
    await engine.restartMic();
    expect(direct(sources.at(-1)!)).toEqual(["denoise"]);
    expect(denoiseNode.to[0]).toBe(inGain());
    expect(denoiseMock.create).toHaveBeenCalledTimes(1);
  });

  it("com a opção desligada, abrir o microfone não usa o redutor que já estava carregado", async () => {
    await startAndSettle();
    engine.stopMic();
    settings.noiseSuppression = false;
    await engine.startMic();
    expect(constraints.at(-1)).toMatchObject({ noiseSuppression: false });
    expect(direct(sources.at(-1)!)).toEqual(["gain"]);
    expect(denoiseNode.to).toEqual([]);
  });

  it("trocar de dispositivo mantém o redutor e solta o microfone antigo", async () => {
    await startAndSettle();
    const old = { stream: streams.at(-1)!, src: sources.at(-1)! };
    settings.inputDevice = "usb-1";
    await engine.restartMic();
    expect(constraints.at(-1)).toMatchObject({ deviceId: { exact: "usb-1" }, noiseSuppression: false });
    expect(old.stream.stopped).toBe(1);
    expect(old.src.to).toEqual([]);
    expect(direct(sources.at(-1)!)).toEqual(["denoise"]);
  });

  it("fechar o microfone desliga tudo", async () => {
    await startAndSettle();
    engine.stopMic();
    expect(sources.every((n) => n.to.length === 0)).toBe(true);
    expect(denoiseNode.to).toEqual([]);
    expect(streams.every((s) => s.stopped === 1)).toBe(true);
    expect(engine.micStream).toBeNull();
  });

  it("se o microfone é fechado enquanto o modelo carrega, ele não é reaberto quando o modelo fica pronto", async () => {
    let finish!: (n: FNode) => void;
    denoiseMock.create.mockImplementation((_c, _a, onError) => ((onWorkletError = onError), new Promise((r) => (finish = r))));
    await engine.startMic();
    engine.stopMic();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(denoiseNode);
    await engine.whenDenoiseSettled();
    expect(constraints).toHaveLength(1);
    expect(engine.micStream).toBeNull();
    expect(denoiseNode.to).toEqual([]);
  });

  it("se o microfone é fechado enquanto o novo ainda abre, o novo é solto e nada fica ligado", async () => {
    await startAndSettle();
    const n = sources.length;
    pending = [];
    const restart = engine.restartMic();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    engine.stopMic();
    pending[0](streams.at(-1)!);
    await restart;
    expect(streams.at(-1)!.stopped).toBe(1);
    expect(engine.micStream).toBeNull();
    expect(sources).toHaveLength(n);
  });

  it("restartMic sem microfone aberto não faz nada", async () => {
    await engine.restartMic();
    expect(constraints).toHaveLength(0);
  });
});
