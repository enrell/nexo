// Os arquivos do redutor de ruído vão commitados e empacotados: aqui se confere que são exatamente os
// que foram revisados (hash), que o app consegue carregá-los (CSP, MIME) e que nada precisa de rede.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const DIR = new URL("public/denoise/", ROOT);
const read = (rel: string) => readFileSync(new URL(rel, ROOT));
const text = (rel: string) => read(rel).toString("utf8");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// Pinado aqui E em scripts/build-denoise.sh: trocar o modelo exige mexer nos dois.
const MODEL_SHA256 = "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616";
// a verificação de mutação altera os .js de propósito; os binários continuam sendo conferidos
const mutating = !!process.env.NEXO_MUTATING;

const sums = new Map(
  text("public/denoise/SHA256SUMS")
    .trim()
    .split("\n")
    .map((l) => {
      const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
      if (!m) throw new Error("linha inválida em SHA256SUMS: " + l);
      return [m[2], m[1]] as const;
    }),
);

describe("arquivos do redutor de ruído", () => {
  it("SHA256SUMS cobre todos os arquivos da pasta (e nada além)", () => {
    const files = readdirSync(DIR).filter((f) => f !== "SHA256SUMS" && f !== "NOTICE.md");
    expect([...sums.keys()].sort()).toEqual(files.sort());
  });

  for (const [file, hash] of sums) {
    const isCode = file.endsWith(".js") && !file.startsWith("df.js");
    it(`${file} confere com o SHA256SUMS`, ({ skip }) => {
      if (mutating && isCode) skip();
      expect(sha(read("public/denoise/" + file))).toBe(hash);
    });
  }

  it("o modelo é o DeepFilterNet3 oficial (hash fixo) e é um .tar.gz", () => {
    const model = read("public/denoise/DeepFilterNet3_onnx.tar.gz");
    expect(sha(model)).toBe(MODEL_SHA256);
    expect([model[0], model[1]]).toEqual([0x1f, 0x8b]);
    expect(text("scripts/build-denoise.sh")).toContain(`MODEL_SHA256=${MODEL_SHA256}`);
  });

  it("o .wasm é WebAssembly de verdade, de tamanho plausível, e não pede nada fora do esperado", async () => {
    const wasm = read("public/denoise/df_bg.wasm");
    expect([...wasm.subarray(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d]);
    expect(wasm.length).toBeGreaterThan(5_000_000);
    expect(wasm.length).toBeLessThan(30_000_000);
    const mod = await WebAssembly.compile(wasm);
    // tudo o que ele importa vem do df.js (wasm-bindgen): nenhum acesso direto a sistema
    const modules = new Set(WebAssembly.Module.imports(mod).map((i) => i.module));
    expect([...modules]).toEqual(["./df_bg.js"]);
    expect(WebAssembly.Module.exports(mod).map((e) => e.name)).toEqual(expect.arrayContaining(["df_create", "df_process_frame", "df_get_frame_length", "df_set_atten_lim"]));
  });

  it("nada é buscado fora do app: sem URL http(s) no código que roda no worklet nem no carregador", () => {
    for (const f of ["public/denoise/worklet.js", "public/denoise/shim.js", "public/denoise/framer.js", "src/lib/denoise.ts"]) {
      expect(text(f), f).not.toMatch(/https?:\/\//);
    }
    // o glue do wasm-bindgen só cita http no comentário/ajuda; o que vale é não haver fetch nem import externo
    const glue = text("public/denoise/df.js");
    expect(glue).not.toMatch(/\b(import|fetch)\s*\(\s*["'`]https?:/);
  });

  it("o worklet registra o nome que o carregador usa e fala o mesmo protocolo de mensagens", () => {
    const worklet = text("public/denoise/worklet.js");
    const loader = text("src/lib/denoise.ts");
    expect(worklet).toContain('registerProcessor("nexo-denoise"');
    expect(loader).toContain('"nexo-denoise"');
    for (const t of ["init", "ready", "error"]) {
      expect(worklet, t).toContain(`"${t}"`);
      expect(loader, t).toContain(`"${t}"`);
    }
    // o worklet precisa importar o shim ANTES do glue (a ordem dos imports é a ordem de avaliação)
    expect(worklet.indexOf('import "./shim.js"')).toBeGreaterThanOrEqual(0);
    expect(worklet.indexOf('import "./shim.js"')).toBeLessThan(worklet.indexOf('from "./df.js"'));
  });

  it("a CSP do build libera compilar WebAssembly, mas não eval", () => {
    const csp = /script-src ([^;]*);/.exec(text("vite.config.ts"))![1].split(/\s+/);
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("o protocolo do app serve .wasm com o tipo certo", () => {
    expect(text("electron/main.cjs")).toContain('".wasm": "application/wasm"');
  });

  it("o instalador leva a pasta (vai dentro de dist/, que o Vite copia de public/)", () => {
    const pkg = JSON.parse(text("package.json"));
    expect(pkg.build.files).toContain("dist/**");
  });
});
