import { BASE_INSS_KEY, BASE_INSS_FALLBACKS, readFromStorage } from '../config/storageKeys.js';
// Modo RÁPIDO: mostra cards compactos com Banco + (Idade do filtro) + 1º prazo compatível + Obs
function getDB(){
  const data = readFromStorage(BASE_INSS_KEY, BASE_INSS_FALLBACKS);
  return Array.isArray(data) ? data : [];
}
const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
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
    const map = { margem:['loas87Ranges','loas88Ranges'], cartao:['loas87Cartao','loas88Cartao'], refin:['loas87Refin','loas88Refin'], port:['loas87Port','loas88Port'] };
    const keys = map[produto]||[];
    return keys.flatMap(k=>Array.isArray(b[k])?b[k]:[]);
  }
  if(especie==='invalidez'){
    const map = { margem:'invalidezPrazos', cartao:'invalidezCartao', refin:'invalidezRefin', port:'invalidezPort' };
    return Array.isArray(b[map[produto]]) ? b[map[produto]] : [];
  }
  if(especie==='pensao'){
    const map = { margem:'prazosPensao', cartao:'prazosPensaoCartao', refin:'prazosPensaoRefin', port:'prazosPensaoPort' };
    return Array.isArray(b[map[produto]]) ? b[map[produto]] : [];
  }
  const map = { margem:'prazos', cartao:'prazosCartao', port:'prazosPortabilidade' };
  return map[produto] ? (Array.isArray(b[map[produto]]) ? b[map[produto]] : []) : [];
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
    return key ? !!b[key] : true;
  });
}
function prazosPorIdade(b, especie, idade, prodsSel){
  const selecionados = Object.entries(prodsSel).filter(([,v])=>!!v).map(([k])=>k);
  const listar = (selecionados.length ? selecionados : ['margem','cartao','refin','port','saque']);
  const out = [];
  for(const p of listar){
    const arr = prazosAccessor(b, especie, p);
    if(!arr || !arr.length) continue;
    const linhas = idade ? arr.filter(l => idadeMatch(l, idade)) : arr;
    if(!linhas.length) continue;
    out.push({produto:p, linhas});
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
function aplicarFiltros(db, f){
  const source = Array.isArray(db) ? db.filter(b => !b.suspenso) : [];
  const base = source.filter(b=>{
    if(f.nome && !String(b.nomeBanco||'').toLowerCase().includes(f.nome)) return false;
    if(!especieAssinaturaOK(b, f.especie, f.assina)) return false;
    if(!produtosOK(b, f.especie, f.prods)) return false;
    const prazos = prazosPorIdade(b, f.especie, f.idade, f.prods);
    if(f.idade && prazos.length===0) return false;
    return true;
  });
  base.sort((a,b)=> String(a.nomeBanco||'').localeCompare(String(b.nomeBanco||'')));
  return base;
}
function pickPrimeiroPrazo(b, especie, idade, prodsSel){
  const blocos = prazosPorIdade(b, especie, idade, prodsSel);
  if(!blocos.length) return null;
  const l = (blocos[0].linhas||[])[0];
  if(!l) return null;
  return { parcelas: l.parcelas ?? l.prazo ?? null, obs: l.obs || '' };
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
  mount.innerHTML = list.map(b=>{
    const hit = pickPrimeiroPrazo(b, f.especie, f.idade, f.prods);
    const prazo = hit?.parcelas ? `${hit.parcelas}x` : '—';
    const obs = hit?.obs ? `<div class="r-obs" title="${esc(hit.obs)}">${esc(hit.obs)}</div>` : '';
    return `
      <div class="card-rapido">
        <div class="r-bank">${esc(b.nomeBanco||'Banco')}</div>
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

