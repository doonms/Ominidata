import { carregarBaseOutros, mensagemErroOutros } from '../api/baseOutrosConveniosApi.js';
import { KEY, normalize, parseRange, esc } from '../components/utilBaseOutros.js';
import { definirLogo, PRODUTOS } from './pesquisa-bancos.js';

const OPERACOES = { margem: ['fazMargem','prazos'], cartao: ['fazCartao','prazosCartao'],
  refin: ['fazRefin','prazosRefin'], port: ['fazPortabilidade','prazosPortabilidade'],
  saque: ['fazSaqueComplementar','prazosSaqueComplementar'] };
const CONTRATOS = { normal: 'Normal', celetista: 'Celetista', temporario: 'Temporário' };
const CACHE = KEY + '_consulta_publicada';
const normalizarNome = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function linhasPorIdade(lista, idade) {
  const preenchidas = (lista || []).filter(p => p && [p.idade,p.parcelas,p.obs].some(v => String(v ?? '').trim()));
  if (!preenchidas.length) return [{}]; // Sem restrição cadastrada, não inventa idade ou prazo.
  return preenchidas.filter(p => {
    if (idade === null || !String(p.idade ?? '').trim()) return true;
    const faixa = parseRange(p.idade);
    return faixa && idade >= faixa.min && idade <= faixa.max;
  });
}

function termo(prazo) {
  return String(prazo ?? '').trim().replace(/\s*x$/i,'');
}

export function pesquisarOutrosConvenios(bancos, filtros) {
  const resultados = [];
  if (!['prefeitura','governo','siape'].includes(filtros.tipo)) return resultados;
  const desejados = filtros.produtos || [];
  for (const banco of bancos) {
    if (banco.suspenso) continue;
    for (const convenio of banco.convenios || []) {
      if (convenio.tipo !== filtros.tipo || convenio.statusSuspenso) continue;
      if (filtros.nome && !normalizarNome(banco.nome + ' ' + convenio.nome).includes(normalizarNome(filtros.nome))) continue;
      const contrato = filtros.contrato || 'normal';
      if (contrato === 'celetista' && !convenio.aceitaCeletista) continue;
      if (contrato === 'temporario' && !convenio.aceitaTemporario) continue;
      const listaPerfil = contrato === 'celetista' ? convenio.prazosCeletista
        : contrato === 'temporario' ? convenio.prazosTemporario : [];
      const perfis = linhasPorIdade(listaPerfil, filtros.idade);
      if (!perfis.length) continue;
      const produtos = desejados.length ? desejados : Object.keys(OPERACOES).filter(p => convenio[OPERACOES[p][0]]);
      if (!produtos.length || produtos.some(p => !OPERACOES[p] || !convenio[OPERACOES[p][0]])) continue;
      const porProduto = produtos.map(produto => {
        const linhas = linhasPorIdade(convenio[OPERACOES[produto][1]], filtros.idade);
        const opcoes = [];
        for (const linha of linhas) for (const perfil of perfis) {
          const faixaProduto = parseRange(linha.idade), faixaPerfil = parseRange(perfil.idade);
          if (faixaProduto && faixaPerfil &&
              Math.max(faixaProduto.min,faixaPerfil.min) > Math.min(faixaProduto.max,faixaPerfil.max)) continue;
          const prazoProduto = termo(linha.parcelas), prazoPerfil = termo(perfil.parcelas);
          if (prazoProduto && prazoPerfil && prazoProduto !== prazoPerfil) continue;
          opcoes.push({ banco, convenio, produto, contrato, idade: filtros.idade,
            prazo: prazoProduto || prazoPerfil,
            observacoes: [...new Set([linha.obs,perfil.obs].map(v => String(v ?? '').trim()).filter(Boolean))].join('\n') });
        }
        return opcoes;
      });
      if (porProduto.some(linhas => !linhas.length)) continue;
      // Mantém prazo e observação correspondentes; não mistura condições de outros convênios.
      const vistos = new Set();
      for (const item of porProduto.flat()) {
        const chave = JSON.stringify([item.produto,item.prazo,item.observacoes]);
        if (!vistos.has(chave)) { vistos.add(chave); resultados.push(item); }
      }
    }
  }
  return resultados;
}

export function initPesquisaOutros({ root, aoOrigem, aoSelecionar, aoFiltrar }) {
  const el = id => root.querySelector('#' + id);
  const form = el('sim-outros-form');
  if (!form) return;
  const results = el('sim-outros-results'), status = el('sim-outros-status');
  let bancos = [], fonte = 'Consultando base_outros_convenios…', timer;
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE) || localStorage.getItem(KEY + '_publicada') || '[]');
    if (Array.isArray(cache)) bancos = cache.map(normalize);
  } catch { /* Não usa rascunhos da Base para consulta operacional. */ }
  function filtros() {
    return { tipo: el('sim-outros-tipo').value, contrato: el('sim-outros-contrato').value,
      idade: el('sim-outros-idade').value === '' ? null : Number(el('sim-outros-idade').value),
      nome: el('sim-outros-nome').value.trim(),
      produtos: [...form.querySelectorAll('[name=outrosProduto]:checked')].map(i => i.value) };
  }
  function pesquisar(invalidar = true) {
    if (!root.isConnected) return;
    if (invalidar && root.querySelector('[name=simBaseConsulta]:checked')?.value === 'outros') aoFiltrar?.();
    results.replaceChildren();
    if (!form.checkValidity()) {
      el('sim-outros-count').textContent = 'Confira a idade';
      status.textContent = 'Informe uma idade inteira entre 0 e 120 anos.'; return;
    }
    const lista = pesquisarOutrosConvenios(bancos,filtros());
    const quantidade = new Set(lista.map(item => item.banco.banco_id || item.banco.nome)).size;
    el('sim-outros-count').textContent = quantidade + ' banco(s) · ' + lista.length + ' condição(ões)';
    status.textContent = fonte + (lista.length ? ' Clique na logo para carregar banco, convênio, produto e prazo. Informe o fator manual na simulação.'
      : ' Nenhuma condição atende aos filtros. Confira o cadastro e ajuste os filtros.');
    for (const item of lista) {
      const card = document.createElement('article');
      card.className = 'sim-bank-card sim-outros-card';
      card.innerHTML = `<button type="button" class="sim-bank-option" aria-pressed="false">
        <img alt=""/><strong>${esc(item.banco.nome)}</strong>
        <span class="sim-outros-context">${esc(item.convenio.nome || 'Convênio sem nome')} · ${CONTRATOS[item.contrato]} · ${PRODUTOS[item.produto]}</span>
        <span class="sim-bank-detail"><span><span class="sim-bank-detail-label">Idade do cliente</span><span class="sim-bank-detail-value">${item.idade === null ? '—' : item.idade + ' anos'}</span></span>
        <span><span class="sim-bank-detail-label">Prazo</span><span class="sim-bank-detail-value">${item.prazo ? esc(item.prazo) + 'x' : 'Não informado'}</span></span></span>
        </button>
        <details class="sim-bank-advanced-details"><summary>Observações e condições</summary><div class="sim-bank-advanced-body"></div></details>
        <button type="button" class="sim-bank-simulate">Simular com fator manual →</button>`;
      definirLogo(card.querySelector('img'),item.banco.nome);
      const corpo = card.querySelector('.sim-bank-advanced-body');
      const adicionar = (titulo, texto) => { if (texto) {
        const p=document.createElement('p'); p.textContent=titulo + ': ' + texto; corpo.append(p);
      } };
      adicionar('Observação do prazo',item.observacoes);
      adicionar('Observações gerais',item.convenio.observacoes);
      adicionar('Documentos aceitos',[...(item.convenio.documentos || []),item.convenio.outrosDocs].filter(Boolean).join(', '));
      if (item.convenio.exigeDocumentos) adicionar('Documentos necessários',item.convenio.documentosNecessarios);
      adicionar('Margem máxima do convênio',item.convenio.margemMaximaConvenio);
      adicionar('Margem que o banco utiliza',item.convenio.margemUtilizadaBanco);
      if (!corpo.childNodes.length) adicionar('Condições','Sem observações adicionais cadastradas.');
      card.querySelector('details').addEventListener('toggle',e => card.classList.toggle('is-expanded',e.target.open));
      const selecionar = () => {
        results.querySelectorAll('.sim-bank-card').forEach(c => {
          c.classList.toggle('is-selected',c===card);
          c.querySelector('.sim-bank-option').setAttribute('aria-pressed',String(c===card));
        });
        aoSelecionar({ ...item, logo: card.querySelector('img').src });
      };
      const opcao=card.querySelector('.sim-bank-option');
      opcao.setAttribute('aria-label','Simular com ' + item.banco.nome + ', ' + item.convenio.nome + ', ' + PRODUTOS[item.produto] + ', ' + (item.prazo || 'prazo não informado'));
      opcao.addEventListener('click',selecionar);
      card.querySelector('.sim-bank-simulate').addEventListener('click',selecionar);
      results.append(card);
    }
  }
  function sincronizarOrigem(reabrir = false) {
    const outros = root.querySelector('[name=simBaseConsulta]:checked')?.value === 'outros';
    el('sim-pesquisa-bancos').hidden=outros;
    el('sim-pesquisa-outros').hidden=!outros;
    if (reabrir || outros) el(outros ? 'sim-pesquisa-outros' : 'sim-pesquisa-bancos').open=true;
    aoOrigem(outros);
    if (outros) pesquisar(false);
  }
  root.querySelectorAll('[name=simBaseConsulta]').forEach(input => {
    input.addEventListener('change',()=>sincronizarOrigem(true));
    input.addEventListener('click',()=> {
      if (input.checked) el(input.value === 'outros' ? 'sim-pesquisa-outros' : 'sim-pesquisa-bancos').open=true;
    });
  });
  form.addEventListener('submit',e=>{e.preventDefault(); clearTimeout(timer); pesquisar();});
  form.addEventListener('change',()=>{clearTimeout(timer); pesquisar();});
  form.addEventListener('input',()=>{clearTimeout(timer); timer=setTimeout(pesquisar,180);});
  form.addEventListener('reset',()=>{clearTimeout(timer); timer=setTimeout(pesquisar,0);});
  pesquisar(false);
  // O usuário ou o navegador pode ter marcado a opção antes dos módulos carregarem.
  // Registrar somente o evento change deixaria esse estado sem painel correspondente.
  sincronizarOrigem();
  carregarBaseOutros().then(lista => {
    if (!root.isConnected) return;
    bancos=lista; fonte='Base Outros Convênios consultada no Supabase.';
    try { localStorage.setItem(CACHE,JSON.stringify(lista)); } catch { /* Consulta continua sem cache. */ }
    pesquisar();
  }).catch(erro=>{
    if (!root.isConnected) return;
    fonte='Não foi possível atualizar. ' + mensagemErroOutros(erro) +
      (bancos.length ? ' Usando a última versão publicada salva neste navegador.' : '');
    pesquisar(false);
  });
}
