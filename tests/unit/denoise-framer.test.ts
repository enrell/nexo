import { describe, expect, it } from "vitest";
import { Framer } from "../../public/denoise/framer.js";

const HOP = 480;
const noise = (n: number, seed = 7) => {
  let x = seed;
  return Float32Array.from({ length: n }, () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1);
};
const identity = (f: Float32Array) => Float32Array.from(f);

/** passa `input` pelo Framer em blocos de `quantum` amostras e junta a saída */
function through(framer: Framer, input: Float32Array, quantum: number) {
  const out = new Float32Array(input.length);
  for (let i = 0; i + quantum <= input.length; i += quantum) framer.run(input.subarray(i, i + quantum), out.subarray(i, i + quantum));
  return out;
}

describe("Framer", () => {
  // o worklet recebe 128 amostras por vez e o modelo quer 480: o resultado tem que ser a entrada, só atrasada
  for (const quantum of [128, 64, 200, 480, 1, 960, 5000]) {
    it(`com blocos de ${quantum}: a saída é a entrada atrasada em um quadro, sem falhas`, () => {
      const total = quantum * Math.ceil(HOP * 60 / quantum);
      const input = noise(total);
      const f = new Framer(HOP, identity);
      const out = through(f, input, quantum);
      const expected = new Float32Array(total);
      expected.set(input.subarray(0, total - HOP), HOP);
      expect(out).toEqual(expected);
      expect(f.underruns).toBe(0);
    });
  }

  it("entrega ao modelo quadros de exatamente `hop` amostras, na ordem, sem pular nem repetir", () => {
    const seen: Float32Array[] = [];
    const f = new Framer(HOP, (fr) => (seen.push(Float32Array.from(fr)), Float32Array.from(fr)));
    const input = noise(HOP * 9 + 77);
    through(f, input, 128);
    expect(seen.length).toBe(Math.floor((Math.floor(input.length / 128) * 128) / HOP));
    seen.forEach((fr, i) => {
      expect(fr.length).toBe(HOP);
      expect(fr).toEqual(input.subarray(i * HOP, (i + 1) * HOP));
    });
  });

  it("o que o modelo devolve é o que sai (não a entrada)", () => {
    const f = new Framer(HOP, (fr) => fr.map((v) => v * 0.5));
    const input = noise(HOP * 6, 3);
    const out = through(f, input, 120);
    for (let i = HOP; i < out.length; i++) expect(out[i]).toBeCloseTo(input[i - HOP] * 0.5, 6);
  });

  it("aceita bloco maior que a fila (ela cresce)", () => {
    const f = new Framer(4, identity);
    const input = noise(400);
    expect(through(f, input, 100).subarray(4)).toEqual(input.subarray(0, 396));
  });

  it("recusa hop inválido", () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(() => new Framer(bad, identity)).toThrow(RangeError);
  });

  it("recusa quadro de tamanho errado ou ausente vindo do modelo", () => {
    expect(() => through(new Framer(8, () => new Float32Array(7)), noise(64), 8)).toThrow(RangeError);
    expect(() => through(new Framer(8, () => undefined as unknown as Float32Array), noise(64), 8)).toThrow(RangeError);
  });
});
