// Roda o processador REAL (public/denoise/worklet.js) com o WebAssembly e o modelo que vão no instalador,
// num AudioWorkletGlobalScope de mentira: é o mesmo caminho que o áudio do microfone faz no app.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const DIR = new URL("../../public/denoise/", import.meta.url);
const FIXTURE = new URL("./fixtures/speech-48k.wav", import.meta.url);
const SR = 48000;
const QUANTUM = 128;

type Msg = { type: string; message?: string; hop?: number };
class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: Msg[] = [];
  postMessage(m: Msg) {
    this.posted.push(m);
  }
}
class FakeProcessor {
  port = new FakePort();
}
type Processor = FakeProcessor & { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
let Ctor: new () => Processor;
let wasm: ArrayBuffer;
const model = () => {
  const b = readFileSync(new URL("DeepFilterNet3_onnx.tar.gz", DIR));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

beforeAll(async () => {
  const registry = new Map<string, unknown>();
  Object.assign(globalThis, { AudioWorkletProcessor: FakeProcessor, registerProcessor: (n: string, c: unknown) => registry.set(n, c) });
  await import("../../public/denoise/worklet.js");
  Ctor = registry.get("nexo-denoise") as typeof Ctor;
  const b = readFileSync(new URL("df_bg.wasm", DIR));
  wasm = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});

const send = (p: Processor, data: unknown) => p.port.onmessage!({ data });
const ready = () => {
  const p = new Ctor();
  send(p, { type: "init", wasm, model: model(), atten: 100 });
  return p;
};

/** passa o sinal pelo processador em blocos de 128, como o navegador faz */
function render(p: Processor, input: Float32Array) {
  const out = new Float32Array(input.length);
  for (let i = 0; i + QUANTUM <= input.length; i += QUANTUM) p.process([[input.subarray(i, i + QUANTUM)]], [[out.subarray(i, i + QUANTUM)]]);
  return out;
}

const speech = () => {
  const b = readFileSync(FIXTURE);
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.readUInt32LE(24)).toBe(SR);
  return Float32Array.from(new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length - ((b.length - 44) % 2))), (v) => v / 32768);
};
const rms = (a: Float32Array, from = 0, to = a.length) => {
  let x = 0;
  for (let i = from; i < to; i++) x += a[i] * a[i];
  return Math.sqrt(x / (to - from));
};
const db = (x: number) => 20 * Math.log10(x + 1e-12);

/** ruído de ventilador/zumbido, determinístico */
function fan(n: number) {
  let seed = 1;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  let lp = 0;
  return Float32Array.from({ length: n }, (_, i) => ((lp += 0.3 * (r() - lp)), lp * 0.25 + 0.03 * Math.sin((2 * Math.PI * 120 * i) / SR)));
}

/** melhor alinhamento entre a saída e a fala limpa: devolve atraso, correlação e erro em dB */
function align(out: Float32Array, clean: Float32Array) {
  let best = { lag: 0, corr: -1 };
  for (let lag = 0; lag < 3000; lag++) {
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + lag < clean.length; i += 4) {
      num += out[i + lag] * clean[i];
      d1 += out[i + lag] ** 2;
      d2 += clean[i] ** 2;
    }
    const corr = num / Math.sqrt(d1 * d2);
    if (corr > best.corr) best = { lag, corr };
  }
  const n = clean.length - best.lag;
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = out[i + best.lag] - clean[i];
  return { ...best, errDb: db(rms(res) / rms(clean, 0, n)) };
}

describe("worklet do redutor de ruído (DeepFilterNet3 real)", () => {
  it("avisa que está pronto e informa o tamanho do quadro", () => {
    const p = ready();
    expect(p.port.posted).toEqual([{ type: "ready", hop: 480 }]);
  });

  it("um segundo init é ignorado: o estado do modelo não é recriado nem duplicado", () => {
    const p = ready();
    send(p, { type: "init", wasm, model: model(), atten: 100 });
    expect(p.port.posted).toEqual([{ type: "ready", hop: 480 }]);
  });

  it("antes de o modelo carregar, sai silêncio — nunca o microfone sem tratamento", () => {
    const p = new Ctor();
    const input = Float32Array.from({ length: QUANTUM }, () => 0.5);
    const out = new Float32Array(QUANTUM).fill(9);
    expect(p.process([[input]], [[out]])).toBe(true);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("sem entrada conectada, sai silêncio e o processador continua vivo", () => {
    const p = ready();
    const out = new Float32Array(QUANTUM).fill(9);
    expect(p.process([[]], [[out]])).toBe(true);
    expect(out.every((v) => v === 0)).toBe(true);
    expect(p.process([], [[out]])).toBe(true);
    expect(p.process([[new Float32Array(QUANTUM)]], [])).toBe(true); // sem saída: não lança
  });

  it("ruído de fundo sozinho some (queda de mais de 40 dB)", () => {
    const n = SR * 3;
    const noise = fan(n);
    const out = render(ready(), noise);
    const before = db(rms(noise, SR, n));
    const after = db(rms(out, SR, n));
    expect(before).toBeGreaterThan(-30);
    expect(before - after).toBeGreaterThan(40);
  });

  it("a fala sobrevive ao ruído: correlação alta e erro bem menor que o do sinal sujo", () => {
    const clean = speech();
    const noise = fan(clean.length);
    const dirty = clean.map((v, i) => v + noise[i]);
    const dirtyErr = db(rms(dirty.map((v, i) => v - clean[i])) / rms(clean));
    expect(dirtyErr).toBeGreaterThan(-1); // ruído do tamanho da fala (0 dB)

    const a = align(render(ready(), dirty), clean);
    expect(a.corr).toBeGreaterThan(0.9);
    expect(a.errDb).toBeLessThan(dirtyErr - 6); // pelo menos 6 dB mais limpo
    // atraso total: ~30 ms do modelo + 10 ms do enquadramento
    expect(a.lag).toBeGreaterThanOrEqual(480);
    expect(a.lag).toBeLessThan(2400);
  });

  it("fala limpa passa quase intacta (não estraga a voz de quem está num lugar silencioso)", () => {
    const clean = speech();
    const a = align(render(ready(), clean), clean);
    expect(a.corr).toBeGreaterThan(0.95);
    expect(a.errDb).toBeLessThan(-10);
  });

  it("cada processador tem o seu estado: duas instâncias não se misturam", () => {
    const clean = speech().subarray(0, SR * 2);
    const a = render(ready(), clean);
    const b = render(ready(), clean);
    expect(b).toEqual(a);
  });

  it("limite de atenuação pode ser trocado em uso; valor que não é número é ignorado", () => {
    const p = ready();
    send(p, { type: "atten", value: 12 });
    send(p, { type: "atten", value: NaN });
    send(p, { type: "atten", value: "100" });
    expect(p.port.posted).toEqual([{ type: "ready", hop: 480 }]);
    const noise = fan(SR * 2);
    const out = render(p, noise);
    // com limite de 12 dB o ruído só cai ~12 dB: bem longe do silêncio de antes
    const drop = db(rms(noise, SR)) - db(rms(out, SR));
    expect(drop).toBeGreaterThan(6);
    expect(drop).toBeLessThan(30);
  });

  it("modelo corrompido: avisa o erro e passa a emitir só silêncio", () => {
    const p = new Ctor();
    send(p, { type: "init", wasm, model: new ArrayBuffer(64), atten: 100 });
    expect(p.port.posted).toHaveLength(1);
    expect(p.port.posted[0].type).toBe("error");
    expect(p.port.posted[0].message).toBeTruthy();
    const out = new Float32Array(QUANTUM).fill(9);
    p.process([[new Float32Array(QUANTUM).fill(0.5)]], [[out]]);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("wasm corrompido: avisa o erro", async () => {
    // cada AudioContext tem o seu escopo de worklet: carrega o módulo do zero, sem o wasm já iniciado
    vi.resetModules();
    const registry = new Map<string, unknown>();
    Object.assign(globalThis, { registerProcessor: (n: string, c: unknown) => registry.set(n, c) });
    await import("../../public/denoise/worklet.js");
    const Fresh = registry.get("nexo-denoise") as typeof Ctor;
    expect(Fresh).not.toBe(Ctor);
    const p = new Fresh();
    send(p, { type: "init", wasm: new ArrayBuffer(16), model: model(), atten: 100 });
    expect(p.port.posted.map((m) => m.type)).toEqual(["error"]);
  });

  it("mensagem que não pôde ser lida (messageerror) vira erro em vez de silêncio eterno", () => {
    const p = new Ctor() as Processor & { port: FakePort & { onmessageerror?: () => void } };
    p.port.onmessageerror!();
    expect(p.port.posted).toEqual([{ type: "error", message: "mensagem ilegível no worklet" }]);
  });

  it("mensagens estranhas são ignoradas", () => {
    const p = new Ctor();
    for (const m of [null, undefined, 5, "init", {}, { type: "atten", value: 3 }, { type: "nope" }]) send(p, m);
    expect(p.port.posted).toEqual([]);
  });
});
