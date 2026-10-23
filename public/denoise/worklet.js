// Processador de áudio do redutor de ruído (DeepFilterNet3). Roda no AudioWorkletGlobalScope.
// Mensagens da página:  { type: "init", wasm: ArrayBuffer, model: ArrayBuffer, atten: number }
// (os bytes, não um WebAssembly.Module: no Electron um Module enviado ao worklet se perde em silêncio)
// Respostas:            { type: "ready", hop } | { type: "error", message }
import "./shim.js";
import { initSync, df_create, df_get_frame_length, df_process_frame, df_set_atten_lim } from "./df.js";
import { Framer } from "./framer.js";

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framer = null;
    this.state = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
    // mensagem que não pôde ser desserializada: sem isto a página esperaria para sempre
    this.port.onmessageerror = () => this.port.postMessage({ type: "error", message: "mensagem ilegível no worklet" });
  }

  onMessage(msg) {
    try {
      if (msg?.type === "init" && !this.framer) {
        initSync({ module: msg.wasm });
        this.state = df_create(new Uint8Array(msg.model), msg.atten);
        const hop = df_get_frame_length(this.state);
        this.framer = new Framer(hop, (frame) => df_process_frame(this.state, frame));
        this.port.postMessage({ type: "ready", hop });
      } else if (msg?.type === "atten" && this.framer && Number.isFinite(msg.value)) {
        df_set_atten_lim(this.state, msg.value);
      }
    } catch (err) {
      this.framer = null;
      this.port.postMessage({ type: "error", message: String(err?.message ?? err) });
    }
  }

  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const input = inputs[0]?.[0];
    // sem modelo carregado (ou sem entrada) sai silêncio: nunca o microfone sem tratamento
    if (!this.framer || !input) return (out.fill(0), true);
    try {
      this.framer.run(input, out);
    } catch (err) {
      this.framer = null;
      out.fill(0);
      this.port.postMessage({ type: "error", message: String(err?.message ?? err) });
    }
    return true;
  }
}

registerProcessor("nexo-denoise", DenoiseProcessor);
