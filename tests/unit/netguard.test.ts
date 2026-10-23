import dns from "node:dns";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const { isPrivateIp, safeLookup } = createRequire(import.meta.url)("../../electron/netguard.cjs") as {
  isPrivateIp: (ip: unknown) => boolean;
  safeLookup: (host: string, opts: { all?: boolean; family?: number }, cb: (err: Error | null, a?: unknown, f?: number) => void) => void;
};

describe("isPrivateIp: endereços internos são sempre bloqueados", () => {
  it.each([
    // IPv4
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254", // metadados de nuvem
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.0.1",
    "192.168.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6
    "::",
    "::1",
    "0:0:0:0:0:0:0:1", // ::1 escrito por extenso: o guarda antigo deixava passar
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fe80::1%eth0", // com zona de interface
    "ff02::1",
    // IPv4 dentro de IPv6
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // mesma coisa em hexadecimal: o guarda antigo deixava passar
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::ffff:c0a8:1",
    "::ffff:169.254.169.254",
    // túneis que carregam um IPv4 qualquer
    "64:ff9b::7f00:1", // NAT64
    "2002:7f00:1::", // 6to4
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
    "[::1]",
  ])("%s", (ip) => expect(isPrivateIp(ip), ip).toBe(true));
});

describe("isPrivateIp: endereços públicos passam", () => {
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "198.17.255.255", "198.20.0.1", "223.255.255.255", "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::200e"])("%s", (ip) => expect(isPrivateIp(ip), ip).toBe(false));
});

describe("isPrivateIp: na dúvida, bloqueia", () => {
  it.each([["não é IP", "exemplo.com"], ["vazio", ""], ["lixo", "999.1.1.1"], ["número", 123], ["null", null], ["undefined", undefined], ["objeto", {}], ["injeção", "8.8.8.8/../1"]])("%s", (_n, v) => expect(isPrivateIp(v)).toBe(true));
});

describe("safeLookup (evita DNS rebinding)", () => {
  afterEach(() => vi.restoreAllMocks());
  const mockDns = (addrs: { address: string; family: number }[] | Error) =>
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) => (addrs instanceof Error ? cb(addrs) : cb(null, addrs))) as never);

  it("filtra os endereços internos e deixa só os públicos", async () => {
    mockDns([
      { address: "127.0.0.1", family: 4 },
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:7f00:1", family: 6 },
    ]);
    const out = await new Promise((res, rej) => safeLookup("x.com", { all: true }, (e, a) => (e ? rej(e) : res(a))));
    expect(out).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("sem all: devolve o primeiro público com a família", async () => {
    mockDns([
      { address: "10.0.0.5", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    const out = await new Promise<[unknown, unknown]>((res, rej) => safeLookup("x.com", {}, (e, a, f) => (e ? rej(e) : res([a, f]))));
    expect(out).toEqual(["2606:4700::1111", 6]);
  });

  it("se o nome só resolve para endereço interno (rebinding), recusa", async () => {
    mockDns([{ address: "192.168.0.10", family: 4 }]);
    await expect(new Promise((res, rej) => safeLookup("evil.com", { all: true }, (e, a) => (e ? rej(e) : res(a))))).rejects.toThrow("endereço bloqueado");
  });

  it("propaga erro de DNS", async () => {
    mockDns(new Error("ENOTFOUND"));
    await expect(new Promise((res, rej) => safeLookup("nao-existe.invalid", {}, (e, a) => (e ? rej(e) : res(a))))).rejects.toThrow("ENOTFOUND");
  });
});
