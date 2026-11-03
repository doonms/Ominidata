import { carregarEstadoClt, lerCacheCltPublicado, salvarCacheCltPublicado, mensagemErroClt } from '../api/baseCltApi.js';
import { normalizarNomeClt, OPCOES_SEGURO } from '../clt/modelo.js';
import { definirLogo } from './pesquisa-bancos.js';

const inteiro = v => Number.isSafeInteger(v) && v >= 0;
export function pesquisarClt(bancos, f) {
  if (!inteiro(f.tempoEmpresaMeses) || (f.idade !== null && (!inteiro(f.idade) || f.idade > 120)) ||
      [f.funcionarios, f.tempoCnpjMeses].some(v => v !== null && !inteiro(v))) return [];
  const resultados = [];
  for (const b of bancos) {
    // Tempo de empresa é obrigatório na consulta. Requisito desconhecido não vira zero.
    if (b.suspenso || !inteiro(b.tempoEmpresaMeses) || f.tempoEmpresaMeses < b.tempoEmpresaMeses ||
        (f.nome && !normalizarNomeClt(b.nome).includes(normalizarNomeClt(f.nome)))) continue;
    const pendencias = [];
    const faixas = b.faixasIdade.filter(p => p.idadeMinima !== null || p.idadeMaxima !== null);
    if (f.idade !== null && faixas.length && !faixas.some(p => f.idade >= (p.idadeMinima ?? 0) && f.idade <= (p.idadeMaxima ?? 120))) continue;
    if (!faixas.length) pendencias.push('O banco não informou a faixa de idade.');
    else if (f.idade === null) pendencias.push('Informe a idade do cliente para conferir a faixa.');
    let atende = true;
    for (const [chave, informado, label] of [['minimoFuncionarios', f.funcionarios, 'funcionários'], ['tempoCnpjMeses', f.tempoCnpjMeses, 'tempo de CNPJ ativo']]) {
      const minimo = b[chave];
      if (minimo === null) pendencias.push(`O banco não informou o requisito de ${label}.`);
      else if (informado === null && minimo > 0) pendencias.push(`Informe ${label} da empresa para conferir o requisito.`);
      else if (informado !== null && informado < minimo) atende = false;
    }
    if (atende) resultados.push({ banco: b, pendencias });
  }
  return resultados.sort((a,b) => a.banco.tempoEmpresaMeses - b.banco.tempoEmpresaMeses || a.banco.nome.localeCompare(b.banco.nome, 'pt-BR'));
}

export function initPesquisaClt({ root, aoSelecionar, aoFiltrar }) {
  const el = id => root.querySelector('#' + id);
  const form = el('sim-clt-form');
  if (!form) return;
  const results = el('sim-clt-results'), status = el('sim-clt-status');
  let bancos = lerCacheCltPublicado() || [];
  let fonte = bancos.length ? 'Usando a última versão publicada salva; atualizando do Supabase…' : 'Consultando a Base CLT publicada…';
  let timer;
  const valor = id => el(id).value === '' ? null : Number(el(id).value);
  function pesquisar(invalidar = true) {
    if (!root.isConnected) return;
    if (invalidar) aoFiltrar?.();
    results.replaceChildren();
    if (el('sim-clt-tempo-empresa').value === '') {
      el('sim-clt-count').textContent = 'Informe o tempo de empresa';
      status.textContent = fonte + ' Preencha o tempo de empresa em meses para encontrar os bancos.'; return;
    }
    if (!form.checkValidity()) {
      el('sim-clt-count').textContent = 'Confira os filtros';
      status.textContent = 'Use números inteiros não negativos; a idade deve estar entre 0 e 120 anos.'; return;
    }
    const f = { tempoEmpresaMeses: valor('sim-clt-tempo-empresa'), idade: valor('sim-clt-idade'),
      funcionarios: valor('sim-clt-funcionarios'), tempoCnpjMeses: valor('sim-clt-tempo-cnpj'), nome: el('sim-clt-nome').value.trim() };
    const lista = pesquisarClt(bancos, f);
    el('sim-clt-count').textContent = `${lista.length} banco(s)`;
    status.textContent = fonte + (lista.length ? ' Bancos compatíveis com o tempo de empresa e os filtros preenchidos. Confira eventuais pendências nos detalhes.'
      : ' Nenhum banco atende aos filtros. Bancos sem tempo mínimo de empresa cadastrado não são apresentados como compatíveis.');
    for (const item of lista) {
      const b = item.banco;
      const card = document.createElement('article'); card.className = 'sim-bank-card sim-clt-card';
      card.innerHTML = `<button type="button" class="sim-bank-option" aria-pressed="false"><img alt=""><strong></strong>
        <span class="sim-bank-detail"><span><span class="sim-bank-detail-label">Tempo de empresa</span><span class="sim-bank-detail-value clt-cliente-tempo"></span></span><span><span class="sim-bank-detail-label">Mínimo do banco</span><span class="sim-bank-detail-value clt-banco-tempo"></span></span></span>
        <span class="sim-clt-perfil"></span></button>
        <p class="sim-clt-pendencia"></p>
        <details class="sim-bank-advanced-details"><summary>Requisitos, documentos e seguro</summary><div class="sim-bank-advanced-body"></div></details>
        <button type="button" class="sim-bank-simulate">Simular com fator manual →</button>`;
      definirLogo(card.querySelector('img'), b.nome);
      const opcao = card.querySelector('.sim-bank-option');
      opcao.setAttribute('aria-label', 'Simular CLT com ' + b.nome);
      card.querySelector('strong').textContent = b.nome;
      card.querySelector('.clt-cliente-tempo').textContent = `${f.tempoEmpresaMeses} meses`;
      card.querySelector('.clt-banco-tempo').textContent = `${b.tempoEmpresaMeses} meses`;
      card.querySelector('.sim-clt-perfil').textContent = f.idade === null ? 'Idade do cliente não informada' : `Idade do cliente: ${f.idade} anos`;
      card.querySelector('.sim-clt-pendencia').textContent = item.pendencias.length ? 'Há requisitos adicionais a conferir' : 'Filtros preenchidos atendidos';
      const body = card.querySelector('.sim-bank-advanced-body');
      const adicionar = (titulo, texto) => { const p = document.createElement('p'); p.textContent = `${titulo}: ${texto}`; body.appendChild(p); };
      adicionar('Tempo mínimo de empresa', `${b.tempoEmpresaMeses} meses`);
      adicionar('Faixas de idade', b.faixasIdade.length ? b.faixasIdade.map(p => `${p.idadeMinima ?? 'sem mínimo'} a ${p.idadeMaxima ?? 'sem máximo'} anos`).join('; ') : 'Não informadas');
      adicionar('Mínimo de funcionários', b.minimoFuncionarios ?? 'Não informado');
      adicionar('Tempo mínimo de CNPJ ativo', b.tempoCnpjMeses === null ? 'Não informado' : `${b.tempoCnpjMeses} meses`);
      adicionar('Documentos', b.documentos.filter(d => d !== 'OUTROS').concat(b.documentos.includes('OUTROS') ? [b.outrosDocumentos] : []).join(', ') || 'Não informados');
      adicionar('Seguro', OPCOES_SEGURO[b.seguro]);
      if (['opcional', 'obrigatorio'].includes(b.seguro)) adicionar('Como funciona o seguro', b.seguroDescricao);
      if (b.observacoes) adicionar('Observações', b.observacoes);
      item.pendencias.forEach(p => adicionar('A conferir', p));
      card.querySelector('details').addEventListener('toggle', event => card.classList.toggle('is-expanded', event.target.open));
      const selecionar = () => {
        results.querySelectorAll('.sim-bank-card').forEach(c => { c.classList.toggle('is-selected', c === card); c.querySelector('.sim-bank-option').setAttribute('aria-pressed', String(c === card)); });
        aoSelecionar({ ...item, logo: card.querySelector('img').src });
      };
      opcao.onclick = selecionar; card.querySelector('.sim-bank-simulate').onclick = selecionar;
      results.appendChild(card);
    }
  }
  form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); pesquisar(); });
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(pesquisar, 180); });
  form.addEventListener('change', () => { clearTimeout(timer); pesquisar(); });
  form.addEventListener('reset', () => { clearTimeout(timer); timer = setTimeout(pesquisar, 0); });
  pesquisar(false);
  carregarEstadoClt().then(estado => {
    if (!root.isConnected) return;
    bancos = estado.bancos; salvarCacheCltPublicado(bancos);
    fonte = 'Base CLT consultada no Supabase.'; pesquisar();
  }).catch(error => {
    if (!root.isConnected) return;
    fonte = 'Não foi possível atualizar a Base CLT. ' + mensagemErroClt(error) + (bancos.length ? ' Usando a última versão publicada salva; os dados podem estar desatualizados.' : '');
    pesquisar(false);
  });
}
