export const BASE_INSS_KEY = 'ominidata_base_inss_v1';
export const BASE_INSS_FALLBACKS = ['base_inss_v1', 'regras_bancos_v1'];
export const BASE_INSS_MIRRORS = ['base_inss_v1'];

export const BASE_FATORES_KEY = 'ominidata_base_fatores_v1';
export const BASE_FATORES_FALLBACKS = ['base_fatores_v1', 'regras_bancos_v1'];
export const BASE_FATORES_MIRRORS = ['base_fatores_v1'];

export function readFromStorage(key, fallbacks = []) {
  const keys = [key, ...fallbacks];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed !== null && parsed !== undefined) {
        if (k !== key) {
          try { localStorage.setItem(key, JSON.stringify(parsed)); } catch { /* noop */ }
        }
        return parsed;
      }
    } catch {
      /* Continua tentando */
    }
  }
  return null;
}

export function writeToStorage(key, value, mirror = []) {
  const payload = JSON.stringify(value);
  localStorage.setItem(key, payload);
  mirror.forEach(target => {
    try { localStorage.setItem(target, payload); } catch { /* noop */ }
  });
}
