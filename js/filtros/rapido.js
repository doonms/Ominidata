import { BASE_INSS_KEY, BASE_INSS_FALLBACKS, readFromStorage } from '../config/storageKeys.js';
import { getLogoSrc, getLogoFallbackAttr } from '../utils/logo.js';
// Modo RÁPIDO: mostra cards compactos com Banco + (Idade do filtro) + 1º prazo compatível + Obs
function getDB(){
  const data = readFromStorage(BASE_INSS_KEY, BASE_INSS_FALLBACKS);
  return Array.isArray(data) ? data : [];
}
const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

const renderLogoLabel = nome => {
  const safe = esc(nome || 'Banco');
  return `
    <span class="logo-label">
      <img src="${getLogoSrc(nome)}" alt="Logo ${safe}" class="logo-label-img" onerror="${getLogoFallbackAttr()}">
      <span>${safe}</span>
    </span>
  `;
};
function parseRange(s){
  if(!s) return null;
  const t = String(s).trim().replace(/–/g,'-').replace(/\s+a\s+/i,'-').replace(/\s+/g,'');
  if(t.includes('-')){
    const [a,b] = t.split('-').map(n=>parseInt(n,10));
    if(!isNaN(a)&&!isNaN(b)) return {min:a,max:b};
    return null;
  }
  const n = parseInt(t,10);
  return isNaN(n) ? null : {min:n,max:n};
}
function idadeMatch(linha, idade){
  if(!idade) return true;
  const rg = parseRange(linha?.idade);
  if(!rg) return false;
  return idade >= rg.min && idade <= rg.max;
}
const LOAS_PRAZOS_MAP = {
  margem: [
    { key: 'loas87Ranges', label: 'LOAS 87 - Margem' },
    { key: 'loas88Ranges', label: 'LOAS 88 - Margem' }
  ],
  cartao: [
    { key: 'loas87Cartao', label: 'LOAS 87 - Cartão' },
    { key: 'loas88Cartao', label: 'LOAS 88 - Cartão' }
  ],
  refin: [
    { key: 'loas87Refin', label: 'LOAS 87 - Refin' },
    { key: 'loas88Refin', label: 'LOAS 88 - Refin' }
  ],
  port: [
    { key: 'loas87Port', label: 'LOAS 87 - Portabilidade' },
    { key: 'loas88Port', label: 'LOAS 88 - Portabilidade' }
  ]
};
function produtoKeyMap(especie){
  switch(especie){
    case 'loas':      return {margem:'loasFazMargem', cartao:'loasFazCartao', refin:'loasFazRefin', port:'loasFazPortabilidade', saque:null};
    case 'invalidez': return {margem:'invalidezFazMargem', cartao:'invalidezFazCartao', refin:'invalidezFazRefin', port:'invalidezFazPortabilidade', saque:null};
    case 'pensao':    return {margem:'pensaoFazMargem', cartao:'pensaoFazCartao', refin:'pensaoFazRefin', port:'pensaoFazPortabilidade', saque:null};
    default:          return {margem:'fazMargem', cartao:'fazCartao', refin:'fazRefin', port:'fazPortabilidade', saque:'fazSaqueComplementar'};
  }
}
function prazosAccessor(b, especie, produto){
  if(especie==='loas'){
    return (LOAS_PRAZOS_MAP[produto]||[]).map(({key,label}) => ({
      label,
      linhas: Array.isArray(b[key]) ? b[key] : []
    }));
  }
  if(especie==='invalidez'){
    const map = { margem:'invalidezPrazos', cartao:'invalidezCartao', refin:'invalidezRefin', port:'invalidezPort' };
    const linhas = Array.isArray(b[map[produto]]) ? b[map[produto]] : [];
    return linhas.length ? [{ label:null, linhas }] : [];
  }
  if(especie==='pensao'){
    const map = { margem:'prazosPensao', cartao:'prazosPensaoCartao', refin:'prazosPensaoRefin', port:'prazosPensaoPort' };
    const linhas = Array.isArray(b[map[produto]]) ? b[map[produto]] : [];
    return linhas.length ? [{ label:null, linhas }] : [];
  }
  const map = { margem:'prazos', cartao:'prazosCartao', port:'prazosPortabilidade' };
  const linhas = map[produto] ? (Array.isArray(b[map[produto]]) ? b[map[produto]] : []) : [];
  return linhas.length ? [{ label:null, linhas }] : [];
}
function especieAssinaturaOK(b, especie, assina){
  if(especie==='loas'){
    if(!b.aceitaLoas) return false;
    if(assina==='nao' && !(b.loasAceitaNaoAssina || b.aceitaClienteNaoAssina)) return false;
    return true;
  }
  if(especie==='invalidez'){
    if(!b.aceitaInvalidez) return false;
    if(assina==='nao' && !b.aceitaClienteNaoAssina) return false;
    return true;
  }
  if(especie==='pensao'){
    if(!(b.aceitaClientePensao || b.fazPensao)) return false;
    if(assina==='nao' && !(b.pensaoAceitaNaoAssina || b.aceitaClienteNaoAssina)) return false;
    return true;
  }
  if(assina==='nao' && !b.aceitaClienteNaoAssina) return false;
  return true;
}
function produtosOK(b, especie, prodsSel){
  const map = produtoKeyMap(especie);
  const requeridos = Object.entries(prodsSel).filter(([,v])=>!!v).map(([k])=>k);
  if(!requeridos.length) return true;
  return requeridos.every(p => {
    const key = map[p];
    return key ? !!b[key] : false;
  });
}
function extractLoasTipo(label){
  const match = /LOAS\s+(\d+)/i.exec(label || '');
  return match ? `LOAS ${match[1]}` : null;
}

export function prazosPorIdade(b, especie, idade, prodsSel){
  const selecionados = Object.entries(prodsSel).filter(([,v])=>!!v).map(([k])=>k);
  const listar = (selecionados.length ? selecionados : ['margem','cartao','refin','port','saque']);
  const out = [];
  for(const p of listar){
    const blocos = prazosAccessor(b, especie, p);
    if(!blocos || !blocos.length) continue;
    for(const bloco of blocos){
      const linhas = idade ? bloco.linhas.filter(l => idadeMatch(l, idade)) : bloco.linhas;
      if(!linhas || !linhas.length) continue;
      out.push({produto:p, linhas, label:bloco.label});
    }
  }
  return out;
}
function lerControles(ctrls){
  const idade = Number(document.querySelector(ctrls.idade)?.value || 0) || null;
  const especie = document.querySelector(ctrls.especie)?.value || 'geral';
  const assina = document.querySelector(ctrls.assina)?.value || 'qualquer';
  const nome   = (document.querySelector(ctrls.nome)?.value || '').trim().toLowerCase();
  const prods = {
    margem: !!document.querySelector(ctrls.prods.margem)?.checked,
    cartao: !!document.querySelector(ctrls.prods.cartao)?.checked,
    refin:  !!document.querySelector(ctrls.prods.refin)?.checked,
    port:   !!document.querySelector(ctrls.prods.port)?.checked,
    saque:  !!document.querySelector(ctrls.prods.saque)?.checked,
  };
  return { idade, especie, assina, nome, prods };
}
export function aplicarFiltros(db, f){
  const source = Array.isArray(db) ? db.filter(b => !b.suspenso) : [];
  const base = source.filter(b=>{
    if(f.nome && !String(b.nomeBanco||'').toLowerCase().includes(f.nome)) return false;
    if(!especieAssinaturaOK(b, f.especie, f.assina)) return false;
    if(!produtosOK(b, f.especie, f.prods)) return false;
    if(f.idade){
      const selecionados = Object.keys(f.prods).filter(p => f.prods[p]);
      if(selecionados.length){
        if(!selecionados.every(p => prazosPorIdade(b, f.especie, f.idade, {[p]:true}).length)) return false;
      } else if(prazosPorIdade(b, f.especie, f.idade, f.prods).length===0) return false;
    }
    return true;
  });
  base.sort((a,b)=> String(a.nomeBanco||'').localeCompare(String(b.nomeBanco||'')));
  return base;
}
function pickPrimeiroPrazo(b, especie, idade, prodsSel){
  const blocos = prazosPorIdade(b, especie, idade, prodsSel);
  if(!blocos.length) return null;
  const bloco = blocos[0];
  const l = (bloco.linhas||[])[0];
  if(!l) return null;
  return { parcelas: l.parcelas ?? l.prazo ?? null, obs: l.obs || '', label: bloco.label };
}
function buildRapidoCards(list, f){
  const cards = [];
  for(const b of list){
    if(f.especie === 'loas'){
      const blocos = prazosPorIdade(b, f.especie, f.idade, f.prods);
      const porTipo = new Map();
      for(const bloco of blocos){
        const tipo = extractLoasTipo(bloco.label);
        if(!tipo || porTipo.has(tipo)) continue;
        const linha = (bloco.linhas || [])[0];
        if(!linha) continue;
        porTipo.set(tipo, {
          banco: b,
          hit: { parcelas: linha.parcelas ?? linha.prazo ?? null, obs: linha.obs || '' },
          loasTag: tipo
        });
      }
      porTipo.forEach(card => cards.push(card));
    } else {
      const hit = pickPrimeiroPrazo(b, f.especie, f.idade, f.prods);
      if(hit) cards.push({ banco: b, hit });
    }
  }
  return cards;
}
function renderRapido(list, f, mountSel){
  const mount = document.querySelector(mountSel);
  if(!mount) return;
  if(!list.length){
    mount.classList.remove('grid-rapido');
    mount.innerHTML = `<div class="f-empty">Nenhum resultado. Ajuste os filtros e pesquise.</div>`;
    return;
  }
  mount.classList.add('grid-rapido');
  const idadeTxt = f.idade!=null ? `${f.idade} anos` : '—';
  const cards = buildRapidoCards(list, f);
  if(!cards.length){
    mount.classList.remove('grid-rapido');
    mount.innerHTML = `<div class="f-empty">Nenhum resultado. Ajuste os filtros e pesquise.</div>`;
    return;
  }
  mount.innerHTML = cards.map(({banco: b, hit, loasTag})=>{
    const prazo = hit?.parcelas ? `${hit.parcelas}x` : '—';
    const obs = hit?.obs ? `<div class="r-obs" title="${esc(hit.obs)}">${esc(hit.obs)}</div>` : '';
    const tag = loasTag ? `<span class="r-loas-tag">${esc(loasTag)}</span>` : '';
    return `
      <div class="card-rapido">
        <div class="r-bank">
          ${renderLogoLabel(b.nomeBanco || b.nome || 'Banco')}
          ${tag}
        </div>
        <div class="r-grid">
          <div><span class="r-k">Idade</span><span class="r-v">${esc(idadeTxt)}</span></div>
          <div><span class="r-k">Prazo</span><span class="r-v big">${esc(prazo)}</span></div>
          <div class="r-obs-wrap">${obs}</div>
        </div>
      </div>
    `;
  }).join('');
}
export function runRapido(config){
  const {
    resultsEl = '#results',
    controls = {
      idade:'#f-idade', especie:'#f-especie', assina:'#f-assina', nome:'#f-nome',
      prods:{ margem:'#p-margem', cartao:'#p-cartao', refin:'#p-refin', port:'#p-port', saque:'#p-saque' }
    }
  } = config || {};
  const db = getDB();
  const f  = lerControles(controls);
  const lista = aplicarFiltros(db, f);
  renderRapido(lista, f, resultsEl);
}

