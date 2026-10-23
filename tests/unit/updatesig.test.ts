import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Info = { version?: unknown; nexoSignature?: unknown };
const sig = createRequire(import.meta.url)("../../electron/updatesig.cjs") as {
  PUBLIC_KEYS: string[];
  payload: (version: string, sha512: string) => string;
  sha512File: (file: string) => Promise<string>;
  signUpdate: (pem: string, version: string, sha512: string) => string;
  verifyUpdate: (info: Info | null, file: string, keys?: string[]) => Promise<string | null>;
  publicKeyObject: (b64: string) => crypto.KeyObject;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-sig-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }) as string, pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64") };
}
const sha = (data: Buffer) => crypto.createHash("sha512").update(data).digest("base64");

let installer: string;
const BYTES = crypto.randomBytes(200_000);
beforeAll(() => {
  installer = path.join(tmp, "Nexo-Setup-1.2.3.exe");
  fs.writeFileSync(installer, BYTES);
});

describe("o que é assinado", () => {
  it("formato fixo: mudar quebraria a atualização de quem já tem o app", () => {
    expect(sig.payload("1.2.3", "QUJD")).toBe("nexo-update-v1\nversion=1.2.3\nsha512=QUJD");
  });

  // vetor calculado à parte com a biblioteca `cryptography` do Python (chave = bytes 0..31); o Ed25519 é determinístico
  const SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  const PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), SEED]).toString("base64")}\n-----END PRIVATE KEY-----\n`;
  it("a assinatura bate byte a byte com a implementação de referência", () => {
    expect(sig.signUpdate(PEM, "1.2.3", "QUJD")).toBe("LsDwmXj35SpsLlWqua+LSm0k2ogiWrg7pVFznl/z5aqHLBSgL91hf6Bcnj7KIF/fcqZkiqdxolWwPyHAPdOuDg==");
  });
  it("e é aceita com a chave pública de referência", async () => {
    const file = path.join(tmp, "abc.bin");
    fs.writeFileSync(file, "ABC"); // sha512("ABC") em base64 é o que entra no payload
    const info = { version: "1.2.3", nexoSignature: sig.signUpdate(PEM, "1.2.3", await sig.sha512File(file)) };
    expect(await sig.verifyUpdate(info, file, ["A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg="])).toBeNull();
  });
});

describe("verifyUpdate", () => {
  const k = keypair();
  const good = async (version = "1.2.3"): Promise<Info> => ({ version, nexoSignature: sig.signUpdate(k.pem, version, sha(BYTES)) });

  it("aceita a atualização assinada com a chave do projeto", async () => {
    expect(await sig.verifyUpdate(await good(), installer, [k.pub])).toBeNull();
  });

  it("recusa se o instalador foi trocado, mesmo por um só byte", async () => {
    const info = await good();
    const bad = path.join(tmp, "trocado.exe");
    const b = Buffer.from(BYTES);
    b[100_000] ^= 1;
    fs.writeFileSync(bad, b);
    expect(await sig.verifyUpdate(info, bad, [k.pub])).toMatch(/não confere/);
    fs.writeFileSync(bad, Buffer.concat([BYTES, Buffer.from([0])]));
    expect(await sig.verifyUpdate(info, bad, [k.pub])).toMatch(/não confere/);
  });

  it("recusa reaproveitar a assinatura de uma versão antiga para uma nova (rebaixamento)", async () => {
    const old = await good("1.0.0");
    expect(await sig.verifyUpdate({ ...old, version: "9.9.9" }, installer, [k.pub])).toMatch(/não confere/);
  });

  it("recusa assinatura de outra chave (atacante com a própria chave)", async () => {
    const attacker = keypair();
    const info = { version: "1.2.3", nexoSignature: sig.signUpdate(attacker.pem, "1.2.3", sha(BYTES)) };
    expect(await sig.verifyUpdate(info, installer, [k.pub])).toMatch(/não confere/);
  });

  it("troca de chave: vale se qualquer uma das chaves aceitas assinou; chave inválida na lista é pulada", async () => {
    const next = keypair();
    const info = { version: "1.2.3", nexoSignature: sig.signUpdate(next.pem, "1.2.3", sha(BYTES)) };
    expect(await sig.verifyUpdate(info, installer, [k.pub, next.pub])).toBeNull();
    expect(await sig.verifyUpdate(info, installer, ["lixo", "", next.pub])).toBeNull();
    expect(await sig.verifyUpdate(info, installer, [])).toMatch(/não confere/);
    expect(await sig.verifyUpdate(info, installer, ["lixo"])).toMatch(/não confere/);
  });

  it("sem assinatura no latest.yml, ou de tipo errado, é recusada (não existe 'atualização sem assinatura')", async () => {
    for (const info of [null, {}, { version: "1.2.3" }, { nexoSignature: "x" }, { version: 123, nexoSignature: "x" }, { version: "1.2.3", nexoSignature: 5 }, { version: "1.2.3", nexoSignature: null }] as (Info | null)[])
      expect(await sig.verifyUpdate(info, installer, [k.pub]), JSON.stringify(info)).toMatch(/não traz a assinatura/);
  });

  it("assinatura malformada é recusada sem lançar", async () => {
    for (const s of ["", "abc", "!!!", Buffer.alloc(63).toString("base64"), Buffer.alloc(65).toString("base64"), Buffer.alloc(64).toString("base64")]) expect(await sig.verifyUpdate({ version: "1.2.3", nexoSignature: s }, installer, [k.pub]), s).toMatch(/malformada|não confere/);
  });

  it("versão que não parece versão é recusada", async () => {
    for (const v of ["", "1", "1.2", "v1.2.3", "1.2.3\nsha512=x", "1.2.3; calc", "../1.2.3", "1.2.3-" + "a".repeat(40), "1.2.3 "]) expect(await sig.verifyUpdate({ version: v, nexoSignature: "x" }, installer, [k.pub]), JSON.stringify(v)).toBe("versão inválida");
    expect(await sig.verifyUpdate(await good("1.2.3-beta.1"), installer, [k.pub])).toBeNull();
  });

  it("arquivo que não existe é erro (a atualização é descartada)", async () => {
    await expect(sig.verifyUpdate(await good(), path.join(tmp, "nao-existe.exe"), [k.pub])).rejects.toThrow();
  });

  it("não confunde injeção de linhas no payload: versão e hash são campos separados", () => {
    expect(sig.payload("1.2.3", "a\nsha512=b")).not.toBe(sig.payload("1.2.3", "b"));
  });
});

describe("signUpdate", () => {
  const k = keypair();
  it("recusa versão inválida", () => {
    expect(() => sig.signUpdate(k.pem, "1.2", "x")).toThrow(/versão inválida/);
    expect(() => sig.signUpdate(k.pem, "1.2.3\nx", "x")).toThrow(/versão inválida/);
  });
  it("é determinística e tem 64 bytes", () => {
    const a = sig.signUpdate(k.pem, "1.2.3", "h");
    expect(a).toBe(sig.signUpdate(k.pem, "1.2.3", "h"));
    expect(Buffer.from(a, "base64")).toHaveLength(64);
  });
});

describe("chave pública embutida no app", () => {
  it("existe, é uma chave Ed25519 de 32 bytes e não é o texto de preenchimento", () => {
    expect(sig.PUBLIC_KEYS.length).toBeGreaterThan(0);
    for (const key of sig.PUBLIC_KEYS) {
      expect(key).not.toContain("__");
      expect(Buffer.from(key, "base64")).toHaveLength(32);
      expect(sig.publicKeyObject(key).asymmetricKeyType).toBe("ed25519");
    }
  });
});
