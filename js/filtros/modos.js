// js/filtros/modos.js
import { runRapido } from './rapido.js';
import { ensureBasico } from './basico.js';
import { ensureAvancado } from './avancado.js';

const CFG = {
  resultsEl: '#results',
  triggerBtn: '#btn-search',
  controls: {
    idade:'#f-idade', especie:'#f-especie', assina:'#f-assina', nome:'#f-nome',
    prods:{ margem:'#p-margem', cartao:'#p-cartao', refin:'#p-refin', port:'#p-port', saque:'#p-saque' },
    advanced:'#f-advanced'
  }
};

let currentMode = 'rapido';
let basicoReady = false;
let avancadoReady = false;

function bindSearchRouter(){
  const btn = document.querySelector(CFG.triggerBtn);
  if(!btn) return;
  btn.addEventListener('click', (e)=>{
    if(currentMode === 'rapido'){
      runRapido(CFG);
      e.stopImmediatePropagation();
    }
  }, { capture: true });
}

function bindModeSwitch(){
  document.querySelectorAll('input[name="modoPesquisa"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      if(!r.checked) return;
      currentMode = r.value;
      const results = document.querySelector(CFG.resultsEl);
      results?.classList.remove('grid-rapido');
      results && (results.innerHTML = '');
      if(currentMode==='basico' && !basicoReady){ ensureBasico(CFG); basicoReady = true; }
      if(currentMode==='avancado' && !avancadoReady){ ensureAvancado(CFG); avancadoReady = true; }
    });
  });
}

export function initModos(){
  bindSearchRouter();
  bindModeSwitch();
  const def = document.querySelector('input[name="modoPesquisa"][value="rapido"]');
  if(def){ def.checked = true; currentMode = 'rapido'; }
}

document.addEventListener('DOMContentLoaded', initModos);
