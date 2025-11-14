import { BASE_INSS_KEY, BASE_INSS_FALLBACKS, readFromStorage } from '../config/storageKeys.js';
import { getLogoSrc, getLogoFallbackAttr } from '../utils/logo.js';
// js/filtros/basico.js
// Renderização do modo Básico: cards compactos com chips resumidos

function getDB() {
  const data = readFromStorage(BASE_INSS_KEY, BASE_INSS_FALLBACKS);
  return Array.isArray(data) ? data : [];
}

const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

const renderLogoLabel = nome => {
  const safe = esc(nome || '—');
  return `
    <span class="logo-label">
      <img src="${getLogoSrc(nome)}" alt="Logo ${safe}" class="logo-label-img" onerror="${getLogoFallbackAttr()}">
      <span>${safe}</span>
    </span>
  `;
};

function parseRange(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/"|º/gi, '-').replace(/\s+a\s+/i, '-').replace(/\s+/g, '');
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
  const faixa = parseRange(linha?.idade);
  if (!faixa) return false;
  return idade >= faixa.min && idade <= faixa.max;
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

function produtoKeyMap(especie) {
  switch (especie) {
    case 'loas':
      return { margem: 'loasFazMargem', cartao: 'loasFazCartao', refin: 'loasFazRefin', port: 'loasFazPortabilidade', saque: null };
    case 'invalidez':
      return { margem: 'invalidezFazMargem', cartao: 'invalidezFazCartao', refin: 'invalidezFazRefin', port: 'invalidezFazPortabilidade', saque: null };
    case 'pensao':
      return { margem: 'pensaoFazMargem', cartao: 'pensaoFazCartao', refin: 'pensaoFazRefin', port: 'pensaoFazPortabilidade', saque: null };
    default:
      return { margem: 'fazMargem', cartao: 'fazCartao', refin: 'fazRefin', port: 'fazPortabilidade', saque: 'fazSaqueComplementar' };
  }
}

function prazosAccessor(b, especie, produto) {
  if (especie === 'loas') {
    return (LOAS_PRAZOS_MAP[produto] || []).map(({ key, label }) => ({
      label,
      linhas: Array.isArray(b[key]) ? b[key] : []
    }));
  }
  if (especie === 'invalidez') {
    const map = { margem: 'invalidezPrazos', cartao: 'invalidezCartao', refin: 'invalidezRefin', port: 'invalidezPort' };
    const linhas = Array.isArray(b[map[produto]]) ? b[map[produto]] : [];
    return linhas.length ? [{ label: null, linhas }] : [];
  }
  if (especie === 'pensao') {
    const map = { margem: 'prazosPensao', cartao: 'prazosPensaoCartao', refin: 'prazosPensaoRefin', port: 'prazosPensaoPort' };
    const linhas = Array.isArray(b[map[produto]]) ? b[map[produto]] : [];
    return linhas.length ? [{ label: null, linhas }] : [];
  }
  const map = { margem: 'prazos', cartao: 'prazosCartao', port: 'prazosPortabilidade' };
  const linhas = map[produto] ? (Array.isArray(b[map[produto]]) ? b[map[produto]] : []) : [];
  return linhas.length ? [{ label: null, linhas }] : [];
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
  const requeridos = Object.entries(prodsSel).filter(([, v]) => !!v).map(([k]) => k);
  if (!requeridos.length) return true;
  return requeridos.every(p => {
    const key = map[p];
    return key ? !!b[key] : true;
  });
}

function prazosPorIdade(b, especie, idade, prodsSel) {
  const selecionados = Object.entries(prodsSel).filter(([, v]) => !!v).map(([k]) => k);
  const listar = selecionados.length ? selecionados : ['margem', 'cartao', 'refin', 'port', 'saque'];
  const out = [];
  for (const p of listar) {
    const blocos = prazosAccessor(b, especie, p);
    if (!blocos || !blocos.length) continue;
    for (const bloco of blocos) {
      const linhas = idade ? bloco.linhas.filter(l => idadeMatch(l, idade)) : bloco.linhas;
      if (!linhas || !linhas.length) continue;
      out.push({ produto: p, linhas, label: bloco.label });
    }
  }
  return out;
}

function tituloProdutoLabel(p) {
  return ({ margem: 'Margem', cartao: 'Cartão', refin: 'Refin', port: 'Portabilidade', saque: 'Saque compl.' })[p] || p;
}

function buildOperacoes(b, especie) {
  const labels = { margem: 'Margem', cartao: 'Cartão', refin: 'Refin', port: 'Portabilidade', saque: 'Saque compl.' };
  const map = produtoKeyMap(especie);
  const items = [];
  for (const [produto, prop] of Object.entries(map)) {
    if (produto === 'saque' && !prop) {
      if (b.fazSaqueComplementar) items.push(labels[produto]);
      continue;
    }
    if (prop && b[prop]) items.push(labels[produto]);
  }
  return items;
}

function buildPerfis(b) {
  const itens = [];
  if (b.aceitaClienteNaoAssina) itens.push('Não assinante');
  if (b.aceitaLoas) itens.push('LOAS');
  if (b.aceitaInvalidez) itens.push('Invalidez');
  if (b.aceitaClientePensao || b.fazPensao) itens.push('Pensão');
  return itens;
}

function buildProcedimentos(b) {
  const itens = [];
  if (b.precisaVideo) itens.push('Video chamada');
  if (b.fazLigacaoCliente) itens.push('Ligacao do banco');
  if (b.clienteLigaBanco) itens.push('Cliente liga');
  if (b.precisaGravarVideo) itens.push('Gravar video');
  if (b.precisaEnviarContratoBanco) itens.push('Enviar contrato ao banco');
  return itens;
}

function primeiraFaixaPreferida(b, filtro) {
  const ordem = filtro?.especie ? [filtro.especie, 'geral', 'loas', 'invalidez', 'pensao'] : ['geral', 'loas', 'invalidez', 'pensao'];
  for (const esp of ordem) {
    const blocos = prazosPorIdade(b, esp, filtro?.idade ?? null, filtro?.prods ?? {});
    if (!blocos.length) continue;
    const linha = (blocos[0].linhas || [])[0];
    if (linha) return { especie: esp, idade: linha.idade || '-', parcelas: linha.parcelas ?? linha.prazo ?? '-', obs: linha.obs || '' };
  }
  return null;
}

function renderCard(b, filtro) {
  const operacoes = buildOperacoes(b, filtro.especie);
  const perfis = buildPerfis(b);
  const procedimentos = buildProcedimentos(b);
  const faixa = primeiraFaixaPreferida(b, filtro);

  const extras = [];
  if (b.teimosinha) extras.push(`<div><b>Teimosinha:</b> ${esc(b.teimosinha)}</div>`);
  if (b.minimoLiberado) extras.push(`<div><b>Mínimo liberado:</b> ${esc(b.minimoLiberado)}</div>`);
  if (b.tipoMinimo) extras.push(`<div><b>Tipo de mínimo:</b> ${esc(b.tipoMinimo)}</div>`);

  let contrato60 = '';
  if (b.contrato60) {
    const tags = [];
    if (b.contrato60_enviarFisico) tags.push('Enviar físico');
    if (b.contrato60_enviarEmail) tags.push('Enviar por e-mail');
    if (b.contrato60_precisaGravarVideo) tags.push('Gravar vídeo');
    contrato60 = `
      <div class="subblock">
        <div class="subttl">Contrato 60+</div>
        <div class="chips">
          ${b.contrato60_estados ? `<span class="chip ok" title="Estados">${esc(b.contrato60_estados)}</span>` : ''}
          ${tags.map(t => `<span class="chip ok">${esc(t)}</span>`).join('')}
        </div>
      </div>`;
  }

  const operacoesHtml = operacoes.length ? `
    <div class="subblock">
      <div class="subttl">Operações</div>
      <div class="chips">${operacoes.map(t => `<span class="chip ok">${esc(t)}</span>`).join(' ')}</div>
    </div>` : '';

  const perfisHtml = perfis.length ? `
    <div class="subblock">
      <div class="subttl">Perfis aceitos</div>
      <div class="chips">${perfis.map(t => `<span class="chip ok">${esc(t)}</span>`).join(' ')}</div>
    </div>` : '';

  const procedimentosHtml = procedimentos.length ? `
    <div class="subblock">
      <div class="subttl">Procedimentos</div>
      <ul class="kv">${procedimentos.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>` : '';

  const extrasHtml = (extras.length || faixa) ? `
    <div class="subblock">
      <div class="subttl">Extras</div>
      ${extras.length ? `<div class="mini-grid">${extras.join('')}</div>` : ''}
      ${faixa ? `
        <div class="mini-grid" style="margin-top:8px">
          <div><b>Faixa (Margem):</b> ${esc(faixa.especie)}</div>
          <div><b>Idade:</b> ${esc(faixa.idade)}</div>
          <div><b>Prazo:</b> ${esc(faixa.parcelas)}x</div>
          ${faixa.obs ? `<div style="grid-column:1/-1"><b>Obs.:</b> ${esc(faixa.obs)}</div>` : ''}
        </div>` : ''}
    </div>` : '';

  const body = [
    operacoesHtml,
    perfisHtml,
    procedimentosHtml,
    contrato60,
    extrasHtml
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

function lerControles(controls) {
  const idade = Number(document.querySelector(controls.idade)?.value || 0) || null;
  const especie = document.querySelector(controls.especie)?.value || 'geral';
  const assina = document.querySelector(controls.assina)?.value || 'qualquer';
  const nome = (document.querySelector(controls.nome)?.value || '').trim().toLowerCase();

  const prods = {
    margem: !!document.querySelector(controls.prods.margem)?.checked,
    cartao: !!document.querySelector(controls.prods.cartao)?.checked,
    refin: !!document.querySelector(controls.prods.refin)?.checked,
    port: !!document.querySelector(controls.prods.port)?.checked,
    saque: !!document.querySelector(controls.prods.saque)?.checked
  };

  return { idade, especie, assina, nome, prods };
}

function aplicarFiltros(db, filtro) {
  const source = Array.isArray(db) ? db.filter(b => !b.suspenso) : [];
  const base = source.filter(b => {
    if (filtro.nome && !String(b.nomeBanco || '').toLowerCase().includes(filtro.nome)) return false;
    if (!especieAssinaturaOK(b, filtro.especie, filtro.assina)) return false;
    if (!produtosOK(b, filtro.especie, filtro.prods)) return false;
    return true;
  });

  base.sort((a, b) => String(a.nomeBanco || '').localeCompare(String(b.nomeBanco || '')));
  return base;
}

function renderBasico(list, filtro, mountSel) {
  const mount = document.querySelector(mountSel);
  if (!mount) return;
  mount.classList.remove('grid-rapido');

  if (!list.length) {
    mount.innerHTML = '<div class="f-empty">Nenhum resultado. Ajuste os filtros e pesquise.</div>';
    return;
  }

  mount.innerHTML = list.map(b => renderCard(b, filtro)).join('');
}

export function runBasico(config) {
  const {
    resultsEl = '#results',
    controls = {
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
      }
    }
  } = config || {};

  const db = getDB();
  const filtro = lerControles(controls);
  const lista = aplicarFiltros(db, filtro);
  renderBasico(lista, filtro, resultsEl);
}

export function ensureBasico(config) {
  const cfg = config || {
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
      }
    }
  };

  const btn = document.querySelector(cfg.triggerBtn || '#btn-search');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    const radio = document.querySelector('input[name="modoPesquisa"][value="basico"]');
    if (!(radio && radio.checked)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    runBasico(cfg);
  }, { capture: true });
}

// fallback automático para quando a página é carregada diretamente ou via SPA
function initEnsureBasico() {
  ensureBasico();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEnsureBasico);
} else {
  initEnsureBasico();
}


