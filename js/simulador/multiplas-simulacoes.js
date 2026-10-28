import { parseNumeroCalculo, formatarFatorCalculo } from './calculadora-fator.js';
import { calcularCondicaoSimulacao, formatarTaxaSimulacao } from './calculo-simulacao.js';
import { definirLogo } from './pesquisa-bancos.js';

const moeda = numero => numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function initMultiplasSimulacoes({ root, getContexto }) {
  const el = id => root.querySelector(`#${id}`);
  const painel = el('sim-multiplas');
  const lista = el('sim-multi-opcoes');
  const manuais = el('sim-multi-manuais');
  const resultados = el('sim-multi-results');
  const cards = el('sim-multi-cards');
  const status = el('sim-multi-status');
  const gerar = el('sim-multi-gerar');
  let selecionadas = new Set();
  let contextoAnterior = '';
  const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function avisar(texto, erro = false) {
    status.textContent = texto;
    status.classList.toggle('is-error', erro);
  }
  function invalidar() {
    resultados.hidden = true;
    cards.replaceChildren();
    avisar('Escolha as opções e gere a comparação com o valor ou parcela informado acima.');
    contador();
  }
  function contador() {
    const ctx = getContexto();
    const quantidade = ctx.manual ? manuais.children.length : selecionadas.size;
    gerar.textContent = `Gerar ${quantidade} simulaç${quantidade === 1 ? 'ão' : 'ões'}`;
    gerar.disabled = quantidade === 0;
    el('sim-multi-selecionadas').textContent = `${quantidade} selecionada${quantidade === 1 ? '' : 's'}`;
    el('sim-multi-context-bank').textContent = ctx.nomeBanco || 'Simulação manual';
    const informado = parseNumeroCalculo(ctx.informado);
    el('sim-multi-context-entry').textContent = informado > 0
      ? `${ctx.porParcela ? 'Valor desejado' : 'Parcela / margem'}: ${moeda(informado)} · ${ctx.manual ? 'Condições manuais' : 'Tabelas cadastradas'}`
      : 'Informe o valor ou parcela acima para comparar as condições.';
  }

  function filtrar() {
    const termo = normalizar(el('sim-multi-busca').value.trim());
    const prazo = el('sim-multi-prazo').value;
    let visiveis = 0;
    lista.querySelectorAll('.sim-multi-choice').forEach(label => {
      label.hidden = !!((prazo && label.dataset.prazo !== prazo) || !normalizar(label.textContent).includes(termo));
      if (!label.hidden) visiveis++;
    });
    lista.querySelectorAll('.sim-multi-group').forEach(group => {
      group.hidden = ![...group.querySelectorAll('.sim-multi-choice')].some(label => !label.hidden);
    });
    const total = lista.querySelectorAll('.sim-multi-choice').length;
    el('sim-multi-visiveis').textContent = `${visiveis} de ${total} condições`;
    el('sim-multi-sem-busca').hidden = !total || visiveis > 0;
    el('sim-multi-todas').disabled = ![...lista.querySelectorAll('input:not(:disabled)')].some(check => !check.closest('label').hidden);
  }
  function chave(ctx, item, indice) {
    return JSON.stringify([ctx.banco, ctx.operacao, indice, item.prazo, item.plano || item.tabela || '']);
  }
  function adicionarManual() {
    const ctx = getContexto();
    const row = document.createElement('div');
    row.className = 'sim-multi-manual-row';
    const heading = document.createElement('strong');
    heading.className = 'sim-multi-manual-title';
    heading.textContent = `Condição manual ${manuais.children.length + 1}`;
    row.appendChild(heading);
    for (const [nome, rotulo, valor, placeholder] of [
      ['prazo', 'Prazo (opcional)', ctx.prazo, 'Ex.: 84'],
      ['fator', 'Fator', ctx.fator, 'Ex.: 0,0234'],
      ['plano', 'Nome da tabela (opcional)', ctx.plano, 'Ex.: Tabela especial'],
      ['taxa', 'Taxa em % (opcional)', ctx.taxa, 'Ex.: 1,70']
    ]) {
      const label = document.createElement('label');
      label.className = 'sim-field';
      const titulo = document.createElement('span');
      titulo.textContent = rotulo;
      const input = document.createElement('input');
      input.type = nome === 'prazo' ? 'number' : 'text';
      if (nome !== 'plano') input.inputMode = 'decimal';
      if (nome === 'prazo') { input.min = '1'; input.step = '1'; }
      input.autocomplete = 'off';
      input.dataset.campo = nome;
      input.value = valor || '';
      input.placeholder = placeholder;
      input.addEventListener('input', invalidar);
      label.append(titulo, input);
      row.appendChild(label);
    }
    const remover = document.createElement('button');
    remover.type = 'button';
    remover.className = 'secondary';
    remover.textContent = 'Remover opção';
    remover.addEventListener('click', () => {
      row.remove();
      [...manuais.children].forEach((item, indice) => { item.querySelector('.sim-multi-manual-title').textContent = `Condição manual ${indice + 1}`; });
      invalidar(); contador();
    });
    row.appendChild(remover);
    manuais.appendChild(row);
    invalidar();
    contador();
  }
  function atualizar() {
    const ctx = getContexto();
    const contexto = JSON.stringify([ctx.banco, ctx.operacao, ctx.manual]);
    if (contexto !== contextoAnterior) {
      el('sim-multi-busca').value = '';
      el('sim-multi-prazo').value = '';
      contextoAnterior = contexto;
    }
    invalidar();
    el('sim-multi-cadastradas').hidden = ctx.manual;
    el('sim-multi-manual').hidden = !ctx.manual;
    if (ctx.manual) {
      if (painel.open && !manuais.children.length) adicionarManual();
    } else {
      const disponiveis = new Set(), grupos = new Map();
      lista.replaceChildren();
      ctx.opcoes.forEach((item, indice) => {
        const key = chave(ctx, item, indice);
        const valido = parseNumeroCalculo(item.fator) > 0 && Number.isInteger(Number(item.prazo)) && Number(item.prazo) > 0;
        if (valido) disponiveis.add(key);
        const label = document.createElement('label');
        label.className = 'sim-multi-choice';
        label.dataset.prazo = String(item.prazo);
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.value = key;
        check.disabled = !valido;
        check.checked = valido && selecionadas.has(key);
        const texto = document.createElement('span');
        const titulo = document.createElement('strong');
        titulo.textContent = `${item.prazo}x · ${item.plano || item.tabela || `Tabela ${indice + 1}`}`;
        const detalhe = document.createElement('small');
        detalhe.textContent = valido ? `Fator ${formatarFatorCalculo(parseNumeroCalculo(item.fator))}${item.taxa != null && item.taxa !== '' ? ` · Taxa ${formatarTaxaSimulacao(item.taxa)}` : ''}` : 'Prazo ou fator inválido — corrija na Base de Fatores.';
        texto.append(titulo, detalhe);
        label.append(check, texto);
        check.addEventListener('change', () => {
          if (check.checked) selecionadas.add(key); else selecionadas.delete(key);
          invalidar();
          contador();
        });
        const grupoPrazo = String(item.prazo);
        if (!grupos.has(grupoPrazo)) {
          const grupo = document.createElement('section');
          grupo.className = 'sim-multi-group';
          const cabecalho = document.createElement('div'); cabecalho.className = 'sim-multi-group-heading';
          const tituloGrupo = document.createElement('strong'); tituloGrupo.textContent = `${item.prazo} parcelas`;
          const selecionarPrazo = document.createElement('button'); selecionarPrazo.type = 'button';
          selecionarPrazo.className = 'secondary'; selecionarPrazo.textContent = 'Selecionar este prazo';
          selecionarPrazo.setAttribute('aria-label', `Selecionar tabelas do prazo ${item.prazo}`);
          const opcoes = document.createElement('div'); opcoes.className = 'sim-multi-group-options';
          selecionarPrazo.addEventListener('click', () => {
            opcoes.querySelectorAll('input:not(:disabled)').forEach(input => {
              if (input.closest('label').hidden) return;
              input.checked = true; selecionadas.add(input.value);
            });
            invalidar(); contador();
          });
          cabecalho.append(tituloGrupo, selecionarPrazo); grupo.append(cabecalho, opcoes);
          grupos.set(grupoPrazo, opcoes); lista.appendChild(grupo);
        }
        grupos.get(grupoPrazo).appendChild(label);
      });
      selecionadas = new Set([...selecionadas].filter(key => disponiveis.has(key)));
      el('sim-multi-vazio').hidden = ctx.opcoes.length > 0;
      el('sim-multi-todas').disabled = disponiveis.size === 0;
      const filtroPrazo = el('sim-multi-prazo'), prazoAnterior = filtroPrazo.value;
      filtroPrazo.replaceChildren(new Option('Todos os prazos', ''));
      grupos.forEach((_grupo, prazo) => filtroPrazo.add(new Option(`${prazo} parcelas`, prazo)));
      filtroPrazo.value = grupos.has(prazoAnterior) ? prazoAnterior : '';
      filtrar();
    }
    contador();
  }
  function renderCard(ctx, item, calculo, indice) {
    const card = el('sim-result').cloneNode(true);
    const campo = id => card.querySelector(`#${id}`);
    card.hidden = false;
    card.classList.add('sim-multi-card');
    const identificacao = document.createElement('div');
    identificacao.className = 'sim-multi-card-condition';
    const nomeCondicao = document.createElement('strong');
    nomeCondicao.textContent = item.plano || item.tabela || 'Condição sem nome';
    const prazoCondicao = document.createElement('span');
    prazoCondicao.textContent = item.prazo ? `${item.prazo} parcelas` : 'Prazo não informado';
    identificacao.append(nomeCondicao, prazoCondicao);
    card.querySelector('.sim-result-title').after(identificacao);
    card.setAttribute('aria-label', `Simulação ${indice + 1}`);
    card.querySelector('.sim-result-title strong').textContent = `Opção ${indice + 1}`;
    campo('resBancoNome').textContent = ctx.nomeBanco || 'Simulação manual';
    const logo = campo('resLogoBanco');
    logo.closest('.resultado-logo').hidden = !ctx.nomeBanco;
    if (ctx.nomeBanco) definirLogo(logo, ctx.nomeBanco, ctx.logo);
    campo('resValor').textContent = moeda(calculo.liberado);
    campo('resParcela').textContent = moeda(calculo.prestacao);
    campo('resParcelaLabel').textContent = !ctx.manual && ctx.operacao === 'cartao' ? 'Margem do cartão' : 'Valor da parcela';
    campo('resPrazo').textContent = item.prazo ? `${item.prazo}x` : 'Não informado';
    const taxa = formatarTaxaSimulacao(item.taxa);
    const plano = String(item.plano || item.tabela || '').trim();
    campo('resTaxa').textContent = taxa;
    campo('resTaxaItem').hidden = !taxa;
    campo('resPlano').textContent = plano;
    campo('resPlanoItem').hidden = !plano;
    campo('resFator').textContent = formatarFatorCalculo(parseNumeroCalculo(item.fator));
    campo('resFatorItem').hidden = false;
    campo('resSeguroItem').hidden = !ctx.seguro;
    campo('resSeguro').textContent = ctx.seguro ? `${ctx.seguro.nome || 'Seguro'} (${moeda(calculo.custoSeguro)})` : '';
    // Os cartões reutilizam o visual individual, sem duplicar IDs no documento.
    [card, ...card.querySelectorAll('[id]')].forEach(node => {
      node.dataset.field = node.id;
      node.removeAttribute('id');
    });
    return card;
  }
  function simularVarias() {
    const ctx = getContexto();
    invalidar();
    if (!(parseNumeroCalculo(ctx.informado) > 0)) {
      avisar('Informe um valor ou parcela maior que zero em “Monte sua simulação”.', true);
      return;
    }
    const opcoes = ctx.manual ? [...manuais.children].map(row =>
      Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.campo, input.value.trim()])))
      : ctx.opcoes.filter((item, indice) => selecionadas.has(chave(ctx, item, indice)));
    if (!opcoes.length) { avisar('Selecione ou adicione pelo menos uma opção.', true); return; }
    const calculadas = [];
    for (const [indice, item] of opcoes.entries()) {
      const prazoInvalido = item.prazo !== '' && item.prazo != null && (!Number.isInteger(Number(item.prazo)) || Number(item.prazo) <= 0);
      const taxaInvalida = ctx.manual && item.taxa && (!/^\d+(?:[.,]\d+)?\s*%?$/.test(item.taxa) || !(parseNumeroCalculo(item.taxa) >= 0));
      const calculo = calcularCondicaoSimulacao({
        informado: ctx.informado, fator: item.fator, porParcela: ctx.porParcela,
        cartaoTabela: !ctx.manual && ctx.operacao === 'cartao', seguro: ctx.seguro
      });
      if (prazoInvalido || taxaInvalida || !calculo) {
        avisar(`Confira prazo, fator e taxa da opção ${indice + 1}. Nenhuma comparação foi gerada.`, true);
        return;
      }
      calculadas.push({ item, calculo });
    }
    const fragment = document.createDocumentFragment();
    calculadas.forEach(({ item, calculo }, indice) => fragment.appendChild(renderCard(ctx, item, calculo, indice)));
    cards.replaceChildren(fragment);
    el('sim-result').hidden = true;
    el('sim-multi-quantidade').textContent = `${calculadas.length} simulaç${calculadas.length === 1 ? 'ão' : 'ões'}`;
    el('sim-multi-result-context').textContent = `${ctx.nomeBanco || 'Simulação manual'} · ${ctx.porParcela ? 'Valor desejado' : 'Parcela / margem'} ${moeda(parseNumeroCalculo(ctx.informado))}${ctx.seguro ? ` · Seguro: ${ctx.seguro.nome || 'selecionado'}` : ''}`;
    resultados.hidden = false;
    avisar('Comparação gerada com o mesmo valor de entrada e o seguro selecionado, quando houver.');
  }
  painel.addEventListener('toggle', () => {
    if (painel.open && getContexto().manual && !manuais.children.length) adicionarManual();
  });
  el('sim-multi-adicionar').addEventListener('click', adicionarManual);
  el('sim-multi-todas').addEventListener('click', () => {
    lista.querySelectorAll('input:not(:disabled)').forEach(check => {
      if (check.closest('label').hidden) return;
      check.checked = true; selecionadas.add(check.value);
    });
    invalidar(); contador();
  });
  el('sim-multi-busca').addEventListener('input', filtrar);
  el('sim-multi-prazo').addEventListener('change', filtrar);
  el('sim-multi-limpar').addEventListener('click', () => {
    selecionadas.clear();
    lista.querySelectorAll('input').forEach(check => { check.checked = false; });
    invalidar(); contador();
  });
  gerar.addEventListener('click', simularVarias);
  el('sim-multi-limpar-resultados').addEventListener('click', invalidar);
  return { atualizar, invalidar };
}
