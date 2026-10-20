// Barra de navegação compartilhada entre os protótipos.
(function () {
  const pages = [
    { file: "sala.html", name: "Sala de estar" },
    { file: "constelacao.html", name: "Constelação" },
    { file: "editorial.html", name: "Editorial" },
    { file: "constelacao2.html", name: "Constelação 2" },
    { file: "constelacao3.html", name: "Constelação 3" },
  ];
  const here = location.pathname.split("/").pop();
  const i = pages.findIndex((p) => p.file === here);
  if (i < 0) return;
  const prev = pages[(i + pages.length - 1) % pages.length];
  const next = pages[(i + 1) % pages.length];

  const style = document.createElement("style");
  style.textContent = `
    .proto-nav{position:fixed;left:50%;bottom:4px;transform:translateX(-50%);opacity:.35;transition:opacity .15s;z-index:9999;display:flex;align-items:center;gap:4px;
      padding:6px;border-radius:999px;background:rgba(15,15,18,.86);backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,.35);
      font:500 13px/1 "Inter",system-ui,sans-serif;color:#eee;border:1px solid rgba(255,255,255,.08)}
    .proto-nav a{color:inherit;text-decoration:none;display:flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;white-space:nowrap}
    .proto-nav:hover{opacity:1}
    .proto-nav a:hover{background:rgba(255,255,255,.1)}
    .proto-nav .cur{padding:0 12px;opacity:.6;white-space:nowrap}
    .proto-nav i{font-size:16px}
  `;
  document.head.appendChild(style);
  const nav = document.createElement("nav");
  nav.className = "proto-nav";
  nav.innerHTML = `
    <a href="index.html" title="Voltar para o início (Esc)"><i class="ph ph-house"></i>Início</a>
    <a href="${prev.file}" title="Anterior (←)"><i class="ph ph-caret-left"></i>${prev.name}</a>
    <span class="cur">${i + 1}/${pages.length} · ${pages[i].name}</span>
    <a href="${next.file}" title="Próximo (→)">${next.name}<i class="ph ph-caret-right"></i></a>`;
  document.body.appendChild(nav);
  addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,textarea")) return;
    if (e.key === "ArrowRight") location.href = next.file;
    if (e.key === "ArrowLeft") location.href = prev.file;
    if (e.key === "Escape") location.href = "index.html";
  });
})();
