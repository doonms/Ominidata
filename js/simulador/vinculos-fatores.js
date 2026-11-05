import { parseNumeroCalculo } from './calculadora-fator.js';

// A lista recebida deve pertencer ao mesmo banco e modalidade.
export function tabelasVinculadas(lista, tabela) {
  return tabela.grupo_fator
    ? lista.filter(item => item.grupo_fator === tabela.grupo_fator)
    : [tabela];
}

function limparGruposSolitarios(lista) {
  lista.forEach(item => {
    if (item.grupo_fator && tabelasVinculadas(lista, item).length < 2) item.grupo_fator = null;
  });
}

export function taxaValida(valor) {
  if (valor === '' || valor == null) return true;
  const numero = parseNumeroCalculo(valor);
  return /^\d+(?:[.,]\d*)?$/.test(String(valor).trim()) && numero !== null && numero >= 0;
}

export function atualizarTaxaVinculada(lista, tabela, valor) {
  if (!taxaValida(valor)) return false;
  tabelasVinculadas(lista, tabela).forEach(item => { item.taxa = valor ?? ''; });
  return true;
}

export function atualizarFatorVinculado(lista, tabela, valor) {
  const fator = parseNumeroCalculo(valor);
  if (!(fator > 0)) return false;
  tabelasVinculadas(lista, tabela).forEach(item => { item.fator = fator; });
  return true;
}

export function desvincularFatoresEmLote(lista, selecionadas) {
  const membros = [...new Set(selecionadas)];
  if (!membros.length || membros.some(item => !lista.includes(item))) return false;
  membros.forEach(item => { item.grupo_fator = null; });
  limparGruposSolitarios(lista);
  return true;
}

export function prepararVinculoTabelas(tabelas, selecionadas, referencia) {
  const membros = [...new Set(selecionadas)];
  if (membros.length < 2 || !membros.includes(referencia) || membros.some(t => !tabelas.includes(t))) {
    return { erro: 'Selecione pelo menos duas tabelas e uma referência.' };
  }
  const pares = [];
  for (const tabela of membros.filter(t => t !== referencia)) {
    const comuns = tabela.prazos.map(linha => ({
      linha, origem: referencia.prazos.find(item => Number(item.prazo) === Number(linha.prazo))
    })).filter(par => par.origem);
    if (!comuns.length) return { erro: `A tabela "${tabela.nome || 'Sem nome'}" não tem prazos em comum com a referência.` };
    if (comuns.some(par => !(parseNumeroCalculo(par.origem.fator) > 0) || !taxaValida(par.origem.taxa))) {
      return { erro: 'Preencha fatores válidos e confira as taxas dos prazos correspondentes na tabela de referência.' };
    }
    pares.push(...comuns);
  }
  return { pares, diferentes: pares.some(p => parseNumeroCalculo(p.linha.fator) !== parseNumeroCalculo(p.origem.fator)
    || parseNumeroCalculo(p.linha.taxa) !== parseNumeroCalculo(p.origem.taxa)) };
}

export function vincularTabelasPorPrazo(tabelas, selecionadas, referencia) {
  const plano = prepararVinculoTabelas(tabelas, selecionadas, referencia);
  if (plano.erro) return plano;
  const lista = tabelas.flatMap(t => t.prazos);
  // Cria grupos novos: uma tabela não selecionada não deve receber alterações futuras.
  const porOrigem = new Map();
  plano.pares.forEach(({ linha, origem }) => {
    if (!porOrigem.has(origem)) porOrigem.set(origem, new Set([origem]));
    porOrigem.get(origem).add(linha);
  });
  porOrigem.forEach((membros, origem) => {
    const grupo = crypto.randomUUID();
    membros.forEach(linha => {
      linha.grupo_fator = grupo;
      linha.fator = parseNumeroCalculo(origem.fator);
      linha.taxa = origem.taxa ?? '';
    });
  });
  limparGruposSolitarios(lista);
  return plano;
}

export function prepararInjecaoFator(tabelas, selecionadas, prazo, fator, taxa) {
  const membros = [...new Set(selecionadas)];
  if (!membros.length || membros.some(t => !tabelas.includes(t))) return { erro: 'Selecione as tabelas que receberão o fator.' };
  if (!Number.isSafeInteger(prazo) || prazo <= 0) return { erro: 'Escolha um prazo inteiro maior que zero.' };
  if (!Number.isFinite(fator) || fator <= 0) return { erro: 'Informe parcela e valor liberado maiores que zero na calculadora.' };
  if (!taxaValida(taxa)) return { erro: 'Informe uma taxa válida, maior ou igual a zero, ou deixe sem taxa.' };
  if (membros.some(t => t.prazos.filter(p => Number(p.prazo) === prazo).length > 1)) return { erro: 'Há prazos duplicados em uma tabela selecionada. Corrija antes de injetar.' };
  return { membros, novos: membros.filter(t => !t.prazos.some(p => Number(p.prazo) === prazo)).length };
}

export function injetarFatorTabelas(tabelas, selecionadas, prazo, fator, taxa) {
  const plano = prepararInjecaoFator(tabelas, selecionadas, prazo, fator, taxa);
  if (plano.erro) return plano;
  const grupo = plano.membros.length > 1 ? crypto.randomUUID() : null;
  plano.membros.forEach(tabela => {
    let linha = tabela.prazos.find(p => Number(p.prazo) === prazo);
    if (!linha) {
      linha = { prazo };
      tabela.prazos.push(linha);
      tabela.prazos.sort((a, b) => Number(a.prazo) - Number(b.prazo));
    }
    Object.assign(linha, { fator, taxa: taxa ?? '', grupo_fator: grupo });
  });
  limparGruposSolitarios(tabelas.flatMap(t => t.prazos));
  return plano;
}
