import dgram from "node:dgram";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { mappedCandidate } from "../../src/lib/rtc";

type Status = { state: string; gateway?: string; externalIp?: string | null; mapped?: number; via?: string };
type Mapper = {
  status: () => Status;
  map: (ip: string, port: number) => Promise<{ ip: string; port: number } | null>;
  release: (port: number) => Promise<void>;
  releaseAll: (timeoutMs?: number) => Promise<void>;
};
const pm = createRequire(import.meta.url)("../../electron/portmap.cjs") as {
  createPortMapper: (o: { defaultGateway: () => Promise<string | null>; natpmpPort?: number; ssdpPort?: number; retryMs?: number }) => Mapper;
  parseDefaultGateway: (platform: string, out: string) => string | null;
  parseSsdpLocation: (msg: string, from: string) => string | null;
  parseIgdDescription: (xml: string, location: string) => { serviceType: string; controlUrl: string } | null;
  parseSoap: (status: number, xml: string, fields: string[]) => { ok: boolean; code?: number; fields?: Record<string, string | null> };
  natpmpMapRequest: (internal: number, external: number, lifetime: number) => Buffer;
  parseNatpmp: (buf: Buffer, op: number) => Record<string, unknown> | null;
  isPublicIPv4: (ip: unknown) => boolean;
};

const PUBLIC_IP = "187.10.20.30";
const SERVICE = "urn:schemas-upnp-org:service:WANIPConnection:1";
const desc = (ctrl: string, type = SERVICE) => `<?xml version="1.0"?><root><device><serviceList>
  <service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service>
  <service><serviceType>${type}</serviceType><controlURL>${ctrl}</controlURL></service>
</serviceList></device></root>`;

describe("análise das respostas do roteador", () => {
  it("acha o gateway padrão no Windows, Linux e macOS (menor métrica; ignora On-link e IP público)", () => {
    const win = `Rotas ativas:
Endereço de rede          Máscara   Ender. gateway       Interface   Custo
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.177     25
          0.0.0.0          0.0.0.0      10.0.0.1       10.0.0.5          10
          0.0.0.0          0.0.0.0         On-link     172.20.0.1        5
          0.0.0.0          0.0.0.0      8.8.8.8        8.8.8.9           1`;
    expect(pm.parseDefaultGateway("win32", win)).toBe("10.0.0.1");
    expect(pm.parseDefaultGateway("linux", "default via 192.168.1.1 dev eth0 proto dhcp metric 600\ndefault via 10.1.1.1 dev wlan0 metric 100")).toBe("10.1.1.1");
    expect(pm.parseDefaultGateway("darwin", "   route to: default\n    gateway: 192.168.15.1\n  interface: en0")).toBe("192.168.15.1");
    expect(pm.parseDefaultGateway("linux", "")).toBeNull();
    expect(pm.parseDefaultGateway("linux", "default via fe80::1 dev eth0")).toBeNull();
  });

  it("SSDP: só aceita LOCATION http apontando para quem respondeu", () => {
    const ok = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLocation: http://192.168.0.1:5000/rootDesc.xml\r\nST: x\r\n\r\n";
    expect(pm.parseSsdpLocation(ok, "192.168.0.1")).toBe("http://192.168.0.1:5000/rootDesc.xml");
    expect(pm.parseSsdpLocation(ok, "192.168.0.50")).toBeNull(); // aponta para outro aparelho
    expect(pm.parseSsdpLocation(ok.replace("http://", "https://"), "192.168.0.1")).toBeNull();
    expect(pm.parseSsdpLocation(ok.replace("192.168.0.1:5000", "u:p@192.168.0.1:5000"), "192.168.0.1")).toBeNull();
    expect(pm.parseSsdpLocation(ok.replace("200 OK", "404 X"), "192.168.0.1")).toBeNull();
    expect(pm.parseSsdpLocation("NOTIFY * HTTP/1.1\r\nLOCATION: http://192.168.0.1/\r\n", "192.168.0.1")).toBeNull();
    expect(pm.parseSsdpLocation("HTTP/1.1 200 OK\r\nLOCATION: ::::\r\n", "192.168.0.1")).toBeNull();
    expect(pm.parseSsdpLocation("HTTP/1.1 200 OK\r\n\r\n", "192.168.0.1")).toBeNull();
  });

  it("descrição do IGD: pega o serviço WAN certo e recusa URL de controle em outro host", () => {
    const loc = "http://192.168.0.1:5000/rootDesc.xml";
    expect(pm.parseIgdDescription(desc("/ctl/IPConn"), loc)).toEqual({ serviceType: SERVICE, controlUrl: "http://192.168.0.1:5000/ctl/IPConn" });
    expect(pm.parseIgdDescription(desc("/ctl/PPP", "urn:schemas-upnp-org:service:WANPPPConnection:1"), loc)?.controlUrl).toBe("http://192.168.0.1:5000/ctl/PPP");
    expect(pm.parseIgdDescription(desc("http://evil.example/ctl"), loc)).toBeNull();
    expect(pm.parseIgdDescription(desc("/x", "urn:schemas-upnp-org:service:WANIPConnection:9"), loc)).toBeNull();
    expect(pm.parseIgdDescription("<root><service><serviceType>" + SERVICE, loc)).toBeNull(); // cortado
    expect(pm.parseIgdDescription("<URLBase>http://192.168.0.1:5000/base/</URLBase>" + desc("ctl"), loc)?.controlUrl).toBe("http://192.168.0.1:5000/base/ctl");
    // XML enorme: não trava (análise linear) e não acha nada
    const t0 = Date.now();
    expect(pm.parseIgdDescription("<service>".repeat(200_000), loc)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("SOAP: campos na resposta 200, código de erro UPnP no 500", () => {
    expect(pm.parseSoap(200, "<r><NewExternalIPAddress> 1.2.3.4 </NewExternalIPAddress></r>", ["NewExternalIPAddress"])).toEqual({ ok: true, fields: { NewExternalIPAddress: "1.2.3.4" } });
    expect(pm.parseSoap(500, "<UPnPError><errorCode>718</errorCode></UPnPError>", [])).toEqual({ ok: false, code: 718 });
    expect(pm.parseSoap(500, "lixo", [])).toEqual({ ok: false, code: 0 });
  });

  it("NAT-PMP: monta o pedido e valida a resposta (versão, opcode, tamanho)", () => {
    expect([...pm.natpmpMapRequest(50000, 50001, 1800)]).toEqual([0, 1, 0, 0, 0xc3, 0x50, 0xc3, 0x51, 0, 0, 0x07, 0x08]);
    const ext = Buffer.from([0, 128, 0, 0, 0, 0, 0, 1, 187, 10, 20, 30]);
    expect(pm.parseNatpmp(ext, 0)).toEqual({ result: 0, ip: PUBLIC_IP });
    const map = Buffer.from([0, 129, 0, 0, 0, 0, 0, 1, 0xc3, 0x50, 0xc3, 0x51, 0, 0, 0x07, 0x08]);
    expect(pm.parseNatpmp(map, 1)).toEqual({ result: 0, internal: 50000, external: 50001, lifetime: 1800 });
    expect(pm.parseNatpmp(Buffer.from([0, 129, 0, 2, 0, 0, 0, 0]), 1)).toEqual({ result: 2 });
    expect(pm.parseNatpmp(map, 0)).toBeNull(); // opcode errado
    expect(pm.parseNatpmp(Buffer.from([2, 129, 0, 0, 0, 0, 0, 0]), 1)).toBeNull(); // PCP, não NAT-PMP
    expect(pm.parseNatpmp(map.subarray(0, 12), 1)).toBeNull();
    expect(pm.parseNatpmp(ext.subarray(0, 10), 0)).toBeNull();
  });

  it("IP externo só vale se for IPv4 público (100.64/10 = roteador atrás de CGNAT)", () => {
    expect(pm.isPublicIPv4(PUBLIC_IP)).toBe(true);
    for (const ip of ["100.70.1.2", "192.168.0.1", "10.0.0.1", "0.0.0.0", "", null, "::1", "2804::1"]) expect(pm.isPublicIPv4(ip)).toBe(false);
  });
});

describe("candidato com a porta aberta no roteador", () => {
  const host = "candidate:2442 1 udp 2122260223 192.168.0.177 54321 typ host generation 0 ufrag AbCd network-id 1 network-cost 10";
  it("vira srflx com o endereço externo, raddr/rport do host e o mesmo ufrag", () => {
    expect(mappedCandidate(host, { ip: PUBLIC_IP, port: 54321 })).toBe(`candidate:nexo54321 1 udp 1694498815 ${PUBLIC_IP} 54321 typ srflx raddr 192.168.0.177 rport 54321 generation 0 ufrag AbCd`);
    expect(mappedCandidate("a=" + host.replace(/ ufrag AbCd/, ""), { ip: PUBLIC_IP, port: 6000 })).toBe(`candidate:nexo6000 1 udp 1694498815 ${PUBLIC_IP} 6000 typ srflx raddr 192.168.0.177 rport 54321 generation 0`);
  });
  it("ignora o que não é host UDP bem formado", () => {
    for (const c of [host.replace("typ host", "typ srflx"), host.replace(" udp ", " tcp "), host.replace(" 1 udp", " 0 udp"), "candidate:1 1 udp", "lixo"]) expect(mappedCandidate(c, { ip: PUBLIC_IP, port: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------- roteador falso em 127.0.0.1

type Router = { ssdpPort: number; pmpPort: number; calls: string[]; mappings: Map<number, { internal: number; client: string; lease: number }>; close: () => Promise<void> };
const routers: Router[] = [];
afterEach(async () => {
  while (routers.length) await routers.pop()!.close();
});

async function fakeRouter(o: { upnp?: boolean; natpmp?: boolean; externalIp?: string; ssdpLocation?: (httpPort: number) => string; onlyPermanent?: boolean; busy?: number[]; natpmpExternal?: (internal: number) => number } = {}): Promise<Router> {
  const calls: string[] = [];
  const mappings = new Map<number, { internal: number; client: string; lease: number }>();
  const ext = o.externalIp ?? PUBLIC_IP;
  const web = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/desc.xml") return res.end(desc("/ctl"));
      const action = /#(\w+)"/.exec(String(req.headers.soapaction))?.[1] ?? "";
      const arg = (k: string) => new RegExp(`<${k}>([^<]*)</${k}>`).exec(body)?.[1] ?? "";
      calls.push(action + (action.endsWith("PortMapping") ? ":" + arg("NewExternalPort") + ":" + arg("NewLeaseDuration") : ""));
      const fail = (code: number) => ((res.statusCode = 500), res.end(`<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>`));
      if (action === "GetExternalIPAddress") return res.end(`<s:Envelope><s:Body><u:R><NewExternalIPAddress>${ext}</NewExternalIPAddress></u:R></s:Body></s:Envelope>`);
      if (action === "AddPortMapping") {
        const port = Number(arg("NewExternalPort"));
        if (o.onlyPermanent && arg("NewLeaseDuration") !== "0") return fail(725);
        if (o.busy?.includes(port)) return fail(718);
        mappings.set(port, { internal: Number(arg("NewInternalPort")), client: arg("NewInternalClient"), lease: Number(arg("NewLeaseDuration")) });
        return res.end("<ok/>");
      }
      if (action === "DeletePortMapping") {
        mappings.delete(Number(arg("NewExternalPort")));
        return res.end("<ok/>");
      }
      fail(401);
    });
  });
  await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
  const httpPort = (web.address() as AddressInfo).port;

  const ssdp = dgram.createSocket("udp4");
  ssdp.on("message", (msg, r) => {
    if (o.upnp === false || !String(msg).startsWith("M-SEARCH")) return;
    const loc = o.ssdpLocation?.(httpPort) ?? `http://127.0.0.1:${httpPort}/desc.xml`;
    ssdp.send(`HTTP/1.1 200 OK\r\nST: x\r\nLOCATION: ${loc}\r\n\r\n`, r.port, r.address);
  });
  await new Promise<void>((r) => ssdp.bind(0, "127.0.0.1", r));

  const pmp = dgram.createSocket("udp4");
  pmp.on("message", (m, r) => {
    if (o.natpmp !== true) return;
    if (m[1] === 0) return pmp.send(Buffer.from([0, 128, 0, 0, 0, 0, 0, 1, ...ext.split(".").map(Number)]), r.port, r.address);
    const internal = m.readUInt16BE(4);
    const lifetime = m.readUInt32BE(8);
    const external = lifetime === 0 ? 0 : (o.natpmpExternal?.(internal) ?? (m.readUInt16BE(6) || internal));
    calls.push(`pmp:${internal}:${lifetime}`);
    if (lifetime === 0) mappings.delete(internal);
    else mappings.set(external, { internal, client: r.address, lease: lifetime });
    const b = Buffer.alloc(16);
    b[1] = 129;
    b.writeUInt16BE(internal, 8);
    b.writeUInt16BE(external, 10);
    b.writeUInt32BE(lifetime, 12);
    pmp.send(b, r.port, r.address);
  });
  await new Promise<void>((r) => pmp.bind(0, "127.0.0.1", r));

  const router: Router = {
    ssdpPort: ssdp.address().port,
    pmpPort: pmp.address().port,
    calls,
    mappings,
    close: async () => {
      ssdp.close();
      pmp.close();
      await new Promise((r) => web.close(r));
    },
  };
  routers.push(router);
  return router;
}

const mapperFor = (r: Router, gw: string | null = "127.0.0.1") => pm.createPortMapper({ defaultGateway: async () => gw, natpmpPort: r.pmpPort, ssdpPort: r.ssdpPort, retryMs: 0 });

describe("abrir portas num roteador (falso) de verdade", () => {
  it("UPnP: abre, reaproveita, fecha; status mostra IP externo e contagem", async () => {
    const r = await fakeRouter();
    const m = mapperFor(r);
    expect(m.status().state).toBe("off");
    expect(await m.map("127.0.0.1", 50000)).toEqual({ ip: PUBLIC_IP, port: 50000 });
    expect(r.mappings.get(50000)).toEqual({ internal: 50000, client: "127.0.0.1", lease: 1800 });
    expect(await m.map("127.0.0.1", 50000)).toEqual({ ip: PUBLIC_IP, port: 50000 }); // não pede de novo
    expect(r.calls.filter((c) => c.startsWith("AddPortMapping"))).toHaveLength(1);
    expect(m.status()).toMatchObject({ state: "upnp", externalIp: PUBLIC_IP, mapped: 1 });
    await m.release(50000);
    expect(r.mappings.size).toBe(0);
    expect(m.status().mapped).toBe(0);
  });

  it("UPnP: porta externa ocupada (718) tenta outra; roteador que só aceita permanente (725) recebe lease 0", async () => {
    const r = await fakeRouter({ busy: [50001], onlyPermanent: true });
    const m = mapperFor(r);
    const got = await m.map("127.0.0.1", 50001);
    expect(got?.ip).toBe(PUBLIC_IP);
    expect(got?.port).not.toBe(50001);
    expect(r.mappings.get(got!.port)).toMatchObject({ internal: 50001, lease: 0 });
    await m.releaseAll();
    expect(r.mappings.size).toBe(0);
  });

  it("NAT-PMP tem preferência e pode devolver outra porta externa", async () => {
    const r = await fakeRouter({ natpmp: true, natpmpExternal: (p) => p + 7 });
    const m = mapperFor(r);
    expect(await m.map("127.0.0.1", 50002)).toEqual({ ip: PUBLIC_IP, port: 50009 });
    expect(m.status().state).toBe("natpmp");
    await m.release(50002);
    expect(r.calls).toEqual(["pmp:50002:1800", "pmp:50002:0"]);
  });

  it("roteador atrás de CGNAT: não abre nada e avisa", async () => {
    const r = await fakeRouter({ externalIp: "100.71.2.3" });
    const m = mapperFor(r);
    expect(await m.map("127.0.0.1", 50003)).toBeNull();
    expect(m.status()).toMatchObject({ state: "cgnat", externalIp: "100.71.2.3" });
    expect(r.mappings.size).toBe(0);
  });

  it("recusa porta/IP inválidos e IP local que não é o da interface do gateway", async () => {
    const r = await fakeRouter();
    const m = mapperFor(r);
    for (const [ip, port] of [["127.0.0.1", 80], ["127.0.0.1", 70000], ["127.0.0.1", 1.5], ["::1", 50000], ["x", 50000]] as const) expect(await m.map(ip, port)).toBeNull();
    expect(await m.map("192.168.99.99", 50004)).toBeNull(); // tentativa de abrir porta para outro aparelho
    expect(r.mappings.size).toBe(0);
  });

  it("SSDP hostil: LOCATION para outro host é ignorado; sem gateway ou sem resposta = 'none'", async () => {
    const r = await fakeRouter({ ssdpLocation: (p) => `http://127.0.0.2:${p}/desc.xml` });
    expect(await mapperFor(r).map("127.0.0.1", 50005)).toBeNull();
    const m = mapperFor(r);
    await m.map("127.0.0.1", 50005);
    expect(m.status().state).toBe("none");
    const quiet = await fakeRouter({ upnp: false });
    const q = mapperFor(quiet);
    expect(await q.map("127.0.0.1", 50006)).toBeNull();
    expect(q.status()).toMatchObject({ state: "none", gateway: "127.0.0.1" });
    const nogw = mapperFor(quiet, null);
    expect(await nogw.map("127.0.0.1", 50006)).toBeNull();
    expect(nogw.status().state).toBe("none");
  });

  it("limite de portas abertas ao mesmo tempo", async () => {
    const r = await fakeRouter();
    const m = mapperFor(r);
    for (let i = 0; i < 64; i++) expect(await m.map("127.0.0.1", 40000 + i)).not.toBeNull();
    expect(await m.map("127.0.0.1", 41000)).toBeNull();
    await m.releaseAll();
    expect(r.mappings.size).toBe(0);
  });
});
