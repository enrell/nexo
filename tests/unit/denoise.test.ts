import { randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDenoiseNode, DENOISE_ATTEN_DB, DENOISE_RATE, ensureGzip, fetchDenoiseAssets, loadDenoiseAssets, resetDenoiseCacheForTests } from "../../src/lib/denoise";

const BASE = new URL("nexo-app://app/denoise/");
const big = (n = 1_500_000) => new Uint8Array(n).fill(7).buffer;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
// gzip de dados aleatórios: não encolhe, então passa do tamanho mínimo que o carregador exige
const gzBig = () => ab(gzipSync(randomBytes(1_500_000)));
const res = (body: ArrayBuffer, status = 200) => ({ ok: status < 300, status, arrayBuffer: async () => body }) as unknown as Response;

describe("ensureGzip", () => {
  it("deixa passar o que já é gzip, sem tocar", async () => {
    const gz = ab(gzipSync(Buffer.from("tar")));
    expect(await ensureGzip(gz)).toBe(gz);
  });

  it("compacta de novo o que o servidor de desenvolvimento entregou já descompactado", async () => {
    const tar = ab(Buffer.from("conteúdo de um tar qualquer".repeat(50)));
    const out = await ensureGzip(tar);
    expect(new Uint8Array(out)[0]).toBe(0x1f);
    expect(gunzipSync(Buffer.from(out)).toString()).toBe("conteúdo de um tar qualquer".repeat(50));
  });

  it("arquivo vazio ou de 1 byte não quebra", async () => {
    expect(gunzipSync(Buffer.from(await ensureGzip(new ArrayBuffer(0)))).length).toBe(0);
    expect(gunzipSync(Buffer.from(await ensureGzip(new Uint8Array([0x1f]).buffer))).length).toBe(1);
  });
});

describe("fetchDenoiseAssets", () => {
  it("busca os dois arquivos na pasta do app e entrega os bytes (o worklet compila)", async () => {
    const urls: string[] = [];
    const wasm = big();
    const f = vi.fn(async (u: URL | string) => (urls.push(String(u)), res(String(u).endsWith("wasm") ? wasm : gzBig())));
    const a = await fetchDenoiseAssets(BASE, f as unknown as typeof fetch);
    expect(urls.sort()).toEqual(["nexo-app://app/denoise/DeepFilterNet3_onnx.tar.gz", "nexo-app://app/denoise/df_bg.wasm"]);
    expect(a.wasm).toBe(wasm);
    expect(new Uint8Array(a.model)[0]).toBe(0x1f);
  });

  it("falha se um arquivo não existe", async () => {
    const f = async (u: URL | string) => (String(u).endsWith("wasm") ? res(big(), 200) : res(new ArrayBuffer(0), 404));
    await expect(fetchDenoiseAssets(BASE, f as never)).rejects.toThrow("DeepFilterNet3_onnx.tar.gz: HTTP 404");
  });

  it("recusa arquivo truncado", async () => {
    const f = async (u: URL | string) => res(String(u).endsWith("wasm") ? big(10) : big());
    await expect(fetchDenoiseAssets(BASE, f as never)).rejects.toThrow("df_bg.wasm: arquivo truncado");
    const g = async (u: URL | string) => res(String(u).endsWith("wasm") ? big() : big(10));
    await expect(fetchDenoiseAssets(BASE, g as never)).rejects.toThrow("arquivo truncado");
  });
});

describe("loadDenoiseAssets (cache)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDenoiseCacheForTests();
  });

  it("carrega uma vez só e depois de uma falha tenta de novo", async () => {
    vi.stubGlobal("document", { baseURI: "nexo-app://app/index.html" });
    let fail = true;
    const f = vi.fn(async (u: URL | string) => (fail ? res(new ArrayBuffer(0), 500) : res(String(u).endsWith("wasm") ? big() : gzBig())));
    vi.stubGlobal("fetch", f);

    await expect(loadDenoiseAssets()).rejects.toThrow("HTTP 500");
    const calls = f.mock.calls.length;
    fail = false;
    const [a, b] = await Promise.all([loadDenoiseAssets(), loadDenoiseAssets()]);
    expect(a).toBe(b);
    expect(f.mock.calls.length).toBe(calls + 2); // 2 arquivos, apesar de duas chamadas
    expect(String(f.mock.calls.at(-1)![0])).toMatch(/^nexo-app:\/\/app\/denoise\//);
    expect(await loadDenoiseAssets()).toBe(a);
    expect(f.mock.calls.length).toBe(calls + 2);
  });
});

// ---------------------------------------------------------------- createDenoiseNode
type Port = { onmessage: ((e: { data: unknown }) => void) | null; sent: unknown[]; postMessage(m: unknown): void };
class FakeNode {
  static last: FakeNode;
  static args: unknown[];
  port: Port = { onmessage: null, sent: [], postMessage: (m) => this.port.sent.push(m) };
  disconnect = vi.fn();
  constructor(_ctx: unknown, name: string, opts: unknown) {
    FakeNode.last = this;
    FakeNode.args = [name, opts];
  }
  reply(data: unknown) {
    this.port.onmessage!({ data });
  }
}
const assets = { wasm: new ArrayBuffer(4), model: new ArrayBuffer(8) };
const fakeCtx = (sampleRate = DENOISE_RATE, addModule = vi.fn(async () => {})) => ({ sampleRate, audioWorklet: { addModule } }) as unknown as AudioContext;

describe("createDenoiseNode", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { baseURI: "nexo-app://app/index.html" });
    vi.stubGlobal("AudioWorkletNode", FakeNode);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("só aceita 48 kHz, sem tocar no worklet", async () => {
    const addModule = vi.fn();
    await expect(createDenoiseNode(fakeCtx(44100, addModule), assets, () => {})).rejects.toThrow("44100 Hz");
    expect(addModule).not.toHaveBeenCalled();
  });

  it("carrega o worklet do app, manda o modelo e só resolve quando ele diz que está pronto", async () => {
    const addModule = vi.fn(async () => {});
    let done = false;
    const p = createDenoiseNode(fakeCtx(DENOISE_RATE, addModule), assets, () => {}).then((n) => ((done = true), n));
    await vi.waitFor(() => expect(FakeNode.last?.port.sent.length).toBe(1));
    expect(addModule).toHaveBeenCalledWith("nexo-app://app/denoise/worklet.js");
    expect(FakeNode.args).toEqual(["nexo-denoise", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit" }]);
    expect(FakeNode.last.port.sent[0]).toEqual({ type: "init", wasm: assets.wasm, model: assets.model, atten: DENOISE_ATTEN_DB });
    await Promise.resolve();
    expect(done).toBe(false);
    FakeNode.last.reply({ type: "ready", hop: 480 });
    expect(await p).toBe(FakeNode.last);
  });

  it("rejeita com a mensagem do worklet e solta o nó", async () => {
    const p = createDenoiseNode(fakeCtx(), assets, () => {});
    await vi.waitFor(() => expect(FakeNode.last?.port.sent.length).toBe(1));
    FakeNode.last.reply({ type: "error", message: "modelo ruim" });
    await expect(p).rejects.toThrow("modelo ruim");
    expect(FakeNode.last.disconnect).toHaveBeenCalled();
  });

  it("rejeita se o worklet nunca responde (tempo esgotado)", async () => {
    vi.useFakeTimers();
    try {
      const p = createDenoiseNode(fakeCtx(), assets, () => {}, 5000);
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(5001);
      expect(String(await caught)).toContain("não respondeu a tempo");
      expect(FakeNode.last.disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falha do addModule (arquivo bloqueado pela CSP, por exemplo) rejeita", async () => {
    await expect(createDenoiseNode(fakeCtx(DENOISE_RATE, vi.fn(async () => { throw new Error("blocked"); })), assets, () => {})).rejects.toThrow("blocked");
  });

  it("depois de pronto, erros do worklet vão para o chamador e outras mensagens são ignoradas", async () => {
    const errors: string[] = [];
    const p = createDenoiseNode(fakeCtx(), assets, (m) => errors.push(m));
    await vi.waitFor(() => expect(FakeNode.last?.port.sent.length).toBe(1));
    FakeNode.last.reply({ type: "ready" });
    await p;
    FakeNode.last.reply({ type: "error", message: "caiu" });
    FakeNode.last.reply({ type: "ready" });
    FakeNode.last.reply(null);
    expect(errors).toEqual(["caiu"]);
  });
});
