import { parseNumeroCalculo } from './calculadora-fator.js';

// A lista recebida deve pertencer ao mesmo banco, data e modalidade.
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

export function vincularFator(lista, tabela, referencia) {
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

export function desvincularFator(lista, tabela) {
  tabela.grupo_fator = null;
  limparGruposSolitarios(lista);
}
