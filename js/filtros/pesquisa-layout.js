import { initModosBridge } from './modos-bridge.js';

// Somente apresentação: não altera elegibilidade nem a seleção das linhas de prazo.
export function initPesquisaLayout() {
  const root = document.querySelector('.pesquisa-wrap');
  if (!root || root.dataset.layoutInicializado) return;
  root.dataset.layoutInicializado = 'true';
  initModosBridge();
  const results = root.querySelector('#results');
  const count = root.querySelector('#pesquisa-result-count');
  const description = root.querySelector('#pesquisa-mode-description');

  function ajustarExpansores() {
    results.querySelectorAll('.r-obs').forEach(texto => {
      const card = texto.closest('.card-rapido');
      let button = card.querySelector('.pesquisa-expand');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'pesquisa-expand';
        if (button.textContent !== 'Expandir observação') button.textContent = 'Expandir observação';
        button.setAttribute('aria-expanded', 'false');
        texto.id = `pesquisa-obs-${[...results.children].indexOf(card)}`;
        button.setAttribute('aria-controls', texto.id);
        button.addEventListener('click', () => {
          const expandido = card.classList.toggle('is-expanded');
          button.setAttribute('aria-expanded', String(expandido));
          button.textContent = expandido ? 'Recolher observação' : 'Expandir observação';
        });
        texto.after(button);
      }
      const longo = texto.scrollHeight > parseFloat(getComputedStyle(texto).lineHeight) * 2 + 1;
      button.hidden = !longo;
      if (!longo) {
        card.classList.remove('is-expanded');
        button.setAttribute('aria-expanded', 'false');
        if (button.textContent !== 'Expandir observação') button.textContent = 'Expandir observação';
      }
    });
  }

  function atualizarResumo() {
    const total = results.querySelectorAll('.card-rapido, .f-card').length;
    const resumo = results.children.length ? `${total} resultado${total === 1 ? '' : 's'}` : 'Aguardando pesquisa';
    if (count.textContent !== resumo) count.textContent = resumo;
    const avancado = root.querySelector('[name="modoPesquisa"][value="avancado"]').checked;
    description.textContent = avancado
      ? 'Abra um banco para consultar procedimentos, documentos e regras detalhadas.'
      : 'Consulte o prazo e a observação correspondente ao perfil informado.';
    requestAnimationFrame(ajustarExpansores);
  }
  const observer = new MutationObserver(atualizarResumo);
  observer.observe(results, { childList: true, subtree: true });
  const resize = new ResizeObserver(() => {
    if (!root.isConnected) { observer.disconnect(); resize.disconnect(); return; }
    ajustarExpansores();
  });
  resize.observe(results);
  root.querySelector('.filtros-pane').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('input:not([type=checkbox])')) {
      event.preventDefault();
      root.querySelector('#btn-search').click();
    }
  });
  atualizarResumo();
}
