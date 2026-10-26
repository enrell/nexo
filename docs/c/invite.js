"use strict";
// O código do convite fica no "#": o navegador nunca envia essa parte ao GitHub.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var m = /^#(nexo-[A-Za-z0-9_-]{8,4096})$/.exec(location.hash);
  if (!m) {
    $("title").textContent = "Convite inválido";
    $("msg").textContent = "Esse link está incompleto. Peça um novo convite para quem te chamou.";
    $("actions").hidden = false;
    $("open").hidden = true;
    return;
  }
  var code = m[1];
  var url = "nexo://join/" + code;
  try {
    var b64 = code.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var name = JSON.parse(new TextDecoder().decode(bytes)).n;
    if (typeof name === "string" && name.trim()) $("title").textContent = "Convite para " + name.trim().slice(0, 60);
  } catch (e) {
    /* sem nome, segue com o título genérico */
  }
  $("open").href = url;
  $("actions").hidden = false;
  $("manual").hidden = false;
  $("copy").addEventListener("click", function () {
    navigator.clipboard.writeText(code).then(function () { $("copy").textContent = "Copiado!"; });
  });
  $("msg").textContent = "Se o Nexo não abriu, clique em “Abrir no Nexo”. Ainda não tem? Baixe e depois clique no link de novo.";
  location.href = url;
})();
