import { tabelasVinculadas, prepararVinculoTabelas, vincularTabelasPorPrazo, desvincularFatoresEmLote } from './vinculos-fatores.js';

export function initVinculosTabelas({ root, getBanco, salvar, renderizar, avisar }) {
  if (!root) return null;
  const selecoes = { margem: new Set(), cartao: new Set() };
  const referencias = { margem: null, cartao: null };
  function botao(texto, classe, acao, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = classe; button.textContent = texto; button.disabled = disabled;
    button.addEventListener('click', acao);
    return button;
  }
  function atualizar() {
    for (const tipo of ['margem', 'cartao']) {
      const tabelas = getBanco()?.tabelas[tipo] || [];
      const linhas = tabelas.flatMap(t => t.prazos);
      const selecao = selecoes[tipo];
      [...selecao].forEach(t => { if (!tabelas.includes(t)) selecao.delete(t); });
      if (!selecao.has(referencias[tipo])) referencias[tipo] = tabelas.find(t => selecao.has(t)) || null;
      root.querySelectorAll(`[data-tabelas-tipo="${tipo}"] > .bf-table-card`).forEach((card, indice) => {
        const check = card.querySelector('.bf-table-check');
        check.checked = selecao.has(tabelas[indice]);
        check.setAttribute('aria-label', `Selecionar tabela ${tabelas[indice].nome || indice + 1}`);
        card.classList.toggle('is-bulk-selected', check.checked);
      });
      root.querySelectorAll(`.bf-bulk-tools[data-tipo="${tipo}"]`).forEach(bar => {
        bar.hidden = bar.dataset.posicao === 'fim' && !selecao.size;
        bar.replaceChildren();
        const header = document.createElement('div');
        header.className = 'bf-bulk-heading';
        const count = document.createElement('strong');
        count.textContent = `${selecao.size} tabela${selecao.size === 1 ? '' : 's'} selecionada${selecao.size === 1 ? '' : 's'}`;
        header.append(count,
          botao('Selecionar todas', 'secondary small bf-bulk-all', () => {
            tabelas.forEach(t => selecao.add(t)); atualizar();
          }, !tabelas.length),
          botao('Limpar seleção', 'secondary small bf-bulk-clear', () => {
            selecao.clear(); atualizar();
          }, !selecao.size));
        bar.appendChild(header);
        if (!selecao.size) return;
        const actions = document.createElement('div');
        actions.className = 'bf-bulk-actions';
        const label = document.createElement('label');
        label.textContent = 'Tabela de referência — fatores por prazo';
        const select = document.createElement('select');
        select.className = 'bf-bulk-reference';
        tabelas.forEach((t, i) => {
          if (selecao.has(t)) select.add(new Option(`${t.nome || `Tabela ${i + 1}`} · ${t.prazos.length} prazos`, String(i)));
        });
        select.value = String(tabelas.indexOf(referencias[tipo]));
        select.addEventListener('change', () => {
          referencias[tipo] = tabelas[Number(select.value)];
          root.querySelectorAll(`.bf-bulk-tools[data-tipo="${tipo}"] .bf-bulk-reference`).forEach(outro => { outro.value = select.value; });
        });
        label.appendChild(select);
        actions.append(label,
          botao('Vincular selecionadas', 'primary small bf-bulk-link', () => {
            const plano = prepararVinculoTabelas(tabelas, [...selecao], referencias[tipo]);
            if (plano.erro) { avisar(plano.erro, true); return; }
            if (plano.diferentes && !confirm(`Aplicar os fatores da tabela "${referencias[tipo].nome}" nos prazos em comum das tabelas selecionadas? Nomes, taxas e demais prazos serão mantidos.`)) return;
            const resultado = vincularTabelasPorPrazo(tabelas, [...selecao], referencias[tipo]);
            if (resultado.erro) { avisar(resultado.erro, true); return; }
            salvar(); renderizar();
            avisar(`Tabelas vinculadas: ${resultado.pares.length} correspondências de prazo. Cada prazo compartilha apenas o seu fator. Taxas e nomes foram mantidos.`);
          }, selecao.size < 2),
          botao('Desvincular selecionadas', 'secondary small bf-bulk-unlink', () => {
            desvincularFatoresEmLote(linhas, [...selecao].flatMap(t => t.prazos));
            salvar(); renderizar();
            avisar('Tabelas selecionadas desvinculadas. Os fatores e taxas atuais foram mantidos.');
          }, ![...selecao].some(t => t.prazos.some(p => tabelasVinculadas(linhas, p).length > 1))));
        const info = document.createElement('p');
        info.className = 'bf-link-help';
        info.textContent = 'Somente prazos iguais são vinculados. Prazos exclusivos, nomes e taxas não mudam.';
        bar.append(actions, info);
      });
    }
  }
  function criarSelecao(tabela, tipo) {
    const label = document.createElement('label');
    label.className = 'bf-select-table';
    const check = document.createElement('input');
    check.type = 'checkbox'; check.className = 'bf-table-check';
    const span = document.createElement('span');
    span.textContent = 'Selecionar tabela';
    label.append(check, span);
    check.addEventListener('change', () => {
      if (check.checked) selecoes[tipo].add(tabela); else selecoes[tipo].delete(tabela);
      atualizar();
    });
    return label;
  }
  function limpar() { Object.values(selecoes).forEach(s => s.clear()); atualizar(); }
  return { atualizar, criarSelecao, limpar };
}
