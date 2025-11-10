// Roteador leve de modos para manter compatibilidade com filtros.js
// - Rápido: intercepta o clique e executa runRapido()
// - Básico: intercepta e executa runBasico()
// - Avançado: deixa filtros.js seguir normalmente

import { runRapido } from './rapido.js';
import { runBasico } from './basico.js';

const CFG = {
  resultsEl: '#results',
  triggerBtn: '#btn-search',
  controls: {
    idade: '#f-idade',
    especie: '#f-especie',
    assina: '#f-assina',
    nome: '#f-nome',
    prods: {
      margem: '#p-margem',
      cartao: '#p-cartao',
      refin: '#p-refin',
      port: '#p-port',
      saque: '#p-saque'
    },
    advanced: '#f-advanced'
  }
};

let mode = 'rapido';

function syncAdvancedCheckbox() {
  const adv = document.querySelector(CFG.controls.advanced);
  if (!adv) return;
  adv.checked = (mode === 'avancado');
}

function applyModeDataset() {
  const root = document.body;
  if (!root) return;
  root.setAttribute('data-pesquisa-mode', mode);
}

function bindModeSwitch() {
  document.querySelectorAll('input[name="modoPesquisa"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      mode = radio.value; // 'rapido' | 'basico' | 'avancado'
      const results = document.querySelector(CFG.resultsEl);
      results?.classList.remove('grid-rapido');
      if (results) results.innerHTML = '';
      syncAdvancedCheckbox();
      applyModeDataset();
      const trigger = document.querySelector(CFG.triggerBtn);
      if (trigger && typeof trigger.click === 'function') trigger.click();
    });
  });
}

function bindSearchRouter() {
  const btn = document.querySelector(CFG.triggerBtn);
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    if (mode === 'rapido') {
      e.preventDefault();
      runRapido(CFG);
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    if (mode === 'basico') {
      e.preventDefault();
      runBasico(CFG);
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    // modo "avancado": deixa o fluxo seguir para filtros.js
  }, { capture: true });
}

function initModosBridge() {
  const def = document.querySelector('input[name="modoPesquisa"][value="rapido"]');
  if (def) def.checked = true;
  mode = 'rapido';
  syncAdvancedCheckbox();
  applyModeDataset();
  bindModeSwitch();
  bindSearchRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initModosBridge);
} else {
  initModosBridge();
}
