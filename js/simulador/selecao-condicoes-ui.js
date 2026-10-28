import { definirLogo } from './pesquisa-bancos.js';
import { parseNumeroCalculo, formatarFatorCalculo } from './calculadora-fator.js';
import { formatarTaxaSimulacao } from './calculo-simulacao.js';

const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Os selects originais continuam sendo a fonte da seleção e acionam o cálculo existente.
export function initSelecaoCondicoes({ root, getContexto }) {
  const el = id => root.querySelector('#' + id);
  const banco = el('slBanco'), prazo = el('slPrazo'), tabela = el('slTabela');
  const buscaBanco = el('sim-banco-busca'), buscaTabela = el('sim-tabela-busca');
  if (!buscaBanco || !buscaTabela) return { atualizar() {} };
  let contextoAnterior = '';

  function renderBancos(ctx) {
    buscaBanco.disabled = ctx.outros;
    if (ctx.outros) {
      el('sim-bank-options-count').textContent = 'Escolha pela pesquisa de convênios';
      return;
    }
    const anterior = banco.value;
    const termo = normalizar(buscaBanco.value.trim());
    const visiveis = ctx.bancos.filter(item => normalizar(item.nome).includes(termo));
    const atual = ctx.bancos.find(item => item.valor === anterior);
    const itens = atual && !visiveis.includes(atual) ? [atual, ...visiveis] : visiveis;
    banco.replaceChildren(new Option('Escolher banco', ''));
    itens.forEach(item => banco.add(new Option(item.nome, item.valor)));
    banco.value = anterior;
    banco.disabled = !itens.length;
    el('sim-bank-options-count').textContent = `${visiveis.length} banco${visiveis.length === 1 ? '' : 's'} encontrado${visiveis.length === 1 ? '' : 's'}${atual && !visiveis.includes(atual) ? ' · seleção mantida' : ''}`;
  }

  function renderTabelas(ctx) {
    const chips = el('sim-prazo-chips'), lista = el('sim-table-choices');
    chips.replaceChildren(); lista.replaceChildren();
    if (ctx.manual) return;
    [...prazo.options].filter(option => option.value).forEach(option => {
      const botao = document.createElement('button');
      botao.type = 'button'; botao.className = 'sim-term-chip';
      botao.textContent = option.textContent;
      botao.setAttribute('aria-pressed', String(option.value === prazo.value));
      botao.addEventListener('click', () => {
        prazo.value = option.value; prazo.dispatchEvent(new Event('change', { bubbles: true }));
        el('sim-prazo-chips').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
      chips.appendChild(botao);
    });
    const termo = normalizar(buscaTabela.value.trim());
    let total = 0, visiveis = 0;
    [...tabela.options].filter(option => option.value !== '').forEach(option => {
      const item = ctx.opcoes[Number(option.value)];
      if (!item) return;
      total++;
      const nome = item.plano || item.tabela || 'Tabela sem nome';
      if (!normalizar(nome).includes(termo)) return;
      visiveis++;
      const botao = document.createElement('button');
      botao.type = 'button'; botao.className = 'sim-table-choice';
      botao.setAttribute('aria-pressed', String(option.value === tabela.value));
      const titulo = document.createElement('strong'); titulo.textContent = nome;
      const meta = document.createElement('span');
      const taxa = formatarTaxaSimulacao(item.taxa);
      meta.textContent = `${item.prazo}x · Fator ${formatarFatorCalculo(parseNumeroCalculo(item.fator))}${taxa ? ` · Taxa ${taxa}` : ''}`;
      const marca = document.createElement('small'); marca.textContent = option.value === tabela.value ? '✓ Selecionada' : 'Usar esta tabela';
      botao.append(titulo, meta, marca);
      botao.addEventListener('click', () => {
        tabela.value = option.value; tabela.dispatchEvent(new Event('change', { bubbles: true }));
        el('sim-table-choices').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
      lista.appendChild(botao);
    });
    el('sim-table-options-count').textContent = `${visiveis} de ${total} tabela${total === 1 ? '' : 's'}`;
    el('sim-table-empty').hidden = visiveis > 0;
  }

  function atualizar() {
    const ctx = getContexto();
    const contexto = JSON.stringify([ctx.nomeBanco, ctx.operacao, ctx.manual, ctx.outros]);
    if (contexto !== contextoAnterior) { buscaTabela.value = ''; contextoAnterior = contexto; }
    renderBancos(ctx);
    el('sim-current-bank').textContent = ctx.nomeBanco || 'Simulação sem banco';
    const logo = el('sim-selected-bank-logo');
    if (ctx.nomeBanco) definirLogo(logo, ctx.nomeBanco, ctx.logo);
    else logo.hidden = true;
    const selecionada = ctx.opcoes[Number(tabela.value)];
    el('sim-current-condition').textContent = ctx.manual
      ? 'Fator manual · Banco opcional'
      : tabela.value !== '' && selecionada ? `${selecionada.plano || selecionada.tabela || 'Tabela sem nome'} · ${selecionada.prazo} parcelas`
        : 'Nenhuma tabela disponível para este banco e perfil';
    renderTabelas(ctx);
  }
  buscaBanco.addEventListener('input', () => renderBancos(getContexto()));
  buscaTabela.addEventListener('input', () => renderTabelas(getContexto()));
  atualizar();
  return { atualizar };
}
