import { PRAZOS_PADRAO, prazoPendente } from './cadastro-tabelas-fatores.js';
import { parseNumeroCalculo, formatarFatorCalculo } from './calculadora-fator.js';
import { tabelasVinculadas, atualizarFatorVinculado, desvincularFatoresEmLote } from './vinculos-fatores.js';
import { initVinculosTabelas } from './vinculos-tabelas-lote.js';
import { normalizarPublico } from './publico-tabelas.js';

export function initEditorTabelas({ root, listas, getBanco, salvar, avisar }) {
  const listasTipo = { margem: listas.margem, cartao: listas.cartao };
  const expandidas = new WeakSet();
  const linhas = tipo => getBanco()?.tabelas[tipo].flatMap(t => t.prazos) || [];
  const lote = initVinculosTabelas({ root, getBanco, salvar, renderizar, avisar });
  const botao = (texto, classe, acao) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = classe; b.textContent = texto; b.addEventListener('click', acao);
    return b;
  };
  function adicionarTabela(tipo) {
    const banco = getBanco();
    if (!banco) { avisar('Selecione ou crie um banco antes de adicionar uma tabela.', true); return; }
    const tabela = { nome: '', prazos: [] };
    banco.tabelas[tipo].push(tabela);
    expandidas.add(tabela);
    salvar(); renderizar();
    listasTipo[tipo].lastElementChild.querySelector('.bf-table-name').focus();
  }
  function adicionarPrazo(tabela, tipo, prazo, focar = false) {
    if (!Number.isSafeInteger(prazo) || prazo <= 0) {
      avisar('Informe um prazo inteiro maior que zero.', true); return;
    }
    if (tabela.prazos.some(p => Number(p.prazo) === prazo)) {
      avisar(`O prazo ${prazo}x já existe nesta tabela.`, true); return;
    }
    tabela.prazos.push({ prazo, fator: '', taxa: '' });
    tabela.prazos.sort((a, b) => Number(a.prazo) - Number(b.prazo));
    salvar(); renderizar();
    if (focar) {
      const indice = getBanco().tabelas[tipo].indexOf(tabela);
      listasTipo[tipo].children[indice].querySelector(`[data-prazo="${prazo}"] .fator`).focus();
    }
  }
  function renderizar() {
    const banco = getBanco();
    for (const tipo of ['margem', 'cartao']) {
      const lista = listasTipo[tipo];
      lista.classList.add('bf-table-editor');
      lista.dataset.tabelasTipo = tipo;
      lista.replaceChildren();
      (banco?.tabelas[tipo] || []).forEach((tabela, indice) => lista.appendChild(renderTabela(tabela, indice, tipo)));
    }
    lote?.atualizar();
  }
  function removerPrazo(tabela, linha, tipo) {
    if ((parseNumeroCalculo(linha.fator) > 0 || linha.taxa) && !confirm(`Remover o prazo ${linha.prazo}x desta tabela?`)) return;
    desvincularFatoresEmLote(linhas(tipo), [linha]);
    tabela.prazos.splice(tabela.prazos.indexOf(linha), 1);
    salvar(); renderizar();
  }
  function renderTabela(tabela, indice, tipo) {
    const card = document.createElement('section');
    card.className = 'bf-table-card';
    const head = document.createElement('div');
    head.className = 'bf-table-heading';
    const body = document.createElement('div');
    body.className = 'bf-table-body';
    body.id = `bf-table-body-${tipo}-${indice}`;
    const label = document.createElement('label');
    label.className = 'bf-table-name-field';
    label.appendChild(document.createTextNode('Nome da tabela'));
    const input = document.createElement('input');
    input.className = 'bf-table-name'; input.type = 'text'; input.maxLength = 200;
    input.placeholder = 'Ex.: 210436 Tkt > 20k -Plus-ML'; input.value = tabela.nome;
    input.addEventListener('input', () => { tabela.nome = input.value; atualizarExpansao(); salvar(); lote?.atualizar(); });
    label.appendChild(input);
    const actions = document.createElement('div');
    actions.className = 'bf-table-actions';
    const quantidade = document.createElement('span');
    quantidade.className = 'bf-table-count';
    quantidade.textContent = `${tabela.prazos.length} prazo${tabela.prazos.length === 1 ? '' : 's'}`;
    const toggle = botao('', 'secondary small bf-table-toggle', () => {
      if (expandidas.has(tabela)) expandidas.delete(tabela);
      else expandidas.add(tabela);
      atualizarExpansao();
    });
    toggle.setAttribute('aria-controls', body.id);
    function atualizarExpansao() {
      const aberta = expandidas.has(tabela);
      body.hidden = !aberta;
      toggle.textContent = aberta ? 'Recolher' : 'Expandir';
      toggle.setAttribute('aria-expanded', String(aberta));
      toggle.setAttribute('aria-label', `${aberta ? 'Recolher' : 'Expandir'} tabela ${tabela.nome || indice + 1}`);
      card.classList.toggle('is-collapsed', !aberta);
    }
    actions.append(quantidade, toggle);
    if (lote) actions.appendChild(lote.criarSelecao(tabela, tipo));
    actions.appendChild(botao('Remover tabela', 'danger small bf-table-remove', () => {
      if (tabela.prazos.length && !confirm(`Remover a tabela "${tabela.nome || 'Sem nome'}" e seus ${tabela.prazos.length} prazos?`)) return;
      desvincularFatoresEmLote(linhas(tipo), tabela.prazos);
      getBanco().tabelas[tipo].splice(indice, 1);
      salvar(); renderizar();
    }));
    head.append(label, actions);
    const controls = document.createElement('div');
    controls.className = 'bf-term-controls';
    const title = document.createElement('strong');
    title.textContent = 'Selecionar prazos — clique novamente para remover';
    const presets = document.createElement('div');
    presets.className = 'bf-term-presets';
    PRAZOS_PADRAO.forEach(prazo => {
      const existe = tabela.prazos.some(p => Number(p.prazo) === prazo);
      const b = botao(`${existe ? '✓ ' : ''}${prazo}x`, 'bf-term-preset', () => {
        const linha = tabela.prazos.find(p => Number(p.prazo) === prazo);
        if (linha) removerPrazo(tabela, linha, tipo);
        else adicionarPrazo(tabela, tipo, prazo);
        listasTipo[tipo].children[indice].querySelector(`[data-prazo-padrao="${prazo}"]`).focus({ preventScroll: true });
      });
      b.dataset.prazoPadrao = String(prazo);
      b.setAttribute('aria-pressed', String(existe));
      b.setAttribute('aria-label', `${existe ? 'Remover' : 'Adicionar'} prazo ${prazo} meses`);
      presets.appendChild(b);
    });
    const custom = document.createElement('div');
    custom.className = 'bf-custom-term';
    const customLabel = document.createElement('label');
    customLabel.appendChild(document.createTextNode('Prazo personalizado'));
    const customInput = document.createElement('input');
    customInput.type = 'number'; customInput.min = '1'; customInput.step = '1';
    customInput.placeholder = 'Ex.: 90'; customInput.className = 'bf-custom-prazo';
    customLabel.appendChild(customInput);
    const adicionar = () => adicionarPrazo(tabela, tipo, Number(customInput.value), true);
    customInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); adicionar(); } });
    custom.append(customLabel, botao('Adicionar prazo', 'secondary small bf-custom-add', adicionar),
      botao('Adicionar todos os padrões', 'secondary small bf-all-terms', () => {
        PRAZOS_PADRAO.filter(p => !tabela.prazos.some(item => Number(item.prazo) === p))
          .forEach(prazo => tabela.prazos.push({ prazo, fator: '', taxa: '' }));
        tabela.prazos.sort((a, b) => Number(a.prazo) - Number(b.prazo));
        salvar(); renderizar();
      }));
    controls.append(title, presets, custom);
    const terms = document.createElement('div');
    terms.className = 'bf-table-terms';
    if (!tabela.prazos.length) {
      const empty = document.createElement('p');
      empty.className = 'bf-terms-empty'; empty.textContent = 'Escolha um ou mais prazos acima. Depois, preencha fator e taxa de cada prazo.';
      terms.appendChild(empty);
    }
    tabela.prazos.forEach(p => terms.appendChild(renderPrazo(tabela, p, tipo)));
    body.append(renderPublico(tabela), controls, terms);
    card.append(head, body);
    atualizarExpansao();
    return card;
  }
  function renderPublico(tabela) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'bf-table-publico';
    const legend = document.createElement('legend');
    legend.textContent = 'Público da tabela';
    const resumo = document.createElement('p');
    resumo.className = 'bf-publico-resumo';
    resumo.setAttribute('role', 'status');
    const atualizar = () => {
      const publico = normalizarPublico(tabela.publico);
      fieldset.querySelectorAll('input[data-publico-grupo]').forEach(input => {
        input.checked = publico[input.dataset.publicoGrupo] === input.dataset.publicoValor;
      });
      const condicoes = [];
      if (publico.assinatura !== 'todos') condicoes.push(publico.assinatura === 'sim' ? 'cliente que assina' : 'cliente que não assina');
      if (publico.invalidez !== 'todos') condicoes.push(publico.invalidez === 'sim' ? 'benefício por invalidez' : 'benefício sem invalidez');
      resumo.textContent = condicoes.length
        ? `Exibir somente para: ${condicoes.join(' e ')}. Vale para todos os prazos desta tabela.`
        : 'Tabela normal: aparece para todos os clientes.';
    };
    fieldset.appendChild(legend);
    for (const [grupo, titulo, opcoes] of [
      ['assinatura', 'Assinatura do cliente', [['sim', 'Assina'], ['nao', 'Não assina']]],
      ['invalidez', 'Espécie do benefício', [['sim', 'Invalidez'], ['nao', 'Sem invalidez']]]
    ]) {
      const div = document.createElement('div');
      div.className = 'bf-publico-grupo';
      div.setAttribute('role', 'group');
      div.setAttribute('aria-label', titulo);
      for (const [valor, texto] of opcoes) {
        const label = document.createElement('label');
        label.className = 'bf-publico-switch';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.setAttribute('role', 'switch');
        input.dataset.publicoGrupo = grupo; input.dataset.publicoValor = valor;
        const trilho = document.createElement('span');
        trilho.className = 'bf-publico-track'; trilho.setAttribute('aria-hidden', 'true');
        const nome = document.createElement('span');
        nome.textContent = texto;
        input.addEventListener('change', () => {
          tabela.publico = { ...normalizarPublico(tabela.publico), [grupo]: input.checked ? valor : 'todos' };
          atualizar(); salvar();
        });
        label.append(input, trilho, nome);
        div.appendChild(label);
      }
      fieldset.appendChild(div);
    }
    fieldset.appendChild(resumo);
    atualizar();
    return fieldset;
  }
  function renderPrazo(tabela, linha, tipo) {
    const row = document.createElement('div');
    row.className = 'bf-term-row'; row.dataset.prazo = String(linha.prazo);
    const prazo = document.createElement('strong');
    prazo.className = 'bf-term-value';
    if (prazoPendente(linha)) {
      row.classList.add('is-pending');
      const label = document.createElement('label');
      label.textContent = 'Prazo pendente';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.step = '1';
      input.className = 'bf-prazo-pendente'; input.placeholder = 'Meses';
      input.addEventListener('change', () => {
        const valor = Number(input.value);
        if (!Number.isSafeInteger(valor) || valor <= 0) {
          avisar('Informe um prazo inteiro maior que zero.', true); return;
        }
        if (tabela.prazos.some(p => p !== linha && Number(p.prazo) === valor)) {
          avisar(`O prazo ${valor}x já existe nesta tabela.`, true); return;
        }
        linha.prazo = valor;
        tabela.prazos.sort((a, b) => Number(a.prazo) - Number(b.prazo));
        salvar(); renderizar();
        avisar('Prazo do rascunho definido. Fator e taxa foram mantidos.');
      });
      label.appendChild(input);
      prazo.appendChild(label);
    } else prazo.textContent = `${linha.prazo}x`;
    const campos = {};
    for (const [campo, texto] of [['fator', 'Fator'], ['taxa', 'Taxa em %']]) {
      const label = document.createElement('label');
      label.appendChild(document.createTextNode(texto));
      const input = document.createElement('input');
      input.type = 'text'; input.inputMode = 'decimal'; input.className = campo;
      input.value = typeof linha[campo] === 'number'
        ? campo === 'fator' ? formatarFatorCalculo(linha[campo]) : linha[campo].toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 4 })
        : linha[campo] ?? '';
      input.placeholder = campo === 'fator' ? '0,000000' : 'Opcional';
      label.appendChild(input); campos[campo] = input;
      row.appendChild(label);
    }
    campos.fator.addEventListener('input', () => {
      const todas = linhas(tipo);
      const grupo = tabelasVinculadas(todas, linha);
      if (!atualizarFatorVinculado(todas, linha, campos.fator.value)) {
        if (grupo.length > 1) avisar('Informe um fator maior que zero. Os fatores vinculados foram mantidos.', true);
        else { linha.fator = ''; salvar(); }
        return;
      }
      listasTipo[tipo].querySelectorAll('.bf-term-row').forEach(outro => {
        const tabelaOutro = getBanco().tabelas[tipo][[...listasTipo[tipo].children].indexOf(outro.closest('.bf-table-card'))];
        const item = tabelaOutro.prazos.find(p => Number(p.prazo) === Number(outro.dataset.prazo));
        if (item !== linha && grupo.includes(item)) outro.querySelector('.fator').value = formatarFatorCalculo(linha.fator);
      });
      salvar();
      if (grupo.length > 1) avisar(`Fator de ${linha.prazo}x atualizado em ${grupo.length} tabelas vinculadas. Taxas e nomes mantidos.`);
    });
    campos.fator.addEventListener('blur', () => {
      if (tabelasVinculadas(linhas(tipo), linha).length > 1) campos.fator.value = formatarFatorCalculo(linha.fator);
    });
    campos.taxa.addEventListener('input', () => { linha.taxa = campos.taxa.value; salvar(); });
    row.prepend(prazo);
    const fim = document.createElement('div');
    fim.className = 'bf-term-actions';
    const vinculadas = tabelasVinculadas(linhas(tipo), linha);
    if (vinculadas.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'bf-term-linked'; badge.textContent = `Vinculado · ${vinculadas.length} tabelas`;
      fim.appendChild(badge);
    }
    fim.appendChild(botao('Remover prazo', 'secondary small bf-term-remove', () => removerPrazo(tabela, linha, tipo)));
    row.appendChild(fim);
    return row;
  }
  return { renderizar, adicionarTabela, limpar: () => { renderizar(); lote?.limpar(); } };
}
