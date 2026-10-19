// Extrai do CHANGELOG.md a seção de uma versão (para as notas da release).
// Uso: node scripts/release-notes.mjs 0.3.0 [> notas.md]
// Sai com erro se a versão não existir no CHANGELOG ou estiver vazia.
import fs from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("uso: node scripts/release-notes.mjs <versão>");
  process.exit(2);
}
const text = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const header = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*$`, "m");
const m = header.exec(text);
if (!m) {
  console.error(`CHANGELOG.md não tem a seção "## [${version}]"`);
  process.exit(1);
}
const rest = text.slice(m.index + m[0].length);
const next = rest.search(/^## \[/m);
const body = (next === -1 ? rest : rest.slice(0, next)).replace(/^\[[^\]]+\]:.*$/gm, "").trim();
if (!body) {
  console.error(`a seção ${version} do CHANGELOG.md está vazia`);
  process.exit(1);
}
process.stdout.write(body + "\n");
