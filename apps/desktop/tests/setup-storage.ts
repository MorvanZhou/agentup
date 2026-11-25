/**
 * Node 22+/25 内置 webstorage 会占住 globalThis.localStorage：
 * 无 --localstorage-file 时 getItem 为 undefined，Vitest 也不再拷贝 happy-dom 的 Storage。
 * 在 setup 里探测不可用则换成内存 stub，避免组件 import 期炸。
 */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
  };
}

function storageUsable(candidate: unknown): candidate is Storage {
  if (!candidate || typeof candidate !== "object") return false;
  const storage = candidate as Storage;
  if (typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem("__agentup_storage_probe__", "1");
    storage.removeItem("__agentup_storage_probe__");
    return true;
  } catch {
    return false;
  }
}

function ensureStorage(target: object, name: "localStorage" | "sessionStorage"): void {
  const current = Reflect.get(target, name);
  if (storageUsable(current)) return;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: memoryStorage(),
  });
}

ensureStorage(globalThis, "localStorage");
ensureStorage(globalThis, "sessionStorage");
if (typeof window !== "undefined") {
  ensureStorage(window, "localStorage");
  ensureStorage(window, "sessionStorage");
}
