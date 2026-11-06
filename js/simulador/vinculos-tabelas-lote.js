import { initInjecaoFatores } from './injecao-fatores.js';
import { criarFerramentasGrupos, listarGruposFatores, nomeGrupoDaTabela } from './grupos-fatores.js';

export function initVinculosTabelas({ root, getBanco, salvar, renderizar, avisar }) {
  if (!root) return null;
  const selecoes = { margem: new Set(), cartao: new Set() };
  const referencias = { margem: null, cartao: null };
  const gruposAtivos = { margem: '', cartao: '' };
  let bancoAnterior;
  const injecao = initInjecaoFatores({ root, salvar, renderizar, avisar,
    getSelecao: tipo => ({
      tabelas: getBanco()?.tabelas[tipo] || [],
      selecionadas: [...selecoes[tipo]], referencia: referencias[tipo]
    })
  });
  function botao(texto, classe, acao, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = classe; button.textContent = texto; button.disabled = disabled;
    button.addEventListener('click', acao);
    return button;
  }
  function atualizar() {
    if (bancoAnterior !== getBanco()) {
      bancoAnterior = getBanco();
      Object.values(selecoes).forEach(s => s.clear());
      Object.keys(referencias).forEach(t => { referencias[t] = null; });
      Object.keys(gruposAtivos).forEach(t => { gruposAtivos[t] = ''; });
      injecao?.limpar();
    }
    for (const tipo of ['margem', 'cartao']) {
      const tabelas = getBanco()?.tabelas[tipo] || [];
      const selecao = selecoes[tipo];
      if (!listarGruposFatores(tabelas).has(gruposAtivos[tipo])) gruposAtivos[tipo] = '';
      [...selecao].forEach(t => { if (!tabelas.includes(t)) selecao.delete(t); });
      if (!selecao.has(referencias[tipo])) referencias[tipo] = tabelas.find(t => selecao.has(t)) || null;
      root.querySelectorAll(`[data-tabelas-tipo="${tipo}"] > .bf-table-card`).forEach((card, indice) => {
        const check = card.querySelector('.bf-table-check');
        check.checked = selecao.has(tabelas[indice]);
        check.setAttribute('aria-label', `Selecionar tabela ${tabelas[indice].nome || indice + 1}`);
        card.classList.toggle('is-bulk-selected', check.checked);
        let badge = card.querySelector('.bf-table-group');
        if (!badge) {
          badge = document.createElement('span'); badge.className = 'bf-table-group';
          card.querySelector('.bf-table-actions').prepend(badge);
        }
        badge.textContent = nomeGrupoDaTabela(tabelas[indice]) || '';
        badge.hidden = !badge.textContent;
      });
      root.querySelectorAll(`.bf-bulk-tools[data-tipo="${tipo}"]`).forEach(bar => {
        bar.hidden = bar.dataset.posicao === 'fim' && !selecao.size;
        bar.replaceChildren();
        bar.appendChild(criarFerramentasGrupos({ tabelas, selecao, referencia: referencias[tipo], grupoAtual: gruposAtivos[tipo], avisar,
          aoEscolher: nome => { gruposAtivos[tipo] = nome; atualizar(); },
          aoSelecionar: membros => {
            selecao.clear(); membros.forEach(t => selecao.add(t));
            referencias[tipo] = membros[0] || null;
            injecao?.selecionarTipo(tipo); atualizar();
            avisar(`Grupo "${gruposAtivos[tipo]}": ${membros.length} tabela(s) selecionada(s). Use a calculadora ou edite um fator para atualizar o grupo.`);
          },
          aoSalvar: nome => { gruposAtivos[tipo] = nome; salvar(); renderizar(); }
        }));
        const header = document.createElement('div');
        header.className = 'bf-bulk-heading';
        const count = document.createElement('strong');
        count.textContent = `${selecao.size} tabela${selecao.size === 1 ? '' : 's'} selecionada${selecao.size === 1 ? '' : 's'}`;
        header.append(count,
          botao('Selecionar todas', 'secondary small bf-bulk-all', () => {
            tabelas.forEach(t => selecao.add(t)); injecao?.selecionarTipo(tipo); atualizar();
          }, !tabelas.length),
          botao('Limpar seleção', 'secondary small bf-bulk-clear', () => {
            selecao.clear(); atualizar();
          }, !selecao.size));
        bar.appendChild(header);
        if (!selecao.size) return;
        const actions = document.createElement('div');
        actions.className = 'bf-bulk-actions';
        const label = document.createElement('label');
        label.textContent = 'Tabela de referência — fator e taxa por prazo';
        const select = document.createElement('select');
        select.className = 'bf-bulk-reference';
        tabelas.forEach((t, i) => {
          if (selecao.has(t)) select.add(new Option(`${t.nome || `Tabela ${i + 1}`} · ${t.prazos.length} prazos`, String(i)));
        });
        select.value = String(tabelas.indexOf(referencias[tipo]));
        select.addEventListener('change', () => {
          referencias[tipo] = tabelas[Number(select.value)];
          root.querySelectorAll(`.bf-bulk-tools[data-tipo="${tipo}"] .bf-bulk-reference`).forEach(outro => { outro.value = select.value; });
          injecao?.atualizar();
        });
        label.appendChild(select);
        actions.append(label,
          botao('Usar na calculadora ↑', 'primary small bf-bulk-inject', () => injecao?.abrir(tipo)));
        const info = document.createElement('p');
        info.className = 'bf-link-help';
        info.textContent = 'Salve a seleção como grupo para sincronizar fatores e taxas dos prazos iguais. Depois, qualquer alteração nesses prazos será aplicada a todas as tabelas do grupo.';
        bar.append(actions, info);
      });
    }
    injecao?.atualizar();
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
      injecao?.selecionarTipo(tipo);
      atualizar();
    });
    return label;
  }
  function limpar() { Object.values(selecoes).forEach(s => s.clear()); Object.keys(referencias).forEach(t => { referencias[t] = null; gruposAtivos[t] = ''; }); injecao?.limpar(); atualizar(); }
  return { atualizar, criarSelecao, limpar, atualizarCalculo: valido => injecao?.atualizarCalculo(valido) };
}
