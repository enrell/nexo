/**
 * Guarda contra SSRF para a prévia de links: o processo principal nunca conecta em endereços
 * internos (rede local, loopback, link-local, CGNAT, multicast, túneis que embutem IPv4…),
 * seja qual for a forma de escrever o IP (IPv4 mapeado em IPv6, zeros omitidos, zona de interface; o BlockList do Node entende todas).
 */
const dns = require("node:dns");
const net = require("node:net");

const blocked = new net.BlockList();
for (const [addr, bits] of [
  ["0.0.0.0", 8], // "esta rede"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (inclui metadados de nuvem 169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentação
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // teste de desempenho
  ["198.51.100.0", 24], // documentação
  ["203.0.113.0", 24], // documentação
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado + broadcast
]) blocked.addSubnet(addr, bits, "ipv4");
for (const [addr, bits] of [
  ["::", 128], // não especificado
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (embute IPv4)
  ["64:ff9b:1::", 48],
  ["100::", 64], // descarte
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentação
  ["2002::", 16], // 6to4 (embute IPv4)
  ["fc00::", 7], // ULA
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
]) blocked.addSubnet(addr, bits, "ipv6");

/** `true` se o endereço é interno/reservado, ou se não é um IP válido (na dúvida, bloqueia). */
function isPrivateIp(ip) {
  if (typeof ip !== "string") return true;
  const bare = ip.replace(/^\[|\]$/g, "");
  const family = net.isIP(bare);
  if (!family) return true;
  // o BlockList trata ::ffff:a.b.c.d (e a forma hexadecimal) como o IPv4 correspondente
  return blocked.check(bare, family === 4 ? "ipv4" : "ipv6");
}

/** `lookup` para http(s).get: resolve o DNS e recusa IP interno no momento da conexão (evita DNS rebinding). */
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs.filter((a) => !isPrivateIp(a.address));
    if (!list.length) return cb(new Error("endereço bloqueado"));
    if (options.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

module.exports = { isPrivateIp, safeLookup };
