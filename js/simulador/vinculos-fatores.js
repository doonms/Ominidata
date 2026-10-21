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

function vincularFator(lista, tabela, referencia) {
  if (tabela === referencia || !lista.includes(tabela) || !lista.includes(referencia)) return false;
  const fator = parseNumeroCalculo(referencia.fator);
  if (!(fator > 0)) return false;
  const grupo = referencia.grupo_fator || crypto.randomUUID();
  referencia.grupo_fator = grupo;
  tabela.grupo_fator = grupo;
  tabela.fator = fator;
  limparGruposSolitarios(lista);
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
    if (comuns.some(par => !(parseNumeroCalculo(par.origem.fator) > 0))) {
      return { erro: 'Preencha os fatores dos prazos correspondentes na tabela de referência.' };
    }
    pares.push(...comuns);
  }
  return { pares, diferentes: pares.some(p => parseNumeroCalculo(p.linha.fator) !== parseNumeroCalculo(p.origem.fator)) };
}

export function vincularTabelasPorPrazo(tabelas, selecionadas, referencia) {
  const plano = prepararVinculoTabelas(tabelas, selecionadas, referencia);
  if (plano.erro) return plano;
  const lista = tabelas.flatMap(t => t.prazos);
  plano.pares.forEach(({ linha, origem }) => vincularFator(lista, linha, origem));
  return plano;
}
