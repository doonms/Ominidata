// js/simulador/base-fatores-seguros.js
// Bloco separado apenas para a UI de Seguros (por aba) + delegações

import { $, esc } from './state-admin.js';

// helpers para pegar/escrever seguros no pack da aba atual
function getSeguroArrays(pack, tab){
  if(tab==='inss'){
    pack.inss = pack.inss || {};
    pack.inss.seguros = pack.inss.seguros || [];
    return { list: pack.inss.seguros };
  }
  if(tab==='siape'){
    pack.siape = pack.siape || {};
    pack.siape.seguros = pack.siape.seguros || [];
    return { list: pack.siape.seguros };
  }
  if(tab==='governo'){
    pack.governoSeguros = pack.governoSeguros || [];
    return { list: pack.governoSeguros };
  }
  if(tab==='prefeitura'){
    pack.prefeituraSeguros = pack.prefeituraSeguros || [];
    return { list: pack.prefeituraSeguros };
  }
  return { list: [] };
}

function uuid(){ return Math.random().toString(36).slice(2,10); }

/** Renderiza o bloco de seguros da aba atual */
export function renderSegurosForTab(pack, tab){
  const { list } = getSeguroArrays(pack, tab);

  const items = (list||[]).map(s=>`
    <div class="subblock" data-seg="${esc(s.id)}">
      <div class="inline-3" style="gap:8px; align-items:end">
        <div>
          <label class="small">Nome</label>
          <input type="text" value="${esc(s.nome||'')}" data-seg-edit="${esc(s.id)}:nome" placeholder="Ex.: Seguro Vida"/>
        </div>
        <div>
          <label class="small">Tipo</label>
          <select data-seg-edit="${esc(s.id)}:tipo">
            <option value="fixo" ${s.tipo==='fixo'?'selected':''}>Fixo (R$)</option>
            <option value="percentual" ${s.tipo==='percentual'?'selected':''}>Percentual (%)</option>
          </select>
        </div>
        <div class="inline-2">
          <div>
            <label class="small">Valor</label>
            <input type="number" step="0.01" value="${esc(s.valor ?? '')}" data-seg-edit="${esc(s.id)}:valor" placeholder="Ex.: 39.90 / 1.2"/>
          </div>
          <button class="small danger" data-seg-del="${esc(s.id)}">Remover</button>
        </div>
      </div>
    </div>
  `).join('');

  return `
    <div class="section-title"><strong>Seguros — ${tab.toUpperCase()}</strong></div>
    <div class="mini-grid">
      <div class="inline-3" style="gap:8px; align-items:end">
        <input id="segNome" type="text" placeholder="Nome do seguro (ex.: Seguro Proteção)"/>
        <select id="segTipo">
          <option value="fixo">Fixo (R$)</option>
          <option value="percentual">Percentual (%)</option>
        </select>
        <div class="inline-2">
          <input id="segValor" type="number" step="0.01" placeholder="Valor (ex.: 29.90 ou 1.2)"/>
          <button class="small" id="segAdd">+ Adicionar seguro</button>
        </div>
      </div>

      <div id="segList" class="mini-grid">
        ${items || '<div class="f-empty">Nenhum seguro cadastrado para esta aba.</div>'}
      </div>
    </div>
  `;
}

/** Delegates globais para ações de seguros */
export function bindSegurosDelegates(onChange){
  // evitar múltiplos binds
  if (document.__segBound) return;
  document.__segBound = true;

  // util p/ achar pack/aba atuais: a página pai setará atributos nos nós quando renderiza
  const getContext = ()=>{
    // a base-fatores.js cuida do state, mas aqui pegamos indiretamente via elementos
    // truque: a própria base-fatores chama renderSegurosForTab(pack, activeTab), então lemos de window
    const ctx = window.__BF_CTX__;
    return ctx || {};
  };

  document.addEventListener('click', (e)=>{
    const ctx = getContext();
    const { pack, tab } = ctx;
    if(!pack || !tab) return;

    // adicionar seguro
    if(e.target.id === 'segAdd'){
      const nome = $('#segNome')?.value?.trim() || '';
      const tipo = $('#segTipo')?.value || 'fixo';
      const valor = Number($('#segValor')?.value || 0);
      const { list } = getSeguroArrays(pack, tab);
      list.push({ id: 'seg_' + uuid(), nome, tipo, valor });
      if(typeof onChange==='function') onChange();
    }

    // remover seguro
    const del = e.target.getAttribute('data-seg-del');
    if(del){
      const { list } = getSeguroArrays(pack, tab);
      const idx = list.findIndex(s=>s.id===del);
      if(idx>=0) list.splice(idx,1);
      if(typeof onChange==='function') onChange();
    }
  });

  document.addEventListener('input', (e)=>{
    const ctx = getContext();
    const { pack, tab } = ctx;
    if(!pack || !tab) return;

    const key = e.target.getAttribute('data-seg-edit');
    if(!key) return;
    const [id, prop] = key.split(':');
    const { list } = getSeguroArrays(pack, tab);
    const seg = list.find(s=>s.id===id);
    if(!seg) return;

    if(prop==='nome'){ seg.nome = e.target.value || ''; }
    else if(prop==='tipo'){ seg.tipo = e.target.value || 'fixo'; }
    else if(prop==='valor'){ seg.valor = Number(e.target.value || 0); }
    if(typeof onChange==='function') onChange();
  });
}

/* Pequena ponte: a página pai define __BF_CTX__ antes de renderizar seguros */
(function installCtxHook(){
  // quem chama (base-fatores.js) irá ajustar window.__BF_CTX__ = { pack, tab }
  // Nada a fazer aqui além de garantir que o símbolo exista.
  if(!window.__BF_CTX__) window.__BF_CTX__ = null;
})();
