// Extrai do CHANGELOG.md a seção de uma versão (para as notas da release).
// Uso: node scripts/release-notes.mjs 0.3.0 [> notas.md]
// Sai com erro se a versão não existir no CHANGELOG ou estiver vazia.
import fs from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("uso: node scripts/release-notes.mjs <versão>");
  process.exit(2);
}
const lines = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n").split("\n");
// comparação de texto simples (sem montar regex com o argumento)
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md não tem a seção "## [${version}]"`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
if (end === -1) end = lines.length;
const body = lines
  .slice(start + 1, end)
  .filter((l) => !/^\[[^\]]+\]:/.test(l))
  .join("\n")
  .trim();
if (!body) {
  console.error(`a seção ${version} do CHANGELOG.md está vazia`);
  process.exit(1);
}
process.stdout.write(body + "\n");
