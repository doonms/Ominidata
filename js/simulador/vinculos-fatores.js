import { parseNumeroCalculo } from './calculadora-fator.js';
import { criarChaveGrupoFator, listarGruposFatores, nomeGrupoDaLinha, nomeGrupoDaTabela } from './grupos-fatores.js';

// A lista recebida deve pertencer ao mesmo banco e modalidade.
export function tabelasVinculadas(lista, tabela) {
  return tabela.grupo_fator
    ? lista.filter(item => item.grupo_fator === tabela.grupo_fator)
    : [tabela];
}

function limparGruposSolitarios(lista) {
  lista.forEach(item => {
    // Grupos nomeados guardam também a seleção da tabela e podem ter um prazo exclusivo.
    if (item.grupo_fator && !nomeGrupoDaLinha(item) && tabelasVinculadas(lista, item).length < 2) item.grupo_fator = null;
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

export function prepararInjecaoFator(tabelas, selecionadas, prazo, fator, taxa) {
  const membros = [...new Set(selecionadas)];
  if (!membros.length || membros.some(t => !tabelas.includes(t))) return { erro: 'Selecione as tabelas que receberão o fator.' };
  if (!Number.isSafeInteger(prazo) || prazo <= 0) return { erro: 'Escolha um prazo inteiro maior que zero.' };
  if (!Number.isFinite(fator) || fator <= 0) return { erro: 'Informe parcela e valor liberado maiores que zero na calculadora.' };
  if (!taxaValida(taxa)) return { erro: 'Informe uma taxa válida, maior ou igual a zero, ou deixe sem taxa.' };
  if (membros.some(t => t.prazos.filter(p => Number(p.prazo) === prazo).length > 1)) return { erro: 'Há prazos duplicados em uma tabela selecionada. Corrija antes de injetar.' };
  let grupo = null;
  if (membros.length > 1) {
    const nomes = new Set(membros.map(nomeGrupoDaTabela).filter(Boolean));
    if (nomes.size !== 1 || membros.some(t => !nomeGrupoDaTabela(t))) {
      return { erro: 'Para atualizar várias tabelas juntas, salve primeiro a seleção como um grupo de fatores.' };
    }
    const nome = [...nomes][0];
    const grupoCompleto = listarGruposFatores(tabelas).get(nome) || [];
    if (grupoCompleto.length !== membros.length || grupoCompleto.some(t => !membros.includes(t))) {
      return { erro: `Selecione o grupo completo "${nome}" antes de injetar o fator.` };
    }
    grupo = criarChaveGrupoFator(nome, prazo);
  }
  return { membros, grupo, novos: membros.filter(t => !t.prazos.some(p => Number(p.prazo) === prazo)).length };
}

export function injetarFatorTabelas(tabelas, selecionadas, prazo, fator, taxa) {
  const plano = prepararInjecaoFator(tabelas, selecionadas, prazo, fator, taxa);
  if (plano.erro) return plano;
  const grupo = plano.grupo;
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
