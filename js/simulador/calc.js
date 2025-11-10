// ==============================
// 🧮 CALC.JS — Base de Fatores
// ==============================
import { currentBank, saveDB } from './state-admin.js';
import { renderAll } from './render.js';

// === 📈 ADICIONAR FATOR ===
export function addFator(cat) {
  const b = currentBank();
  if (!b) return;
  if (!b.fatores[cat]) b.fatores[cat] = [];
  b.fatores[cat].push({ prazo: '', fator: '', convenio: '' });
  saveDB();
  renderAll();
}

// === 🗑 REMOVER FATOR ===
export function removeFator(cat, idx) {
  const b = currentBank();
  if (!b) return;
  if (Array.isArray(b.fatores[cat])) {
    b.fatores[cat].splice(idx, 1);
    saveDB();
    renderAll();
  }
}

// === 🧩 ATUALIZAR FATOR ===
export function updateFator(cat, idx, key, value) {
  const b = currentBank();
  if (!b) return;
  if (!b.fatores[cat] || !b.fatores[cat][idx]) return;
  b.fatores[cat][idx][key] = value;
  saveDB();
}

// === ⚙️ NORMALIZAR FATOR ===
export function normalizeFator(f) {
  const out = { ...f };
  out.fator = parseFloat(String(out.fator).replace(',', '.')) || 0;
  out.prazo = parseInt(out.prazo, 10) || 0;
  out.convenio = String(out.convenio || '').trim();
  return out;
}

// === 💡 CÁLCULO EXEMPLO (opcional) ===
// Essa função serve de exemplo caso queira usar no simulador:
export function calcularLiberado(parcela, fator, seguro = 0) {
  const valor = parcela / fator;
  return Math.max(0, valor - seguro);
}

export function calcularParcela(liberado, fator, seguro = 0) {
  const valor = liberado * fator;
  return valor + seguro;
}

// === 🧩 ATUALIZAÇÃO DIRETA DOS INPUTS ===
export function bindFatorInputs(container, cat) {
  if (!container) return;
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const { prazo, fator, convenio } = e.target.dataset;
      const idx = prazo ?? fator ?? convenio;
      if (!isNaN(idx)) {
        const key = e.target.dataset.prazo
          ? 'prazo'
          : e.target.dataset.fator
          ? 'fator'
          : 'convenio';
        updateFator(cat, idx, key, e.target.value);
      }
    });
  });
}
