/**
 * Redutor de ruído da voz: DeepFilterNet3 (rede neural, MIT/Apache-2.0) compilado para WebAssembly e
 * executado num AudioWorklet, dentro do próprio computador. Os arquivos ficam em public/denoise/ e vão
 * no instalador (nada é baixado de fora: a CSP e o filtro de rede do Electron nem deixariam).
 *
 * Aqui fica só o carregamento; o processamento está em public/denoise/worklet.js.
 */

/** O modelo foi treinado em 48 kHz: o AudioContext precisa rodar nessa taxa. */
export const DENOISE_RATE = 48000;
/** Redução máxima de ruído (dB). */
export const DENOISE_ATTEN_DB = 100;

const READY_TIMEOUT_MS = 15_000;
// um .wasm ou modelo que não tenha nem 1 MB não é o nosso: melhor recusar do que tentar executar
const MIN_WASM = 1_000_000;
const MIN_MODEL = 1_000_000;

/** Os bytes crus: o worklet compila o WebAssembly (um Module compilado aqui não atravessa até ele no Electron). */
export type DenoiseAssets = { wasm: ArrayBuffer; model: ArrayBuffer };

const isGzip = (b: ArrayBuffer) => {
  const v = new Uint8Array(b, 0, Math.min(2, b.byteLength));
  return v.length === 2 && v[0] === 0x1f && v[1] === 0x8b;
};

/**
 * O libDF lê o modelo como .tar.gz. O servidor de desenvolvimento do Vite serve esse arquivo com
 * `Content-Encoding: gzip`, e aí o navegador já o entrega descompactado: compactamos de novo.
 */
export async function ensureGzip(b: ArrayBuffer): Promise<ArrayBuffer> {
  if (isGzip(b)) return b;
  return new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

export async function fetchDenoiseAssets(base: URL, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<DenoiseAssets> {
  const get = async (file: string, min: number) => {
    const res = await fetchFn(new URL(file, base));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength < min) throw new Error(`${file}: arquivo truncado`);
    return bytes;
  };
  const [wasm, model] = await Promise.all([get("df_bg.wasm", MIN_WASM), get("DeepFilterNet3_onnx.tar.gz", MIN_MODEL)]);
  return { wasm, model: await ensureGzip(model) };
}

let cached: Promise<DenoiseAssets> | null = null;

/** Lê (uma vez só) o WebAssembly e o modelo. Uma falha não fica guardada: a próxima tentativa recarrega. */
export function loadDenoiseAssets(): Promise<DenoiseAssets> {
  cached ??= fetchDenoiseAssets(new URL("denoise/", document.baseURI)).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

export function resetDenoiseCacheForTests() {
  cached = null;
}

/**
 * Cria o nó que filtra o microfone. Só resolve depois de o modelo estar carregado dentro do worklet
 * (até lá ele só emitiria silêncio). Erros que surjam depois chegam em `onError`.
 */
export async function createDenoiseNode(ctx: AudioContext, assets: DenoiseAssets, onError: (message: string) => void, timeoutMs = READY_TIMEOUT_MS): Promise<AudioWorkletNode> {
  if (ctx.sampleRate !== DENOISE_RATE) throw new Error(`o áudio está em ${ctx.sampleRate} Hz e o redutor exige ${DENOISE_RATE} Hz`);
  await ctx.audioWorklet.addModule(new URL("denoise/worklet.js", document.baseURI).href);
  const node = new AudioWorkletNode(ctx, "nexo-denoise", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit" });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("o redutor de ruído não respondeu a tempo")), timeoutMs);
    node.port.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      if (e.data?.type === "ready") resolve();
      else reject(new Error(String(e.data?.message ?? "falha ao iniciar o redutor de ruído")));
    };
    node.port.postMessage({ type: "init", wasm: assets.wasm, model: assets.model, atten: DENOISE_ATTEN_DB });
  }).catch((e) => {
    node.disconnect();
    throw e;
  });
  node.port.onmessage = (e: MessageEvent) => {
    if (e.data?.type === "error") onError(String(e.data.message));
  };
  return node;
}
