import { BASE_FATORES_KEY, BASE_FATORES_FALLBACKS, BASE_INSS_KEY, BASE_INSS_FALLBACKS } from '../config/storageKeys.js';
import { carregarFatoresRemotos, substituirFatoresLocais, mensagemErroFatores, CACHE_FATORES_REMOTOS } from '../api/baseFatoresApi.js';
import { carregarBaseInss } from '../api/baseInssApi.js';
import { parseNumeroCalculo, formatarFatorCalculo, formatarMoedaCalculo } from './calculadora-fator.js';
import { calcularCondicaoSimulacao, formatarTaxaSimulacao as formatarTaxa } from './calculo-simulacao.js';
import { initMultiplasSimulacoes } from './multiplas-simulacoes.js';
import { initSelecaoCondicoes } from './selecao-condicoes-ui.js';
import { chaveBanco, definirLogo, initPesquisaBancos, listaRegras, PRODUTOS } from './pesquisa-bancos.js';
import { prazosPorIdade } from '../filtros/rapido.js';
import { initCalculadoraFator } from './calculadora-fator-ui.js';
import { normalizarBaseFatores, preservarBackupFatoresDatados } from './base-fatores-modelo.js';
import { tabelaAtendePublico } from './publico-tabelas.js';
import { initPesquisaOutros } from './pesquisa-outros-convenios.js?v=20261021-origem-2';

function lerCache(chaves, converter) {
  for (const chave of chaves) {
    try {
      const dados = converter(JSON.parse(localStorage.getItem(chave) || 'null'));
      if (Object.keys(dados).length) return dados;
    } catch { /* Tenta a próxima chave compatível. */ }
  }
  return converter(null);
}

function comoFatores(dados) {
  if (!dados || Array.isArray(dados) || typeof dados !== 'object') return {};
  try { preservarBackupFatoresDatados(dados); }
  catch (error) { console.warn('A base antiga foi mantida; não foi possível salvar seu backup:', error); }
  return normalizarBaseFatores(dados);
}

async function comLimite(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo de carregamento excedido')), 8000); })
    ]);
  } finally { clearTimeout(timer); }
}

export async function initSimulador() {
  const root = document.querySelector('.sim-page');
  if (!root || root.dataset.simInicializado) return;
  root.dataset.simInicializado = 'true';
  const el = id => root.querySelector(`#${id}`);
  const banco = el('slBanco');
  const prazo = el('slPrazo');
  const tabela = el('slTabela');
  const origem = el('slOrigemFator');
  const fator = el('inpFatorManual');
  const tabelaManual = el('inpTabelaManual');
  const taxaManual = el('inpTaxaManual');
  const operacao = el('slOperacao');
  const seguro = el('slSeguro');
  const valor = el('inpValorDesejado');
  const parcela = el('inpValorMargem');
  const modoParcela = el('modoParcela');
  const modoLiberado = el('modoLiberado');
  const status = el('sim-status');
  let base = lerCache([BASE_FATORES_KEY, ...BASE_FATORES_FALLBACKS], comoFatores);
  try {
    const remotoSalvo = JSON.parse(localStorage.getItem(CACHE_FATORES_REMOTOS) || 'null');
    if (Array.isArray(remotoSalvo)) base = substituirFatoresLocais(remotoSalvo, base);
  } catch { /* Sem cache remoto válido, mantém a base local para uso offline. */ }
  let regras = lerCache([BASE_INSS_KEY, ...BASE_INSS_FALLBACKS], listaRegras);
  let bancos = [];
  let perfilSelecionado = null;
  let fatorDigitado = '';
  let multiplas;
  let selecaoCondicoes;
  let consultaOutrosAtiva = false;
  let bancoOutros = null;
  const contextosConsulta = {};
  const camposContexto = ['slBanco','slOrigemFator','slOperacao','slPrazo','slTabela','slSeguro',
    'inpFatorManual','inpPrazoManual','inpTabelaManual','inpTaxaManual','inpValorDesejado','inpValorMargem'];

  function avisar(texto, erro = false) {
    status.textContent = texto;
    status.classList.toggle('is-error', erro);
  }

  function opcoes(select, items, vazio) {
    select.replaceChildren();
    if (vazio !== undefined) select.add(new Option(vazio, ''));
    items.forEach(({ label, value }) => select.add(new Option(label, String(value))));
    select.disabled = !items.length;
  }

  function registro() { return consultaOutrosAtiva ? (banco.value === bancoOutros?.valor ? bancoOutros : null) : bancos.find(b => b.valor === banco.value); }
  function dadosBanco() { return consultaOutrosAtiva ? {} : base[registro()?.chaveFator] || {}; }
  function listaAtual(reg = registro(), tipo = operacao.value, filtros = perfilSelecionado?.filtros) {
    if (consultaOutrosAtiva) return []; // Outros Convênios usa apenas fator manual, nunca tabelas INSS.
    const dados = base[reg?.chaveFator];
    if (!dados?.fatores || !['margem', 'cartao'].includes(tipo)) return [];
    const publicoCliente = filtros || {
      assina: el('sim-assina')?.value,
      especie: el('sim-especie')?.value
    };
    let lista = (dados.fatores[tipo] || []).filter(linha => tabelaAtendePublico(linha, publicoCliente));
    const regra = reg?.regra;
    if (filtros && regra) {
      const blocos = prazosPorIdade(regra, filtros.especie, filtros.idade, { [tipo]: true });
      const linhas = blocos.flatMap(b => b.linhas);
      if (filtros.idade && !linhas.length) return [];
      const prazos = linhas.map(l => String(l.parcelas || l.prazo || '').trim());
      // Só restringe por prazo quando a regra usa um número explícito de parcelas.
      if (prazos.length && prazos.every(p => /^\d+\s*x?$/i.test(p))) {
        const permitidos = new Set(prazos.map(p => parseInt(p, 10)));
        lista = lista.filter(f => permitidos.has(parseInt(f.prazo, 10)));
      }
    }
    return lista;
  }

  function montarBancos() {
    const anterior = banco.value;
    const nomeAnterior = registro()?.nome;
    bancos = [];
    const usados = new Set();
    const nomes = Object.keys(base);
    regras.filter(r => !r.suspenso).forEach(regra => {
      const nome = regra.nomeBanco || regra.nome;
      const aliases = [nome, regra.nome, regra.banco_id].map(chaveBanco).filter(Boolean);
      const candidatos = nomes.filter(n => aliases.includes(chaveBanco(n)));
      const chaveFator = candidatos.length === 1 ? candidatos[0] : null;
      if (chaveFator) usados.add(chaveFator);
      bancos.push({ nome, regra, chaveFator, valor: chaveFator || nome });
    });
    nomes.filter(n => !usados.has(n)).forEach(nome => {
      const suspenso = regras.some(r => r.suspenso && [r.nomeBanco, r.nome, r.banco_id].map(chaveBanco).includes(chaveBanco(nome)));
      if (!suspenso) bancos.push({ nome, chaveFator: nome, valor: nome });
    });
    bancos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (consultaOutrosAtiva) {
      opcoes(banco,bancoOutros ? [{label: bancoOutros.nome + ' · ' + bancoOutros.convenio, value: bancoOutros.valor}] : [],'Escolher banco pela pesquisa');
      banco.value=bancoOutros?.valor || '';
      selecaoCondicoes?.atualizar();
      return;
    }
    opcoes(banco, bancos.map(b => ({ label: b.nome, value: b.valor })), 'Escolher banco');
    banco.value = bancos.find(b => b.valor === anterior)?.valor
      || bancos.find(b => nomeAnterior && chaveBanco(b.nome) === chaveBanco(nomeAnterior))?.valor || '';
    selecaoCondicoes?.atualizar();
  }

  function entradaTabela() {
    const lista = listaAtual();
    const indice = Number(tabela.value);
    return tabela.value !== '' && Number.isInteger(indice) && lista[indice]
      && String(lista[indice].prazo) === prazo.value ? lista[indice] : null;
  }

  function atualizarTabelas() {
    const anterior = tabela.value;
    const lista = listaAtual();
    const items = lista.map((f, indice) => ({ f, indice })).filter(({ f }) => String(f.prazo) === prazo.value);
    opcoes(tabela, items.map(({ f, indice }, ordem) => ({
      value: indice,
      label: `${f.plano || f.tabela || `Tabela ${ordem + 1}`} · ${f.fator}`
    })), items.length ? undefined : 'Nenhuma tabela disponível');
    if (items.some(i => String(i.indice) === anterior)) tabela.value = anterior;
    atualizarFator();
  }

  function atualizarPrazos() {
    const anterior = prazo.value;
    const prazos = [...new Set(listaAtual().map(f => String(f.prazo)))];
    opcoes(prazo, prazos.map(p => ({ label: `${p}x`, value: p })), prazos.length ? undefined : 'Sem prazo cadastrado');
    if (prazos.includes(anterior)) prazo.value = anterior;
    atualizarTabelas();
  }

  function atualizarFator() {
    if (origem.value === 'tabela') {
      const numero = parseNumeroCalculo(entradaTabela()?.fator);
      fator.value = numero === null ? '' : formatarFatorCalculo(numero);
    }
    selecaoCondicoes?.atualizar();
  }

  function limparResultado() {
    multiplas?.invalidar();
    el('sim-result').hidden = true;
    ['resValor', 'resPrazo', 'resParcela', 'resTaxa', 'resPlano', 'resFator'].forEach(id => { el(id).textContent = '-'; });
    el('resSeguroItem').hidden = true;
    el('resFatorItem').hidden = true;
    el('resTaxaItem').hidden = true;
    el('resPlanoItem').hidden = true;
  }

  function atualizarIdentidade() {
    const nome = registro()?.nome;
    el('resBancoNome').textContent = nome ? nome + (consultaOutrosAtiva && registro()?.convenio ? ' · ' + registro().convenio : '') : 'Simulação manual';
    if (nome) definirLogo(el('resLogoBanco'), nome, dadosBanco().logoArquivo || dadosBanco().logo || registro()?.regra?.logoArquivo || registro()?.regra?.logo);
    else el('resLogoBanco').hidden = true;
    el('resLogoBanco').closest('.resultado-logo').hidden = !nome;
  }

  function atualizarSeguros() {
    const lista = dadosBanco().seguros || [];
    opcoes(seguro, lista.map((s, i) => ({ value: i, label: s.nome || `Seguro ${i + 1}` })), 'Sem seguro');
    seguro.value = '';
    el('resSeguroItem').hidden = true;
  }

  function atualizarModo() {
    const manual = origem.value === 'manual';
    const cartaoTabela = !manual && operacao.value === 'cartao';
    if (cartaoTabela) { modoLiberado.checked = true; modoParcela.checked = false; }
    modoParcela.disabled = cartaoTabela;
    const porParcela = modoParcela.checked;
    el('grpValorDesejado').hidden = !porParcela;
    el('grpValorDesejado').style.display = porParcela ? '' : 'none';
    el('grpValorMargem').hidden = porParcela;
    el('grpValorMargem').style.display = porParcela ? 'none' : '';
    valor.disabled = !porParcela;
    parcela.disabled = porParcela;
    el('grpPrazoManual').hidden = !manual;
    el('grpTabelaCadastrada').hidden = manual;
    el('grpDetalhesManuais').hidden = !manual;
    el('sim-calculadora-fator').hidden = !manual;
    if (!manual) el('sim-calculadora-fator').open = false;
    tabelaManual.disabled = !manual;
    taxaManual.disabled = !manual;
    if (!manual) el('sim-condicoes').open = true;
    fator.readOnly = !manual;
    el('sim-fator-hint').textContent = cartaoTabela
      ? 'Cartão: utiliza a regra cadastrada de margem × fator × 70%.'
      : 'Parcela ÷ fator = valor liberado.';
    el('resParcelaLabel').textContent = cartaoTabela ? 'Margem do cartão' : 'Valor da parcela';
    atualizarFator();
    multiplas?.atualizar();
  }

  function selecionarBanco() {
    atualizarPrazos();
    atualizarSeguros();
    atualizarModo();
    limparResultado();
    atualizarIdentidade();
  }

  function simular(silencioso = false) {
    const manual = origem.value === 'manual';
    const entrada = manual ? null : entradaTabela();
    const numeroFator = parseNumeroCalculo(fator.value);
    const informado = parseNumeroCalculo(modoParcela.checked ? valor.value : parcela.value);
    if (!manual && !entrada) {
      avisar('Selecione um banco, prazo e tabela disponíveis, ou informe o fator manualmente.', !silencioso);
      return false;
    }
    if (numeroFator === null || numeroFator <= 0 || informado === null || informado <= 0) {
      const inicio = silencioso && !fator.value && !valor.value && !parcela.value;
      avisar(inicio ? 'Informe o valor e o fator ou escolha um banco na pesquisa acima.'
        : 'Informe um valor e um fator maiores que zero.', !silencioso);
      return false;
    }
    const meses = manual ? Number(el('inpPrazoManual').value) : Number(prazo.value);
    if (manual && el('inpPrazoManual').value && (!Number.isInteger(meses) || meses <= 0)) {
      avisar('Informe um prazo inteiro maior que zero, ou deixe o prazo em branco.', true);
      return false;
    }
    const taxaInformada = taxaManual.value.trim();
    const numeroTaxa = parseNumeroCalculo(taxaInformada);
    if (manual && taxaInformada && (numeroTaxa === null || numeroTaxa < 0 ||
        !/^\d+(?:[.,]\d+)?\s*%?$/.test(taxaInformada))) {
      avisar('Informe uma taxa válida em %, maior ou igual a zero, ou deixe o campo em branco.', true);
      return false;
    }
    const seg = (dadosBanco().seguros || [])[Number.parseInt(seguro.value, 10)] || null;
    const calculo = calcularCondicaoSimulacao({ informado, fator: numeroFator,
      porParcela: modoParcela.checked, cartaoTabela: !manual && operacao.value === 'cartao', seguro: seg });
    if (!calculo) {
      avisar('Confira os valores informados para realizar o cálculo.', true);
      return false;
    }
    const { liberado, prestacao, custoSeguro } = calculo;
    el('resValor').textContent = moeda(liberado);
    el('resParcela').textContent = moeda(prestacao);
    el('resPrazo').textContent = meses > 0 ? `${meses}x` : 'Não informado';
    const taxa = manual ? (taxaInformada ? formatarTaxa(numeroTaxa) : '') : formatarTaxa(entrada?.taxa);
    const nomeTabela = manual ? tabelaManual.value.trim() : String(entrada?.plano || entrada?.tabela || '').trim();
    el('resTaxa').textContent = taxa;
    el('resTaxaItem').hidden = !taxa;
    el('resPlano').textContent = nomeTabela;
    el('resPlanoItem').hidden = !nomeTabela;
    el('resFator').textContent = formatarFatorCalculo(numeroFator);
    el('resFatorItem').hidden = false;
    el('resSeguroItem').hidden = !seg;
    el('resSeguro').textContent = seg ? `${seg.nome || 'Seguro'} (${moeda(custoSeguro)})` : '';
    atualizarIdentidade();
    el('sim-result').hidden = false;
    avisar(manual ? 'Simulação calculada com o fator manual informado.' : 'Simulação calculada com a tabela selecionada.');
    return true;
  }

  banco.addEventListener('change', () => {
    if (consultaOutrosAtiva && banco.value !== bancoOutros?.valor) bancoOutros=null;
    perfilSelecionado = null; selecionarBanco(); simular(true);
  });
  prazo.addEventListener('change', () => { atualizarTabelas(); limparResultado(); simular(true); });
  tabela.addEventListener('change', () => { atualizarFator(); limparResultado(); simular(true); });
  origem.addEventListener('change', () => {
    if (origem.value === 'manual') fator.value = fatorDigitado;
    atualizarModo(); limparResultado(); simular(true);
  });
  operacao.addEventListener('change', () => {
    atualizarPrazos(); atualizarModo(); limparResultado(); simular(true);
  });
  seguro.addEventListener('change', () => { limparResultado(); simular(true); });
  [modoParcela, modoLiberado].forEach(input => input.addEventListener('change', () => {
    atualizarModo(); limparResultado(); simular(true);
  }));
  [valor, parcela, fator, el('inpPrazoManual'), tabelaManual, taxaManual].forEach(input => {
    input.addEventListener('input', () => {
      if (input === fator && origem.value === 'manual') fatorDigitado = fator.value;
      limparResultado(); simular(true);
    });
  });
  [valor, parcela].forEach(input => input.addEventListener('blur', () => {
    const numero = parseNumeroCalculo(input.value);
    if (numero !== null) {
      input.value = formatarMoedaCalculo(numero);
      limparResultado(); simular(true);
    }
  }));
  el('btnSimular').addEventListener('click', () => { multiplas?.invalidar(); simular(); });

  initCalculadoraFator({
    campos: { parcela: el('sim-calc-parcela'), fator: el('sim-calc-fator'), valor: el('sim-calc-valor') },
    status: el('sim-calc-status'),
    limpar: el('sim-calc-limpar'),
    aoAtualizar: valido => {
      el('sim-calc-usar').disabled = !valido || !['parcela', 'fator', 'valor']
        .every(nome => parseNumeroCalculo(el(`sim-calc-${nome}`).value) > 0);
    }
  });
  el('sim-calc-usar').addEventListener('click', () => {
    const calculado = parseNumeroCalculo(el('sim-calc-fator').value);
    if (origem.value !== 'manual' || !(calculado > 0) || el('sim-calc-usar').disabled) return;
    fator.value = formatarFatorCalculo(calculado);
    fator.dispatchEvent(new Event('input', { bubbles: true }));
    el('sim-calc-status').textContent = 'Fator aplicado à simulação. Os demais dados foram mantidos.';
  });

  multiplas = initMultiplasSimulacoes({
    root,
    getContexto: () => ({
      manual: origem.value === 'manual',
      informado: modoParcela.checked ? valor.value : parcela.value,
      porParcela: modoParcela.checked,
      operacao: operacao.value,
      banco: banco.value,
      nomeBanco: registro()?.nome ? registro().nome + (consultaOutrosAtiva ? ' · ' + registro().convenio : '') : '',
      logo: consultaOutrosAtiva ? bancoOutros?.logo
        : dadosBanco().logoArquivo || dadosBanco().logo || registro()?.regra?.logoArquivo || registro()?.regra?.logo,
      seguro: (dadosBanco().seguros || [])[Number.parseInt(seguro.value, 10)] || null,
      opcoes: listaAtual(),
      fator: fator.value,
      prazo: el('inpPrazoManual').value,
      plano: tabelaManual.value,
      taxa: taxaManual.value
    })
  });
  montarBancos(); selecionarBanco();
  selecaoCondicoes = initSelecaoCondicoes({ root, getContexto: () => ({
    bancos, manual: origem.value === 'manual', outros: consultaOutrosAtiva, operacao: operacao.value, opcoes: listaAtual(),
    nomeBanco: registro()?.nome || '',
    logo: consultaOutrosAtiva ? bancoOutros?.logo
      : dadosBanco().logoArquivo || dadosBanco().logo || registro()?.regra?.logoArquivo || registro()?.regra?.logo
  }) });
  let ultimoPerfil = '';
  const pesquisa = initPesquisaBancos({
    getBancos: () => regras,
    aoFiltrar: filtros => {
      if (consultaOutrosAtiva) return;
      const chave = JSON.stringify([filtros.idade, filtros.especie, filtros.assina, filtros.prods]);
      if (chave === ultimoPerfil) return;
      ultimoPerfil = chave;
      if (perfilSelecionado) perfilSelecionado = { filtros };
      atualizarPrazos(); atualizarModo(); limparResultado(); simular(true);
    },
    temTabela: (regra, filtros, correspondente) => {
      const reg = bancos.find(b => b.regra === regra || chaveBanco(b.nome) === chaveBanco(regra.nomeBanco));
      const produtos = Object.keys(PRODUTOS).filter(p => filtros.prods[p]);
      const alvo = String(correspondente?.parcelas ?? '').replace(/x$/i, '').trim();
      const tipos = correspondente?.produto ? [correspondente.produto] : produtos.length ? produtos : ['margem', 'cartao'];
      return tipos.some(tipo => listaAtual(reg, tipo, filtros).some(linha => !/^\d+$/.test(alvo) || Number(linha.prazo) === Number(alvo)));
    },
    aoSelecionar: (regra, filtros, _blocos, correspondente) => {
      if (consultaOutrosAtiva) return;
      const reg = bancos.find(b => b.regra === regra || chaveBanco(b.nome) === chaveBanco(regra.nomeBanco));
      if (!reg) return;
      perfilSelecionado = { filtros };
      banco.value = reg.valor;
      const produtos = Object.keys(PRODUTOS).filter(p => filtros.prods[p]);
      const escolhas = produtos.length ? produtos : ['margem', 'cartao'];
      const tipo = correspondente?.produto || (escolhas.includes(operacao.value) ? operacao.value : escolhas[0]);
      operacao.value = tipo;
      const alvo = String(correspondente?.parcelas ?? '').replace(/x$/i, '').trim();
      const prazoAlvo = /^\d+$/.test(alvo) ? Number(alvo) : null;
      const temFator = listaAtual(reg, tipo, filtros).some(linha => prazoAlvo === null || Number(linha.prazo) === prazoAlvo);
      origem.value = temFator ? 'tabela' : 'manual';
      if (!temFator) fator.value = fatorDigitado;
      selecionarBanco();
      if (temFator && prazoAlvo !== null) {
        prazo.value = [...prazo.options].find(opcao => Number(opcao.value) === prazoAlvo)?.value || prazo.value;
        atualizarTabelas();
      } else if (!temFator) {
        el('inpPrazoManual').value = prazoAlvo === null ? '' : String(prazoAlvo);
      }
      if (!simular(true)) avisar(temFator
        ? 'Banco e tabela carregados. Informe o valor para simular.'
        : 'Banco selecionado. Informe o fator manual desta operação para simular.');
      el('sim-operacao').open = true;
      el('sim-operacao').scrollIntoView({ behavior: 'smooth', block: 'start' });
      (temFator ? (modoParcela.checked ? valor : parcela) : fator).focus({ preventScroll: true });
    }
  });

  function trocarConsulta(outros) {
    if (consultaOutrosAtiva === outros) return;
    const antes = consultaOutrosAtiva ? 'outros' : 'inss';
    contextosConsulta[antes] = {
      valores: Object.fromEntries(camposContexto.map(id=>[id,el(id).value])),
      porParcela: modoParcela.checked, perfil: perfilSelecionado, fatorDigitado
    };
    consultaOutrosAtiva=outros;
    const salvo=contextosConsulta[outros ? 'outros' : 'inss'];
    perfilSelecionado=outros ? null : salvo?.perfil || null;
    origem.querySelector('[value=tabela]').disabled=outros;
    el('sim-base-status').hidden=outros;
    root.querySelector('.sim-hero-copy h1').textContent=outros ? 'Simulador — Outros Convênios' : 'Simulador INSS';
    montarBancos();
    const valores=salvo?.valores || {};
    for (const id of camposContexto) {
      if (['slPrazo','slTabela','slSeguro','slBanco'].includes(id)) continue;
      el(id).value=valores[id] ?? (id==='slOrigemFator' ? 'manual' : id==='slOperacao' ? 'margem' : '');
    }
    banco.value=valores.slBanco || '';
    if (outros) origem.value='manual';
    modoParcela.checked=!!salvo?.porParcela;
    modoLiberado.checked=!modoParcela.checked;
    fatorDigitado=salvo?.fatorDigitado || '';
    selecionarBanco();
    if ([...prazo.options].some(o=>o.value===valores.slPrazo)) {
      prazo.value=valores.slPrazo; atualizarTabelas();
    }
    if ([...tabela.options].some(o=>o.value===valores.slTabela)) {
      tabela.value=valores.slTabela; atualizarFator();
    }
    if ([...seguro.options].some(o=>o.value===valores.slSeguro)) seguro.value=valores.slSeguro;
    if (!outros) pesquisa.atualizar();
    simular(true);
    if (outros && !bancoOutros) avisar('Pesquise um convênio e informe o fator manual. Esta consulta não usa tabelas nem seguros do INSS.');
  }
  initPesquisaOutros({
    root, aoOrigem: trocarConsulta,
    aoFiltrar: () => {
      if (!bancoOutros) return;
      bancoOutros=null;
      fator.value=''; fatorDigitado=''; el('inpPrazoManual').value='';
      tabelaManual.value=''; taxaManual.value='';
      montarBancos(); limparResultado();
      avisar('Filtros alterados. Escolha novamente uma condição de Outros Convênios.');
    },
    aoSelecionar: item => {
      if (!consultaOutrosAtiva) return;
      bancoOutros={nome:item.banco.nome, convenio:item.convenio.nome || 'Convênio sem nome', logo:item.logo,
        valor:'outros:' + (item.banco.banco_id || item.banco.nome) + ':' + item.convenio.id};
      perfilSelecionado=null;
      montarBancos();
      operacao.value=item.produto;
      origem.value='manual';
      fator.value=''; fatorDigitado='';
      tabelaManual.value=''; taxaManual.value='';
      el('inpPrazoManual').value=/^\d+$/.test(item.prazo) ? item.prazo : '';
      selecionarBanco();
      avisar('Banco e convênio carregados. Informe o fator manual desta condição para simular; fatores e seguros do INSS não são utilizados.');
      el('sim-operacao').open=true;
      el('sim-operacao').scrollIntoView({behavior:'smooth',block:'start'});
      fator.focus({preventScroll:true});
    }
  });

  // As entradas ficam disponíveis enquanto as duas bases são atualizadas.
  const [fatoresRemotos, regrasRemotas] = await Promise.allSettled([
    comLimite(carregarFatoresRemotos()),
    comLimite(carregarBaseInss({ useFallback: false }))
  ]);
  if (!root.isConnected) return;
  const fonte = el('sim-base-status');
  if (fatoresRemotos.status === 'fulfilled') {
    base = substituirFatoresLocais(fatoresRemotos.value, base);
    try {
      // Cache remoto separado: visitar o simulador nunca apaga rascunhos do editor.
      localStorage.setItem(CACHE_FATORES_REMOTOS, JSON.stringify(fatoresRemotos.value));
    }
    catch (error) { console.warn('Não foi possível atualizar o cache dos fatores:', error); }
    if (fonte) fonte.textContent = fatoresRemotos.value.length
      ? 'Fatores consultados no Supabase. Tabelas removidas não são recuperadas do navegador.'
      : 'O Supabase não retornou fatores publicados. O cálculo manual continua disponível; rascunhos locais não foram alterados.';
  } else if (fonte) {
    const detalhe = fatoresRemotos.status === 'rejected'
      ? mensagemErroFatores(fatoresRemotos.reason)
      : 'O Supabase não retornou fatores visíveis para esta sessão. Confira o envio e as permissões de leitura.';
    fonte.textContent = `${Object.keys(base).length ? 'Usando fatores salvos neste navegador.' : 'Sem fatores cadastrados disponíveis; o cálculo manual continua disponível.'} ${detalhe}`;
  }
  if (regrasRemotas.status === 'fulfilled') {
    const lista = listaRegras(regrasRemotas.value);
    regras = lista; // Resposta remota vazia também remove regras antigas do cache.
  } else if (fonte) {
    fonte.textContent += ' Não foi possível atualizar as regras dos bancos; a pesquisa usa as regras locais disponíveis.';
  }
  const seguroAnterior = seguro.value;
  montarBancos();
  selecionarBanco();
  if ([...seguro.options].some(option => option.value === seguroAnterior)) seguro.value = seguroAnterior;
  simular(true);
  pesquisa.atualizar();
}

function moeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
