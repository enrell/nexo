// Converte os blocos de 128 amostras do AudioWorklet nos quadros de 480 amostras (10 ms a 48 kHz)
// que o DeepFilterNet exige, e de volta. Sem dependências: o worklet e os testes usam o mesmo arquivo.
//
// A saída sai atrasada em exatamente `hop` amostras (10 ms): a fila de saída começa com um quadro de
// silêncio, e é isso que garante que ela nunca fique vazia, seja qual for o tamanho do bloco.

class Fifo {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.head = 0;
    this.size = 0;
  }
  push(src) {
    if (this.size + src.length > this.buf.length) this.grow(this.size + src.length);
    for (let i = 0; i < src.length; i++) this.buf[(this.head + this.size + i) % this.buf.length] = src[i];
    this.size += src.length;
  }
  /** Tira `dst.length` amostras; o que faltar vira silêncio. Devolve quantas faltaram. */
  pop(dst) {
    const n = Math.min(dst.length, this.size);
    for (let i = 0; i < n; i++) dst[i] = this.buf[(this.head + i) % this.buf.length];
    dst.fill(0, n);
    this.head = (this.head + n) % this.buf.length;
    this.size -= n;
    return dst.length - n;
  }
  grow(min) {
    const next = new Float32Array(Math.max(min, this.buf.length * 2));
    for (let i = 0; i < this.size; i++) next[i] = this.buf[(this.head + i) % this.buf.length];
    this.buf = next;
    this.head = 0;
  }
}

export class Framer {
  /**
   * @param {number} hop amostras por quadro (480 no DeepFilterNet3)
   * @param {(frame: Float32Array) => Float32Array} processFrame recebe um quadro e devolve outro do mesmo tamanho
   */
  constructor(hop, processFrame) {
    if (!Number.isInteger(hop) || hop <= 0) throw new RangeError("hop inválido");
    this.hop = hop;
    this.processFrame = processFrame;
    this.acc = new Float32Array(hop);
    this.accLen = 0;
    this.out = new Fifo(hop * 4);
    this.out.push(new Float32Array(hop));
    /** amostras de saída que faltaram (deveria ficar sempre 0) */
    this.underruns = 0;
  }

  /** Consome `input` e preenche `output` (mesmo tamanho). */
  run(input, output) {
    for (let i = 0; i < input.length; i++) {
      this.acc[this.accLen++] = input[i];
      if (this.accLen === this.hop) {
        const frame = this.processFrame(this.acc);
        if (!frame || frame.length !== this.hop) throw new RangeError("o quadro processado tem tamanho errado");
        this.out.push(frame);
        this.accLen = 0;
      }
    }
    this.underruns += this.out.pop(output);
  }
}
