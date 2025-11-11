import { BASE_INSS_KEY, BASE_INSS_FALLBACKS, readFromStorage } from '../config/storageKeys.js';
import { getLogoSrc, getLogoFallbackAttr } from '../utils/logo.js';
// js/filtros/filtros.js
// Pesquisa + filtros (simples/avançado) usando base salva no localStorage (regras_bancos_v1)

function getDB() {
  const data = readFromStorage(BASE_INSS_KEY, BASE_INSS_FALLBACKS);
  return Array.isArray(data) ? data : [];
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function renderLogoLabel(nome) {
  const safeNome = esc(nome || '—');
  const src = getLogoSrc(nome);
  return `
    <span class="logo-label">
      <img src="${src}" alt="Logo ${safeNome}" class="logo-label-img" onerror="${getLogoFallbackAttr()}">
      <span>${safeNome}</span>
    </span>
  `;
}

function parseRange(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/"/g, '-').replace(/\s+a\s+/i, '-').replace(/\s+/g, '');
  if (t.includes('-')) {
    const [a, b] = t.split('-').map(n => parseInt(n, 10));
    if (!isNaN(a) && !isNaN(b)) return { min: a, max: b };
    return null;
  }
  const n = parseInt(t, 10);
  return isNaN(n) ? null : { min: n, max: n };
}
function idadeMatch(linha, idade) {
  if (!idade) return true;
  const rg = parseRange(linha?.idade);
  if (!rg) return false;
  return idade >= rg.min && idade <= rg.max;
}

// === Mapas por espécie ===
function produtoKeyMap(especie) {
  switch (especie) {
    case 'loas':
      return {margem: 'loasFazMargem', cartao: 'loasFazCartao', refin:'loasFazRefin', port:'loasFazPortabilidade', saque:null};
    case 'invalidez':
      return {margem: 'invalidezFazMargem', cartao:'invalidezFazCartao', refin:'invalidezFazRefin', port:'invalidezFazPortabilidade', saque:null};
    case 'pensao':
      return {margem: 'pensaoFazMargem', cartao:'pensaoFazCartao', refin:'pensaoFazRefin', port:'pensaoFazPortabilidade', saque:null};
    default:
      return {margem:'fazMargem', cartao:'fazCartao', refin:'fazRefin', port:'fazPortabilidade', saque:'fazSaqueComplementar'};
  }
}

function prazosAccessor(b, especie, produto) {
  if (especie === 'loas') {
    const map = {
      margem: ['loas87Ranges','loas88Ranges'],
      cartao: ['loas87Cartao','loas88Cartao'],
      refin:  ['loas87Refin','loas88Refin'],
      port:   ['loas87Port','loas88Port']
    };
    const keys = map[produto] || [];
    return keys.flatMap(k => Array.isArray(b[k]) ? b[k] : []);
  }
  if (especie === 'invalidez') {
    const map = { margem:'invalidezPrazos', cartao:'invalidezCartao', refin:'invalidezRefin', port:'invalidezPort' };
    const k = map[produto];
    return Array.isArray(b[k]) ? b[k] : [];
  }
  if (especie === 'pensao') {
    const map = { margem:'prazosPensao', cartao:'prazosPensaoCartao', refin:'prazosPensaoRefin', port:'prazosPensaoPort' };
    const k = map[produto];
    return Array.isArray(b[k]) ? b[k] : [];
  }
  const map = { margem:'prazos', cartao:'prazosCartao', port:'prazosPortabilidade' };
  const k = map[produto];
  return k ? (Array.isArray(b[k]) ? b[k] : []) : [];
}

function especieAssinaturaOK(b, especie, assina) {
  if (especie === 'loas') {
    if (!b.aceitaLoas) return false;
    if (assina === 'nao' && !(b.loasAceitaNaoAssina || b.aceitaClienteNaoAssina)) return false;
    return true;
  }
  if (especie === 'invalidez') {
    if (!b.aceitaInvalidez) return false;
    if (assina === 'nao' && !b.aceitaClienteNaoAssina) return false;
    return true;
  }
  if (especie === 'pensao') {
    if (!(b.aceitaClientePensao || b.fazPensao)) return false;
    if (assina === 'nao' && !(b.pensaoAceitaNaoAssina || b.aceitaClienteNaoAssina)) return false;
    return true;
  }
  if (assina === 'nao' && !b.aceitaClienteNaoAssina) return false;
  return true;
}

function produtosOK(b, especie, prodsSel) {
  const map = produtoKeyMap(especie);
  const requeridos = Object.entries(prodsSel).filter(([,v]) => !!v).map(([k]) => k);
  if (!requeridos.length) return true;
  return requeridos.every(p => {
    const key = map[p];
    return key ? !!b[key] : true;
  });
}

function prazosPorIdade(b, especie, idade, prodsSel) {
  const selecionados = Object.entries(prodsSel).filter(([,v]) => !!v).map(([k]) => k);
  const listar = (selecionados.length ? selecionados : ['margem','cartao','refin','port','saque']);
  const out = [];

  for (const p of listar) {
    const arr = prazosAccessor(b, especie, p);
    if (!arr || !arr.length) continue;
    const linhas = idade ? arr.filter(l => idadeMatch(l, idade)) : arr;
    if (!linhas.length) continue;
    out.push({produto: p, linhas});
  }
  return out;
}

// ===== RENDER =====
const yesNo = v => v ? 'Sim' : 'Não';

function renderOperacoesResumo(b, especie){
  const keys = produtoKeyMap(especie);
  const items = Object.entries(keys)
    .filter(([k,key]) => !!key)
    .map(([k,key]) => `<span class="chip ${b[key]?'ok':'no'}">${k}</span>`).join(' ');
  return `
    <div class="subblock">
      <div class="subttl">Operações</div>
      <div class="chips">${items || '—'}</div>
    </div>`;
}

function renderPerfisResumo(b, especie){
  const linhas = [];
  if (especie === 'loas') {
    linhas.push(`<li><b>Aceita LOAS?</b> ${yesNo(b.aceitaLoas)}</li>`);
    linhas.push(`<li><b>LOAS não assinante?</b> ${yesNo(b.loasAceitaNaoAssina || b.aceitaClienteNaoAssina)}</li>`);
  } else if (especie === 'invalidez') {
    linhas.push(`<li><b>Aceita Invalidez?</b> ${yesNo(b.aceitaInvalidez)}</li>`);
    linhas.push(`<li><b>Não assinante?</b> ${yesNo(b.aceitaClienteNaoAssina)}</li>`);
  } else if (especie === 'pensao') {
    linhas.push(`<li><b>Aceita Pensão?</b> ${yesNo(b.aceitaClientePensao || b.fazPensao)}</li>`);
    linhas.push(`<li><b>Pensão não assinante?</b> ${yesNo(b.pensaoAceitaNaoAssina || b.aceitaClienteNaoAssina)}</li>`);
  } else {
    linhas.push(`<li><b>Não assinante?</b> ${yesNo(b.aceitaClienteNaoAssina)}</li>`);
    linhas.push(`<li><b>LOAS?</b> ${yesNo(b.aceitaLoas)}</li>`);
    linhas.push(`<li><b>Invalidez?</b> ${yesNo(b.aceitaInvalidez)}</li>`);
    linhas.push(`<li><b>Pensão?</b> ${yesNo(b.aceitaClientePensao || b.fazPensao)}</li>`);
  }
  return `
    <div class="subblock">
      <div class="subttl">Perfis aceitos</div>
      <ul class="kv">${linhas.join('')}</ul>
    </div>`;
}

function renderProcedimentos(b){
  const defs = [
    { flag: 'precisaVideo', label: 'Video chamada', obs: 'precisaVideoObs' },
    { flag: 'fazLigacaoCliente', label: 'Ligacao para o cliente', obs: 'fazLigacaoClienteObs' },
    { flag: 'clienteLigaBanco', label: 'Cliente liga no banco', obs: 'clienteLigaBancoObs' },
    { flag: 'precisaGravarVideo', label: 'Gravacao de video', obs: 'precisaGravarVideoObs' },
    { flag: 'precisaEnviarContratoBanco', label: 'Enviar contrato ao banco', obs: 'precisaEnviarContratoBancoObs' }
  ];

  const itens = defs
    .filter(({ flag }) => !!b[flag])
    .map(({ label, obs }) => {
      const detalhe = (obs && b[obs]) ? esc(b[obs]) : 'Sim';
      return `<li><b>${label}</b> ${detalhe}</li>`;
    })
    .join('');

  if (!itens) return '';

  return `
  <div class="subblock">
    <div class="subttl">Procedimentos</div>
    <ul class="kv">${itens}</ul>
  </div>`;
}
function renderContrato60(b){
  if (!b.contrato60) return '';
  return `
  <div class="subblock">
    <div class="subttl">Contrato 60+</div>
    <ul class="kv">
      <li><b>Faz contrato 60+?</b> Sim</li>
      <li><b>Estados:</b> ${esc(b.contrato60_estados || '—')}</li>
      <li><b>Enviar físico ao banco?</b> ${yesNo(b.contrato60_enviarFisico)}</li>
      <li><b>Enviar físico por email?</b> ${yesNo(b.contrato60_enviarEmail)}</li>
      <li><b>Precisa gravar vídeo?</b> ${yesNo(b.contrato60_precisaGravarVideo)}</li>
      ${b.contrato60_gravarVideoObs ? `<li class="obs">• ${esc(b.contrato60_gravarVideoObs)}</li>` : ''}
    </ul>
  </div>`;
}

function renderNaoAssina(b){
  if (!b.aceitaClienteNaoAssina) return '';
  return `
  <div class="subblock">
    <div class="subttl">Regras para cliente não assinante</div>
    <ul class="kv">
      <li><b>Enviar físico ao banco?</b> ${yesNo(b.naoAssina_precisaEnviarFisico)}</li>
      <li><b>Precisa na videochamada?</b> ${yesNo(b.naoAssina_precisaVideo)}</li>
      ${b.naoAssina_precisaVideoObs ? `<li class="obs">• ${esc(b.naoAssina_precisaVideoObs)}</li>` : ''}
      <li><b>Faz ligação para o cliente?</b> ${yesNo(b.naoAssina_fazLigacao)}</li>
      ${b.naoAssina_fazLigacaoObs ? `<li class="obs">• ${esc(b.naoAssina_fazLigacaoObs)}</li>` : ''}
      <li><b>Cliente tem de ligar no banco?</b> ${yesNo(b.naoAssina_clienteLigaBanco)}</li>
      ${b.naoAssina_clienteLigaBancoObs ? `<li class="obs">• ${esc(b.naoAssina_clienteLigaBancoObs)}</li>` : ''}
      <li><b>Enviar físico por email?</b> ${yesNo(b.naoAssina_precisaEnviarEmail)}</li>
      <li><b>Precisa gravar vídeo?</b> ${yesNo(b.naoAssina_precisaGravarVideo)}</li>
      ${b.naoAssina_gravarVideoObs ? `<li class="obs">• ${esc(b.naoAssina_gravarVideoObs)}</li>` : ''}
    </ul>
  </div>`;
}

function renderTopResumo(b){
  return `
    <div class="mini-grid">
      <div><b>Teimosinha:</b> ${esc(b.teimosinha || '—')}</div>
      <div><b>Mínimo liberado:</b> ${b.minimoLiberado ? esc(b.minimoLiberado) : '—'}</div>
      <div><b>Tipo de mínimo:</b> ${esc(b.tipoMinimo || '—')}</div>
    </div>
  `;
}

function tituloProdutoLabel(p) {
  const map = { margem:'Margem', cartao:'Cartão', refin:'Refin', port:'Portabilidade', saque:'Saque compl.' };
  return map[p] || p;
}

function renderPrazosTabela(blocos, compacto=false){
  if (!blocos || !blocos.length) return '';
  const parts = blocos.map(({produto,linhas})=>{
    const subset = compacto ? linhas.slice(0,1) : linhas;
    const rows = subset.map(l => `
      <tr>
        <td>${esc(l.idade || '—')}</td>
        <td>${esc(l.parcelas || '—')}</td>
        <td>${esc(l.obs || '—')}</td>
      </tr>`).join('');
    return `
      <div class="subblock">
        <div class="subttl">Prazos — ${tituloProdutoLabel(produto)}${compacto && linhas.length>1 ? ' (mostrando 1)' : ''}</div>
        <div class="tbl-wrap">
          <table class="prazo-tbl">
            <thead><tr><th>Idade</th><th>Parcelas</th><th>Obs.</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
  return parts;
}

function renderCard(b, opts){
  const {especie, idade, prodsSel, avancado} = opts;
  const prazos = prazosPorIdade(b, especie, idade, prodsSel);

  return `
    <div class="f-card">
      <div class="f-head">
        <div class="f-title">${renderLogoLabel(b.nomeBanco || b.nome || '—')}</div>
      </div>

      ${renderTopResumo(b)}

      ${avancado
        ? `
          ${renderProcedimentos(b)}
          ${renderContrato60(b)}
          ${renderNaoAssina(b)}
          ${renderPrazosTabela(prazos, false)}
        `
        : `
          ${renderOperacoesResumo(b, especie)}
          ${renderPerfisResumo(b, especie)}
          ${renderPrazosTabela(prazos, true)}
        `
      }
    </div>
  `;
}

// ===== FILTROS =====
function lerControles(controls) {
  const idade = Number(document.querySelector(controls.idade)?.value || 0) || null;
  const especie = document.querySelector(controls.especie)?.value || 'geral';
  const assina = document.querySelector(controls.assina)?.value || 'qualquer';
  const nome = (document.querySelector(controls.nome)?.value || '').trim().toLowerCase();

  const prods = {
    margem: !!document.querySelector(controls.prods.margem)?.checked,
    cartao: !!document.querySelector(controls.prods.cartao)?.checked,
    refin:  !!document.querySelector(controls.prods.refin)?.checked,
    port:   !!document.querySelector(controls.prods.port)?.checked,
    saque:  !!document.querySelector(controls.prods.saque)?.checked
  };

  const avancado = !!document.querySelector(controls.advanced)?.checked;

  return { idade, especie, assina, nome, prods, avancado };
}

function aplicarFiltros(db, f) {
  // Oculta bancos suspensos na Pesquisa, mas eles permanecem salvos na base
  const source = Array.isArray(db) ? db.filter(b => !b.suspenso) : [];

  const nadaPreenchido =
    !f.idade &&
    (f.especie === 'geral' || f.especie === 'qualquer') &&
    (f.assina === 'qualquer') &&
    !f.nome &&
    !f.prods.margem && !f.prods.cartao && !f.prods.refin && !f.prods.port && !f.prods.saque;

  const base = (f.avancado && nadaPreenchido) ? source : source.filter(b => {
    if (f.nome && !String(b.nomeBanco || '').toLowerCase().includes(f.nome)) return false;
    if (!especieAssinaturaOK(b, f.especie, f.assina)) return false;
    if (!produtosOK(b, f.especie, f.prods)) return false;

    const prazos = prazosPorIdade(b, f.especie, f.idade, f.prods);
    if (f.idade && prazos.length === 0) return false;

    return true;
  });

  base.sort((a,b)=> String(a.nomeBanco || '').localeCompare(String(b.nomeBanco || '')));
  return base;
}

function renderResultados(list, f, mountSel) {
  const mount = document.querySelector(mountSel);
  if (!mount) return;

  if (!list.length) {
    mount.innerHTML = `<div class="f-empty">Nenhum resultado. Ajuste os filtros e pesquise.</div>`;
    return;
  }

  const html = list.map(b => renderCard(b, {
    especie: f.especie,
    idade: f.idade,
    prodsSel: f.prods,
    avancado: f.avancado
  })).join('');

  mount.innerHTML = html;
}

// ===== API =====
export function initFiltros(config) {
  const {
    resultsEl = '#results',
    triggerBtn = '#btn-search',
    controls = {
      idade:'#f-idade', especie:'#f-especie', assina:'#f-assina', nome:'#f-nome',
      prods:{ margem:'#p-margem', cartao:'#p-cartao', refin:'#p-refin', port:'#p-port', saque:'#p-saque' },
      advanced:'#f-advanced'
    }
  } = config || {};

  const db = getDB();

  const results = document.querySelector(resultsEl);
  if (results) results.innerHTML = '';

  document.querySelector(triggerBtn)?.addEventListener('click', () => {
    const filtros = lerControles(controls);
    const lista = aplicarFiltros(db, filtros);
    renderResultados(lista, filtros, resultsEl);
  });

  document.querySelector('#btn-clear')?.addEventListener('click', () => {
    const idade = document.querySelector(controls.idade);
    const especie = document.querySelector(controls.especie);
    const assina = document.querySelector(controls.assina);
    const nome = document.querySelector(controls.nome);
    const adv = document.querySelector(controls.advanced);
    const pm = document.querySelector(controls.prods.margem);
    const pc = document.querySelector(controls.prods.cartao);
    const pr = document.querySelector(controls.prods.refin);
    const pp = document.querySelector(controls.prods.port);
    const ps = document.querySelector(controls.prods.saque);

    if (idade) idade.value = '';
    if (especie) especie.value = 'geral';
    if (assina) assina.value = 'qualquer';
    if (nome) nome.value = '';
    if (adv) adv.checked = false;
    if (pm) pm.checked = false;
    if (pc) pc.checked = false;
    if (pr) pr.checked = false;
    if (pp) pp.checked = false;
    if (ps) ps.checked = false;

    if (results) results.innerHTML = '';
  });
}


