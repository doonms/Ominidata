// Roteador dos modos, reinicializável para cada entrada da Pesquisa pelo menu SPA.
// Rápido e Avançado usam seus renderizadores existentes, sem mudar a elegibilidade.

import { runRapido } from './rapido.js';
import { runAvancado } from './avancado.js';

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
      mode = radio.value; // 'rapido' | 'avancado'
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

    if (mode === 'avancado') {
      e.preventDefault();
      runAvancado(CFG);
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, { capture: true });
}

export function initModosBridge() {
  const panel = document.querySelector('.pesquisa-wrap');
  if (!panel || panel.dataset.modosInicializados) return;
  panel.dataset.modosInicializados = 'true';
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
