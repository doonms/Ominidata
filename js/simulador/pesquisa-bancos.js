import { aplicarFiltros, prazosPorIdade } from '../filtros/rapido.js';
import { renderDetalhesBanco } from '../filtros/avancado.js';
import { getLogoSrc } from '../utils/logo.js';
import { VELOCIDADES_BANCO, normalizarVelocidadeBanco, criarSeloVelocidade } from '../utils/velocidade-banco.js';

export const PRODUTOS = {
  margem: 'Margem', cartao: 'Cartão', refin: 'Refinanciamento',
  port: 'Portabilidade', saque: 'Saque complementar'
};

export function chaveBanco(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function listaRegras(dados) {
  const lista = Array.isArray(dados) ? dados : Object.values(dados || {});
  return lista.filter(b => b && (b.nomeBanco || b.nome) && !b.fatores)
    .map(b => ({ ...b, nomeBanco: b.nomeBanco || b.nome }));
}

export function definirLogo(img, nome, arquivo = '') {
  img.hidden = false;
  img.alt = `Logo ${nome}`;
  img.onerror = () => {
    img.onerror = null;
    img.src = getLogoSrc('');
  };
  if (arquivo) {
    const caminho = String(arquivo).replace(/\\/g, '/');
    const local = /\//.test(caminho) ? caminho.replace(/^(\.\.\/|\.\/)+/, '') : `imagens/logos/${caminho}`;
    img.src = /^(https?:|data:|\/)/i.test(caminho) ? caminho : new URL(local, new URL('../../', import.meta.url)).href;
  } else {
    img.src = getLogoSrc(nome);
  }
}

// Elegibilidade compartilhada; o Avançado acrescenta os detalhes já usados na Pesquisa.
export function initPesquisaBancos({ getBancos, temTabela, aoSelecionar, aoFiltrar }) {
  const form = document.querySelector('#sim-search-form');
  const results = document.querySelector('#sim-bank-results');
  const count = document.querySelector('#sim-bank-count');
  const status = document.querySelector('#sim-search-status');
  if (!form || !results) return { atualizar() {} };
  let carregando = true;
  let timer;

  function ajustarExpansores() {
    // Não redefinir observações expandidas enquanto o painel estiver recolhido.
    if (!results.getBoundingClientRect().height) return;
    results.querySelectorAll('.sim-bank-observations').forEach(container => {
      const texto = container.querySelector('.sim-bank-observation-text');
      const toggle = container.querySelector('.sim-bank-expand');
      const precisaExpandir = texto.scrollHeight > parseFloat(getComputedStyle(texto).lineHeight) * 2 + 1;
      toggle.hidden = !precisaExpandir;
      if (!precisaExpandir) {
        container.closest('.sim-bank-card').classList.remove('is-expanded');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'Expandir';
      }
    });
  }
  const observer = new ResizeObserver(() => {
    if (!results.isConnected) { observer.disconnect(); return; }
    ajustarExpansores();
  });
  observer.observe(results);

  function lerFiltros() {
    return {
      idade: Number(form.querySelector('#sim-idade').value) || null,
      especie: form.querySelector('#sim-especie').value,
      assina: form.querySelector('#sim-assina').value,
      nome: form.querySelector('#sim-nome').value.trim().toLowerCase(),
      prods: Object.fromEntries(Object.keys(PRODUTOS).map(p => [
        p, form.querySelector(`#sim-p-${p}`).checked
      ]))
    };
  }

  function pesquisar() {
    const avancado = !!form.querySelector('#sim-modo-avancado')?.checked;
    results.classList.toggle('is-advanced', avancado);
    const filtros = lerFiltros();
    aoFiltrar?.(filtros);
    if (!form.checkValidity()) {
      results.replaceChildren();
      count.textContent = 'Confira os filtros';
      status.textContent = 'Informe uma idade válida entre 0 e 120 anos.';
      return;
    }
    const bancos = getBancos();
    const lista = aplicarFiltros(bancos, filtros);
    results.replaceChildren();
    count.textContent = `${lista.length} banco${lista.length === 1 ? '' : 's'}`;
    status.textContent = bancos.length
      ? avancado ? 'Abra as regras do banco para consultar os detalhes. Clique na logo ou em Simular para carregar a simulação.'
        : 'Clique em uma instituição para carregar suas condições no simulador.'
      : carregando ? 'Carregando as regras dos bancos…'
        : 'Nenhuma regra de banco disponível. O cálculo manual continua disponível abaixo.';

    if (bancos.length && !lista.length) {
      status.textContent = 'Nenhum banco atende aos filtros informados. Ajuste o perfil ou os produtos.';
    }

    const vistos = new Set();
    lista.forEach(banco => {
      const nome = banco.nomeBanco || banco.nome;
      const chave = chaveBanco(nome);
      if (vistos.has(chave)) return;
      vistos.add(chave);
      const blocos = prazosPorIdade(banco, filtros.especie, filtros.idade, filtros.prods);
      // Como na Pesquisa Rápida: apenas a primeira linha compatível, nunca uma soma de observações.
      const bloco = blocos[0];
      const linha = bloco?.linhas[0];
      const correspondente = { produto: bloco?.produto, parcelas: linha?.parcelas ?? linha?.prazo,
        obs: String(linha?.obs ?? '').trim(), label: bloco?.label };
      const observacaoGeral = filtros.especie === 'geral' ? String(banco.observacoes ?? '').trim() : '';
      // O texto geral é do banco, não de outro prazo/espécie. A condição selecionada
      // continua usando exclusivamente a observação da primeira linha compatível.
      const observacoesCard = [correspondente.obs,
        observacaoGeral && observacaoGeral !== correspondente.obs ? `Observações gerais: ${observacaoGeral}` : '']
        .filter(Boolean).join('\n');
      const card = document.createElement('article');
      card.className = 'sim-bank-card';
      const velocidade = normalizarVelocidadeBanco(banco.velocidadePagamento);
      if (velocidade) card.dataset.velocidade = velocidade;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sim-bank-option';
      button.setAttribute('aria-label', `Simular com ${nome}`);
      const img = document.createElement('img');
      definirLogo(img, nome, banco.logoArquivo || banco.logo);
      const title = document.createElement('strong');
      title.textContent = nome;
      const identidade = document.createElement('span');
      identidade.className = 'sim-bank-identity';
      identidade.appendChild(title);
      const selo = criarSeloVelocidade(velocidade);
      if (selo) {
        button.setAttribute('aria-description', selo.title);
      }
      const detalhe = document.createElement('span');
      detalhe.className = 'sim-bank-detail';
      for (const [label, valor] of [['Idade', filtros.idade != null ? `${filtros.idade} anos` : '—'],
        ['Prazo', correspondente.parcelas ? `${correspondente.parcelas}x` : '—']]) {
        const item = document.createElement('span');
        const titulo = document.createElement('span');
        titulo.className = 'sim-bank-detail-label';
        titulo.textContent = label;
        const conteudo = document.createElement('span');
        conteudo.className = 'sim-bank-detail-value';
        conteudo.textContent = valor;
        item.append(titulo, conteudo);
        detalhe.appendChild(item);
      }
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'sim-bank-simulate';
      action.textContent = temTabela(banco, filtros, correspondente) ? 'Usar tabela →' : 'Simular →';
      action.setAttribute('aria-label', `Carregar simulação de ${nome}`);
      button.append(img, identidade, detalhe);
      card.appendChild(button);
      if (selo) {
        const velocidadeLinha = document.createElement('div');
        velocidadeLinha.className = 'sim-bank-speed-row';
        velocidadeLinha.title = selo.title;
        selo.setAttribute('aria-hidden', 'true');
        const velocidadeTexto = document.createElement('span');
        velocidadeTexto.className = 'sim-bank-speed-text';
        velocidadeTexto.textContent = VELOCIDADES_BANCO[velocidade].nome;
        velocidadeLinha.append(selo, velocidadeTexto);
        card.appendChild(velocidadeLinha);
      }
      if (!avancado && observacoesCard) {
        const observacoes = document.createElement('div');
        observacoes.className = 'sim-bank-observations';
        observacoes.id = `sim-bank-obs-${vistos.size}`;
        button.setAttribute('aria-describedby', observacoes.id);
        const texto = document.createElement('p');
        texto.className = 'sim-bank-observation-text';
        texto.id = `${observacoes.id}-texto`;
        texto.textContent = observacoesCard;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sim-bank-expand';
        toggle.textContent = 'Expandir';
        toggle.hidden = true;
        toggle.setAttribute('aria-controls', texto.id);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', () => {
          const expandido = card.classList.toggle('is-expanded');
          toggle.setAttribute('aria-expanded', String(expandido));
          toggle.textContent = expandido ? 'Recolher' : 'Expandir';
        });
        observacoes.append(texto, toggle);
        card.appendChild(observacoes);
      }
      if (avancado) {
        const detalhes = document.createElement('details');
        detalhes.className = 'sim-bank-advanced-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Regras completas do banco';
        const body = document.createElement('div');
        body.className = 'sim-bank-advanced-body';
        body.innerHTML = renderDetalhesBanco(banco, filtros, { incluirObservacoesGerais: filtros.especie === 'geral' });
        detalhes.append(summary, body);
        card.appendChild(detalhes);
      }
      card.appendChild(action);
      const selecionar = () => {
        results.querySelectorAll('.sim-bank-option').forEach(b => {
          b.closest('.sim-bank-card').classList.toggle('is-selected', b === button);
          b.setAttribute('aria-pressed', String(b === button));
        });
        aoSelecionar(banco, filtros, blocos, correspondente);
      };
      button.addEventListener('click', selecionar);
      action.addEventListener('click', selecionar);
      button.setAttribute('aria-pressed', 'false');
      results.appendChild(card);
    });
    results.classList.toggle('has-speed', !!results.querySelector('.sim-bank-speed-row'));
    if (bancos.length) count.textContent = `${vistos.size} banco${vistos.size === 1 ? '' : 's'}`;
    requestAnimationFrame(ajustarExpansores);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    clearTimeout(timer);
    pesquisar();
  });
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(pesquisar, 180);
  });
  form.addEventListener('change', () => {
    clearTimeout(timer);
    pesquisar();
  });
  form.addEventListener('reset', () => setTimeout(pesquisar, 0));
  pesquisar();
  return {
    atualizar(pronto = true) {
      carregando = !pronto;
      pesquisar();
    }
  };
}
