// Ambiente mínimo do Electron/navegador para os módulos de src/lib rodarem no Node.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

// no Node o `localStorage` global é experimental e avisa só de ser lido: troca direto, sem ler.
// (nos arquivos com ambiente jsdom já existe um localStorage de verdade)
if (typeof document === "undefined") {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
  if (typeof (globalThis as { window?: unknown }).window === "undefined") Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true, writable: true });
}
