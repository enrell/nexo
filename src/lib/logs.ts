/** Guarda os últimos avisos/erros para o "Exportar diagnóstico". */
const MAX = 300;
const buf: { t: string; level: string; msg: string }[] = [];

function push(level: string, args: unknown[]) {
  const msg = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeJson(a)))
    .join(" ")
    .slice(0, 1000);
  buf.push({ t: new Date().toISOString(), level, msg });
  if (buf.length > MAX) buf.shift();
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function installLogCapture() {
  for (const level of ["warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => push("uncaught", [e.message]));
  window.addEventListener("unhandledrejection", (e) => push("rejection", [e.reason]));
}

export const logs = { list: () => [...buf] };
