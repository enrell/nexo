/**
 * Abre portas no roteador de casa (UPnP IGD e NAT-PMP, como o qBittorrent) para o WebRTC.
 * Quem está do lado SEM CGNAT anuncia "IP externo do roteador:porta aberta" como candidato ICE,
 * e um amigo atrás de CGNAT (que não aceita conexão de fora) consegue chegar direto.
 *
 * Tudo que vem do roteador é tratado como entrada hostil: tamanho limitado, só HTTP para o
 * próprio gateway, nada de redirecionamento, e as respostas são lidas com análise linear.
 */
const dgram = require("node:dgram");
const http = require("node:http");
const net = require("node:net");
const { execFile } = require("node:child_process");
const { isPrivateIp } = require("./netguard.cjs");

const LEASE_S = 1800; // renovado na metade enquanto a conexão existir
const MAX_MAPPINGS = 64;
const MAX_XML = 256 * 1024;
const NATPMP_PORT = 5351;
const SSDP_ADDR = "239.255.255.250";
const WAN_SERVICE = /^urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:[12]$/;

// ---------------------------------------------------------------- análise (pura, testada)

/** Gateway padrão a partir da saída de `route print -4 0.0.0.0` (Windows), `ip -4 route show default` (Linux) ou `route -n get default` (macOS). */
function parseDefaultGateway(platform, out) {
  const text = String(out).slice(0, 64 * 1024);
  let best = null;
  for (const line of text.split(/\r?\n/)) {
    let gw = null;
    let metric = 0;
    if (platform === "win32") {
      const f = line.trim().split(/\s+/);
      if (f.length >= 5 && f[0] === "0.0.0.0" && f[1] === "0.0.0.0") {
        gw = f[2];
        metric = Number(f[4]) || 0;
      }
    } else if (platform === "darwin") {
      const m = /^\s*gateway:\s*(\S+)\s*$/.exec(line);
      if (m) gw = m[1];
    } else {
      const m = /^default via (\S+)(?:.*\smetric (\d+))?/.exec(line.trim());
      if (m) {
        gw = m[1];
        metric = Number(m[2] ?? 0);
      }
    }
    if (gw && net.isIPv4(gw) && isPrivateIp(gw) && (!best || metric < best.metric)) best = { gw, metric };
  }
  return best?.gw ?? null;
}

/** LOCATION de uma resposta SSDP, só se apontar para o próprio aparelho que respondeu, via http. */
function parseSsdpLocation(msg, from) {
  const text = String(msg).slice(0, 4096);
  if (!/^HTTP\/1\.1 200/i.test(text)) return null;
  const m = /^location:[ \t]*(\S+)[ \t]*$/im.exec(text);
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    if (u.protocol !== "http:" || u.hostname !== from || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

const tagText = (xml, tag) => {
  const open = `<${tag}>`;
  const i = xml.indexOf(open);
  if (i === -1) return null;
  const j = xml.indexOf(`</${tag}>`, i);
  return j === -1 ? null : xml.slice(i + open.length, j).trim();
};

/** Do XML de descrição do IGD: serviço WANIPConnection/WANPPPConnection e a URL de controle (no mesmo host). */
function parseIgdDescription(xml, location) {
  const text = String(xml).slice(0, MAX_XML);
  const base = tagText(text, "URLBase") || location;
  let from = 0;
  for (;;) {
    const i = text.indexOf("<service>", from);
    if (i === -1) return null;
    const j = text.indexOf("</service>", i);
    if (j === -1) return null;
    from = j;
    const block = text.slice(i, j);
    const type = tagText(block, "serviceType");
    const ctrl = tagText(block, "controlURL");
    if (!type || !ctrl || !WAN_SERVICE.test(type)) continue;
    try {
      const u = new URL(ctrl, base);
      if (u.protocol !== "http:" || u.host !== new URL(location).host) continue;
      return { serviceType: type, controlUrl: u.href };
    } catch {
      continue;
    }
  }
}

/** Resposta SOAP: { ok, fields } ou { ok: false, code } (código de erro UPnP, ex.: 718 = porta ocupada). */
function parseSoap(status, xml, fields) {
  const text = String(xml).slice(0, MAX_XML);
  if (status !== 200) {
    const code = Number(tagText(text, "errorCode"));
    return { ok: false, code: Number.isInteger(code) ? code : 0 };
  }
  const out = {};
  for (const f of fields) out[f] = tagText(text, f);
  return { ok: true, fields: out };
}

/** NAT-PMP (RFC 6886): pedido de IP externo e de mapeamento UDP. */
const natpmpExternalRequest = () => Buffer.from([0, 0]);
function natpmpMapRequest(internal, external, lifetime) {
  const b = Buffer.alloc(12);
  b[0] = 0;
  b[1] = 1; // UDP
  b.writeUInt16BE(internal, 4);
  b.writeUInt16BE(external, 6);
  b.writeUInt32BE(lifetime, 8);
  return b;
}
function parseNatpmp(buf, op) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf[0] !== 0 || buf[1] !== 128 + op) return null;
  const result = buf.readUInt16BE(2);
  if (result !== 0) return { result };
  if (op === 0) return buf.length >= 12 ? { result, ip: [...buf.subarray(8, 12)].join(".") } : null;
  if (buf.length < 16) return null;
  return { result, internal: buf.readUInt16BE(8), external: buf.readUInt16BE(10), lifetime: buf.readUInt32BE(12) };
}

/** IP externo que vale a pena anunciar: IPv4 público (se for 100.64/10 ou privado, o roteador está atrás de outro NAT). */
const isPublicIPv4 = (ip) => typeof ip === "string" && net.isIPv4(ip) && !isPrivateIp(ip);

const validPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;

// ---------------------------------------------------------------- rede

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? "" : out)));
}

async function defaultGateway() {
  const p = process.platform;
  const out = p === "win32" ? await run("route", ["print", "-4", "0.0.0.0"]) : p === "darwin" ? await run("route", ["-n", "get", "default"]) : await run("ip", ["-4", "route", "show", "default"]);
  return parseDefaultGateway(p, out);
}

/** Endereço local usado para falar com o gateway (sem mandar pacote nenhum). */
function localAddressTo(gw) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    s.on("error", () => (s.close(), resolve(null)));
    s.connect(9, gw, () => {
      const a = s.address().address;
      s.close();
      resolve(net.isIPv4(a) ? a : null);
    });
  });
}

function natpmp(gw, local, req, op, port = NATPMP_PORT) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    let wait = 250;
    let timer;
    const done = (v) => {
      clearTimeout(timer);
      s.close();
      resolve(v);
    };
    s.on("error", () => done(null));
    s.on("message", (msg, r) => {
      if (r.address !== gw || r.port !== port) return;
      const p = parseNatpmp(msg, op);
      if (p) done(p);
    });
    const send = () => {
      if (wait > 2000) return done(null);
      s.send(req, port, gw, () => {});
      timer = setTimeout(send, wait);
      wait *= 2;
    };
    s.bind(0, local, send);
  });
}

function ssdpSearch(gw, local, port = 1900) {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const timer = setTimeout(() => done(null), 2500);
    const done = (v) => {
      clearTimeout(timer);
      try {
        s.close();
      } catch {
        /* já fechado */
      }
      resolve(v);
    };
    s.on("error", () => done(null));
    s.on("message", (msg, r) => {
      if (r.address !== gw) return; // só o nosso roteador
      const loc = parseSsdpLocation(msg, r.address);
      if (loc) done(loc);
    });
    s.bind(0, local, () => {
      for (const st of ["urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:device:InternetGatewayDevice:2", "urn:schemas-upnp-org:service:WANIPConnection:1"]) {
        const m = `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
        s.send(m, 1900, SSDP_ADDR, () => {}); // erro de envio (sem rota multicast) não encerra a busca
        s.send(m, port, gw, () => {}); // alguns roteadores só respondem unicast
      }
    });
  });
}

function httpRequest(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, { method, headers: { ...headers, connection: "close" }, timeout: 3000 }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_XML) return req.destroy();
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end(body);
  });
}

async function soap(igd, action, args, fields) {
  const params = Object.entries(args)
    .map(([k, v]) => `<${k}>${String(v).replace(/[<>&]/g, "")}</${k}>`)
    .join("");
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${igd.serviceType}">${params}</u:${action}></s:Body></s:Envelope>`;
  const res = await httpRequest(igd.controlUrl, {
    method: "POST",
    headers: { "content-type": 'text/xml; charset="utf-8"', soapaction: `"${igd.serviceType}#${action}"` },
    body,
  });
  return res ? parseSoap(res.status, res.body, fields) : { ok: false, code: 0 };
}

// ---------------------------------------------------------------- estado

/**
 * status.state: "off" (nunca pedido), "searching", "upnp", "natpmp", "cgnat" (roteador achado, mas o IP
 * externo dele não é público), "none" (roteador não respondeu UPnP nem NAT-PMP).
 */
function createPortMapper(opts = {}) {
  const gateway = opts.defaultGateway ?? defaultGateway;
  const pmpPort = opts.natpmpPort ?? NATPMP_PORT;
  const ssdpPort = opts.ssdpPort ?? 1900;
  const retryMs = opts.retryMs ?? 5 * 60_000;
  let status = { state: "off" };
  let ctx = null; // { kind, gw, local, externalIp, igd? }
  let discovering = null;
  let failedAt = 0;
  const mappings = new Map(); // porta interna -> { external, timer }

  async function discover() {
    status = { state: "searching" };
    const gw = await gateway();
    const local = gw && (await localAddressTo(gw));
    if (!gw || !local) {
      status = { state: "none" };
      return null;
    }
    const [pmp, loc] = await Promise.all([natpmp(gw, local, natpmpExternalRequest(), 0, pmpPort), ssdpSearch(gw, local, ssdpPort)]);
    let found = null;
    if (pmp && pmp.result === 0) found = { kind: "natpmp", gw, local, externalIp: pmp.ip };
    if (!found && loc) {
      const desc = await httpRequest(loc);
      const igd = desc && desc.status === 200 ? parseIgdDescription(desc.body, loc) : null;
      if (igd) {
        const r = await soap(igd, "GetExternalIPAddress", {}, ["NewExternalIPAddress"]);
        if (r.ok) found = { kind: "upnp", gw, local, igd, externalIp: r.fields.NewExternalIPAddress };
      }
    }
    if (!found) {
      status = { state: "none", gateway: gw };
      return null;
    }
    if (!isPublicIPv4(found.externalIp)) {
      status = { state: "cgnat", gateway: gw, externalIp: found.externalIp ?? null, via: found.kind };
      return null;
    }
    status = { state: found.kind, gateway: gw, externalIp: found.externalIp, mapped: 0 };
    return found;
  }

  async function ready() {
    if (ctx) return ctx;
    if (!discovering && Date.now() - failedAt < retryMs) return null; // falhou há pouco: não insiste
    discovering ??= discover().then((c) => {
      ctx = c;
      if (!c) failedAt = Date.now();
      discovering = null;
      return c;
    });
    return discovering;
  }

  async function addMapping(c, internal) {
    if (c.kind === "natpmp") {
      const r = await natpmp(c.gw, c.local, natpmpMapRequest(internal, internal, LEASE_S), 1, pmpPort);
      return r && r.result === 0 && validPort(r.external) && r.internal === internal ? r.external : null;
    }
    const tries = [internal, 20000 + Math.floor(Math.random() * 40000), 20000 + Math.floor(Math.random() * 40000)];
    let lease = LEASE_S;
    for (let i = 0; i < tries.length; i++) {
      const args = { NewRemoteHost: "", NewExternalPort: tries[i], NewProtocol: "UDP", NewInternalPort: internal, NewInternalClient: c.local, NewEnabled: 1, NewPortMappingDescription: "Nexo", NewLeaseDuration: lease };
      const r = await soap(c.igd, "AddPortMapping", args, []);
      if (r.ok) return tries[i];
      if (r.code === 725 && lease) {
        lease = 0; // "só aceita permanente": tira no fechamento
        i--;
        continue;
      }
      if (r.code !== 718) return null; // 718 = porta externa já usada: tenta outra
    }
    return null;
  }

  async function removeMapping(c, internal, external) {
    if (c.kind === "natpmp") await natpmp(c.gw, c.local, natpmpMapRequest(internal, 0, 0), 1, pmpPort);
    else await soap(c.igd, "DeletePortMapping", { NewRemoteHost: "", NewExternalPort: external, NewProtocol: "UDP" }, []);
  }

  const syncCount = () => {
    if (ctx) status = { ...status, mapped: mappings.size };
  };

  return {
    status: () => status,

    /** Abre `port` (do candidato local `ip`) no roteador. Devolve o endereço externo ou null. */
    async map(ip, port) {
      if (!net.isIPv4(ip) || !validPort(port)) return null;
      const c = await ready();
      if (!c || ip !== c.local) return null;
      const have = mappings.get(port);
      if (have) return { ip: c.externalIp, port: have.external };
      if (mappings.size >= MAX_MAPPINGS) return null;
      const external = await addMapping(c, port);
      if (!external) return null;
      const timer = setInterval(() => void addMappingRenew(c, port, external), (LEASE_S / 2) * 1000);
      timer.unref?.();
      mappings.set(port, { external, timer });
      syncCount();
      return { ip: c.externalIp, port: external };
    },

    async release(port) {
      const m = mappings.get(port);
      if (!m || !ctx) return;
      clearInterval(m.timer);
      mappings.delete(port);
      syncCount();
      await removeMapping(ctx, port, m.external);
    },

    /** No fechamento do app: tira tudo (com limite de tempo; as concessões expiram de qualquer jeito). */
    async releaseAll(timeoutMs = 1500) {
      if (!ctx) return;
      const c = ctx;
      const all = [...mappings.entries()];
      mappings.clear();
      for (const [, m] of all) clearInterval(m.timer);
      await Promise.race([Promise.all(all.map(([port, m]) => removeMapping(c, port, m.external))), new Promise((r) => setTimeout(r, timeoutMs))]);
    },
  };

  async function addMappingRenew(c, internal, external) {
    if (c.kind === "natpmp") await natpmp(c.gw, c.local, natpmpMapRequest(internal, external, LEASE_S), 1, pmpPort);
    else await soap(c.igd, "AddPortMapping", { NewRemoteHost: "", NewExternalPort: external, NewProtocol: "UDP", NewInternalPort: internal, NewInternalClient: c.local, NewEnabled: 1, NewPortMappingDescription: "Nexo", NewLeaseDuration: LEASE_S }, []);
  }
}

module.exports = { createPortMapper, parseDefaultGateway, parseSsdpLocation, parseIgdDescription, parseSoap, natpmpMapRequest, parseNatpmp, isPublicIPv4 };
