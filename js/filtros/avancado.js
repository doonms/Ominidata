import { BASE_INSS_KEY, BASE_INSS_FALLBACKS, readFromStorage } from '../config/storageKeys.js';
import { getLogoSrc, getLogoFallbackAttr } from '../utils/logo.js';
// /js/filtros/avancado.js
// Modo AVANÇADO — mostra TODAS as seções + TODOS os prazos.
// Se tiver filtro de idade, filtra os prazos por idade; senão, mostra tudo.
// Nada de "muralha de sim/não": listas compactas ("chips") e prazos em grade.

// ---------- Utils ----------
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
function lerControles(controls){
  const idade = Number(document.querySelector(controls.idade)?.value || 0) || null;
  const especie = document.querySelector(controls.especie)?.value || 'geral';
  const assina = document.querySelector(controls.assina)?.value || 'qualquer';
  const nome   = (document.querySelector(controls.nome)?.value || '').trim().toLowerCase();
  const prods = {
    margem: !!document.querySelector(controls.prods.margem)?.checked,
    cartao: !!document.querySelector(controls.prods.cartao)?.checked,
    refin:  !!document.querySelector(controls.prods.refin)?.checked,
    port:   !!document.querySelector(controls.prods.port)?.checked,
    saque:  !!document.querySelector(controls.prods.saque)?.checked,
  };
  return { idade, especie, assina, nome, prods };
}
function filtraBancos(db, f){
  const source = Array.isArray(db) ? db.filter(b => !b.suspenso) : [];
  const base = source.filter(b=>{
  if(f.nome && !String(b.nomeBanco||'').toLowerCase().includes(f.nome)) return false;
    // no avançado não restringimos por "prods" ou "assinatura" — objetivo é visualizar tudo
    return true;
  });
  base.sort((a,b)=> String(a.nomeBanco||'').localeCompare(String(b.nomeBanco||'')));
  return base;
}
function uniqNorm(list){
  const norm = v => v
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().trim();
  const seen = new Set();
  const out = [];
  for(const it of list||[]){
    const k = norm(it);
    if(!k) continue;
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
function canonLabelRogo(item){
  const t = item.toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(['pai'].includes(t)) return 'Pai';
  if(['mae','mãe'].includes(t)) return 'Mãe';
  if(['irmao','irmão'].includes(t)) return 'Irmão';
  if(['conjuge','cônjuge'].includes(t)) return 'Cônjuge';
  if(['filho','filhos'].includes(t)) return 'Filhos';
  if(['neto','netos'].includes(t)) return 'Netos';
  if(['avos','avós'].includes(t)) return 'Avós';
  if(['outros','outro'].includes(t)) return 'Outros';
  return item;
}
function canonDoc(doc){
  const t = doc.toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(t==='rg') return 'RG';
  if(t==='cnh') return 'CNH';
  if(t==='ctps') return 'CTPS';
  return doc;
}

// ---------- Seções (chips sem “sim/não”) ----------
function secOperacoes(b){
  const items = [];
  if(b.fazMargem) items.push('Margem');
  if(b.fazCartao) items.push('Cartão');
  if(b.fazRefin) items.push('Refin');
  if(b.fazSaqueComplementar) items.push('Saque compl.');
  if(b.fazPortabilidade) items.push('Portabilidade');
  return items.length ? `
    <div class="subblock">
      <div class="subttl">Operações</div>
      <div class="chips">${items.map(t=>`<span class="chip ok">${esc(t)}</span>`).join(' ')}</div>
    </div>` : '';
}
function secPerfis(b){
  const items = [];
  if(b.aceitaClienteNaoAssina) items.push('Não assinante');
  if(b.aceitaLoas) items.push('LOAS');
  if(b.aceitaInvalidez) items.push('Invalidez');
  if(b.aceitaClientePensao || b.fazPensao) items.push('Pensão');
  return items.length ? `
    <div class="subblock">
      <div class="subttl">Perfis aceitos</div>
      <div class="chips">${items.map(t=>`<span class="chip ok">${esc(t)}</span>`).join(' ')}</div>
    </div>` : '';
}
function secRogo(b){
  const base = uniqNorm(b.rogo||[]).map(canonLabelRogo);
  const items = [];
  const hasOutros = base.some(v => canonLabelRogo(v)==='Outros' || /outros/i.test(v));
  for(const it of base){
    const lab = canonLabelRogo(it);
    if(lab && lab!=='Outros') items.push(lab);
  }
  const outros = hasOutros || b.rogoOutros ? (b.rogoOutros||'') : '';
  return (items.length || outros) ? `
    <div class="subblock">
      <div class="subttl">Tipos de rogo aceitos</div>
      <div class="chips">${items.map(t=>`<span class="chip ok">${esc(t)}</span>`).join(' ')}${hasOutros?` <span class="chip ok">Outros</span>`:''}</div>
      ${outros ? `<div class="mini-grid" style="margin-top:6px"><div style="grid-column:1/-1"><b>Outros:</b> ${esc(outros)}</div></div>`:''}
    </div>` : '';
}
function secDocs(b){
  const norm = uniqNorm(b.documentos||[]).map(canonDoc)
    .filter(x => !!x)
    .map(x => x.toUpperCase())
    .filter((x,i,a)=>a.indexOf(x)===i);
  const outs = b.outrosDocs ? ` <span class="chip ok" title="${esc(b.outrosDocs)}">Outros</span>` : '';
  return norm.length || b.outrosDocs ? `
    <div class="subblock">
      <div class="subttl">Documentos aceitos</div>
      <div class="chips">${norm.map(t=>`<span class="chip ok">${esc(t)}</span>`).join(' ')}${outs}</div>
    </div>` : '';
}
function secProcedimentos(b){
  const items = [];
  if(b.precisaVideo) items.push({t:'Vídeo chamada', obs:b.precisaVideoObs});
  if(b.fazLigacaoCliente) items.push({t:'Ligação do banco', obs:b.fazLigacaoClienteObs});
  if(b.clienteLigaBanco) items.push({t:'Cliente liga', obs:b.clienteLigaBancoObs});
  if(b.precisaGravarVideo) items.push({t:'Gravar vídeo', obs:b.gravarVideoObs});
  if(b.precisaEnviarContratoBanco) items.push({t:'Enviar contrato ao banco'});
  if(!items.length) return '';
  return `
    <div class="subblock">
      <div class="subttl">Procedimentos</div>
      <div class="chips">
        ${items.map(x=>`<span class="chip ok" ${x.obs?`title="${esc(x.obs)}"`:''}>${esc(x.t)}</span>`).join(' ')}
      </div>
      ${items.some(x=>x.obs) ? `<div class="mini-grid" style="margin-top:6px">
        ${items.filter(x=>x.obs).map(x=>`<div style="grid-column:1/-1"><b>${esc(x.t)}:</b> ${esc(x.obs)}</div>`).join('')}
      </div>`:''}
    </div>`;
}
function secNaoAssina(b){
  const items = [];
  if(b.naoAssina_precisaEnviarFisico) items.push({t:'Enviar físico'});
  if(b.naoAssina_precisaEnviarEmail) items.push({t:'Enviar por e-mail'});
  if(b.naoAssina_precisaVideo) items.push({t:'Vídeo chamada', obs:b.naoAssina_precisaVideoObs});
  if(b.naoAssina_fazLigacao) items.push({t:'Ligação do banco', obs:b.naoAssina_fazLigacaoObs});
  if(b.naoAssina_clienteLigaBanco) items.push({t:'Cliente liga', obs:b.naoAssina_clienteLigaBancoObs});
  if(b.naoAssina_precisaGravarVideo) items.push({t:'Gravar vídeo', obs:b.naoAssina_gravarVideoObs});
  if(!items.length) return '';
  return `
    <div class="subblock">
      <div class="subttl">Regras para cliente não assinante</div>
      <div class="chips">
        ${items.map(x=>`<span class="chip ok" ${x.obs?`title="${esc(x.obs)}"`:''}>${esc(x.t)}</span>`).join(' ')}
      </div>
      ${items.some(x=>x.obs) ? `<div class="mini-grid" style="margin-top:6px">
        ${items.filter(x=>x.obs).map(x=>`<div style="grid-column:1/-1"><b>${esc(x.t)}:</b> ${esc(x.obs)}</div>`).join('')}
      </div>`:''}
    </div>`;
}
function secContrato60(b){
  if(!b.contrato60) return '';
  const tags = [];
  if(b.contrato60_enviarFisico) tags.push('Enviar físico');
  if(b.contrato60_enviarEmail) tags.push('Enviar por e-mail');
  if(b.contrato60_precisaGravarVideo) tags.push('Gravar vídeo');
  const estados = b.contrato60_estados ? `<span class="chip ok" title="Estados">${esc(b.contrato60_estados)}</span>` : '';
  return `
    <div class="subblock">
      <div class="subttl">Contrato 60+</div>
      <div class="chips">${estados} ${tags.map(t=>`<span class="chip ok">${esc(t)}</span>`).join(' ')}</div>
    </div>`;
}
function secExtras(b){
  const rows = [];
  if(b.teimosinha) rows.push(`<div><b>Teimosinha:</b> ${esc(b.teimosinha)}</div>`);
  if(b.minimoLiberado) rows.push(`<div><b>Mínimo liberado:</b> ${esc(b.minimoLiberado)}</div>`);
  if(b.tipoMinimo) rows.push(`<div><b>Tipo de mínimo:</b> ${esc(b.tipoMinimo)}</div>`);
  if(!rows.length) return '';
  return `
    <div class="subblock">
      <div class="subttl">Extras</div>
      <div class="mini-grid">${rows.join('')}</div>
    </div>`;
}

// ---------- Prazos ----------
function nonEmptyPrazo(p){
  const parcelas = String(p?.parcelas||'').trim();
  const obs = String(p?.obs||'').trim();
  const idade = String(p?.idade||'').trim();
  return !!(idade || parcelas || obs);
}
function buildPrazoRows(arr, idadeFiltro){
  const base = Array.isArray(arr) ? arr : [];
  const filtrada = idadeFiltro ? base.filter(p => idadeMatch(p, idadeFiltro)) : base;
  const limpos = filtrada.filter(nonEmptyPrazo);
  if(!limpos.length) return '';
  const rows = limpos.map(p => `
    <div class="prz-row">
      <div class="prz-c idade">${esc(p.idade || '—')}</div>
      <div class="prz-c prazo">${esc(p.parcelas ? (p.parcelas + 'x') : '—')}</div>
      <div class="prz-c obs" title="${esc(p.obs||'')}">${esc(p.obs || '—')}</div>
    </div>`).join('');
  return `
    <div class="prz-head">
      <div class="prz-h idade">Idade</div><div class="prz-h prazo">Prazo</div><div class="prz-h obs">Obs</div>
    </div>
    <div class="prz-rows">${rows}</div>`;
}
function secPrazosBanco(b, f){
  // Mostra todas as famílias (Geral, Invalidez, LOAS 87/88, Pensão), cada uma só se tiver dados
  // Filtro: aplica IDADE se informada; espécies: mostramos todas (mais fácil de comparar).
  const idade = f?.idade ?? null;
  const blocks = [];

  // Geral
  blocks.push(['Geral — Margem', b.prazos]);
  blocks.push(['Geral — Cartão', b.prazosCartao]);
  blocks.push(['Geral — Portabilidade', b.prazosPortabilidade]);

  // Invalidez
  blocks.push(['Invalidez — Margem', b.invalidezPrazos]);
  blocks.push(['Invalidez — Cartão', b.invalidezCartao]);
  blocks.push(['Invalidez — Refin', b.invalidezRefin]);
  blocks.push(['Invalidez — Portabilidade', b.invalidezPort]);

  // Pensão
  blocks.push(['Pensão — Margem', b.prazosPensao]);
  blocks.push(['Pensão — Cartão', b.prazosPensaoCartao]);
  blocks.push(['Pensão — Refin', b.prazosPensaoRefin]);
  blocks.push(['Pensão — Portabilidade', b.prazosPensaoPort]);

  // LOAS 87
  blocks.push(['LOAS 87 — Margem', b.loas87Ranges]);
  blocks.push(['LOAS 87 — Cartão', b.loas87Cartao]);
  blocks.push(['LOAS 87 — Refin', b.loas87Refin]);
  blocks.push(['LOAS 87 — Portabilidade', b.loas87Port]);

  // LOAS 88
  blocks.push(['LOAS 88 — Margem', b.loas88Ranges]);
  blocks.push(['LOAS 88 — Cartão', b.loas88Cartao]);
  blocks.push(['LOAS 88 — Refin', b.loas88Refin]);
  blocks.push(['LOAS 88 — Portabilidade', b.loas88Port]);

  const sections = blocks.map(([label, arr])=>{
    const table = buildPrazoRows(arr, idade);
    if(!table) return '';
    return `<div class="subblock prz-group"><div class="subttl">${esc(label)}</div>${table}</div>`;
  }).filter(Boolean).join('');

  return sections ? `
    <div class="subblock">
      <div class="subttl">Prazos por idade</div>
      ${sections}
    </div>` : '';
}

// ---------- Render ----------
function renderCardAvancado(b, f){
  const body = [
    secOperacoes(b),
    secPerfis(b),
    secRogo(b),
    secDocs(b),
    secProcedimentos(b),
    secNaoAssina(b),
    secContrato60(b),
    secExtras(b),
    secPrazosBanco(b, f)
  ].filter(Boolean).join('');

  return `
    <details class="f-card">
      <summary class="f-head">
        <span class="f-title">${renderLogoLabel(b.nomeBanco || b.nome || '—')}</span>
      </summary>
      <div class="f-body">
        ${body || '<div class="muted">Nenhuma informação detalhada disponível.</div>'}
      </div>
    </details>`;
}
function renderAvancado(list, f, mountSel){
  const mount = document.querySelector(mountSel);
  if(!mount) return;
  mount.classList.remove('grid-rapido');
  if(!list.length){
    mount.innerHTML = `<div class="f-empty">Nenhum resultado. Ajuste os filtros e pesquise.</div>`;
    return;
  }
  mount.innerHTML = list.map(b => renderCardAvancado(b, f)).join('');
}

// ---------- API ----------
export function runAvancado(config){
  const {
    resultsEl = '#results',
    controls = {
      idade:'#f-idade', especie:'#f-especie', assina:'#f-assina', nome:'#f-nome',
      prods:{ margem:'#p-margem', cartao:'#p-cartao', refin:'#p-refin', port:'#p-port', saque:'#p-saque' }
    }
  } = config || {};
  const db = getDB();
  const f  = lerControles(controls);
  const lista = filtraBancos(db, f);
  renderAvancado(lista, f, resultsEl);
}

// Auto-init: intercepta o clique somente quando "Avançado" estiver ativo
(function autoInit() {
  const cfg = {
    resultsEl: '#results',
    controls: {
      idade:'#f-idade', especie:'#f-especie', assina:'#f-assina', nome:'#f-nome',
      prods:{ margem:'#p-margem', cartao:'#p-cartao', refin:'#p-refin', port:'#p-port', saque:'#p-saque' }
    },
    triggerBtn: '#btn-search'
  };

  function bind() {
    const btn = document.querySelector(cfg.triggerBtn);
    btn?.addEventListener('click', (e) => {
      const modeEl = document.querySelector('input[name="modoPesquisa"][value="avancado"]');
      if (!(modeEl && modeEl.checked)) return; // não é avançado -> deixa outros cuidarem
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      runAvancado(cfg);
    }, { capture: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

