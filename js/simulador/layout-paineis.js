// Controla apenas a visualização; não recria campos nem altera dados da simulação.
export function initLayoutPaineis(root) {
  const layout = root.querySelector('#sim-panels-layout');
  const simulacao = root.querySelector('#sim-operacao');
  const pesquisas = [...root.querySelectorAll('.sim-search-panel')];
  const botoes = [...root.querySelectorAll('[data-sim-view]')];
  if (!layout || !simulacao || layout.dataset.inicializado) return;
  layout.dataset.inicializado = 'true';
  const ativa = () => pesquisas.find(painel => !painel.hidden);
  const observer = new MutationObserver(atualizar);
  function atualizar() {
    if (!root.isConnected) { observer.disconnect(); return; }
    const pesquisaAberta = !!ativa()?.open;
    const simulacaoAberta = simulacao.open;
    const modo = pesquisaAberta && simulacaoAberta ? 'both' : pesquisaAberta ? 'search' : simulacaoAberta ? 'simulation' : 'none';
    layout.classList.toggle('is-split', modo === 'both');
    layout.dataset.view = modo;
    botoes.forEach(botao => botao.setAttribute('aria-pressed', String(botao.dataset.simView === modo)));
  }
  botoes.forEach(botao => botao.addEventListener('click', () => {
    const pesquisa = ativa();
    if (!pesquisa) return;
    pesquisa.open = botao.dataset.simView !== 'simulation';
    simulacao.open = botao.dataset.simView !== 'search';
    atualizar();
  }));
  [...pesquisas, simulacao].forEach(painel => painel.addEventListener('toggle', atualizar));
  pesquisas.forEach(painel => observer.observe(painel, { attributes: true, attributeFilter: ['hidden'] }));
  atualizar();
}
