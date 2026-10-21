const VALORES = ['todos', 'sim', 'nao'];
const GRUPOS = ['assinatura', 'invalidez'];

export function normalizarPublico(publico = {}, estrito = false) {
  if (publico == null) publico = {};
  if (typeof publico !== 'object' || Array.isArray(publico) ||
      (estrito && Object.keys(publico).some(chave => !GRUPOS.includes(chave)))) {
    if (estrito) throw new Error('Público da tabela inválido. Confira assinatura e invalidez.');
    return { assinatura: 'todos', invalidez: 'todos' };
  }
  return Object.fromEntries(GRUPOS.map(grupo => {
    const valor = publico[grupo] ?? 'todos';
    if (estrito && !VALORES.includes(valor)) throw new Error(`Público da tabela inválido em ${grupo}.`);
    return [grupo, VALORES.includes(valor) ? valor : 'todos'];
  }));
}

export function publicoDaLinha(linha = {}, estrito = false) {
  return normalizarPublico({
    assinatura: linha.publico_assinatura ?? linha.publico?.assinatura,
    invalidez: linha.publico_invalidez ?? linha.publico?.invalidez
  }, estrito);
}

// Restrições de grupos diferentes se somam; tabela normal não depende do perfil.
export function tabelaAtendePublico(linha, filtros = {}) {
  let publico;
  try { publico = publicoDaLinha(linha, true); }
  catch { return false; }
  const assina = ['sim', 'nao'].includes(filtros?.assina) ? filtros.assina : null;
  const invalidez = filtros?.especie === 'invalidez' ? 'sim'
    : ['geral', 'loas', 'pensao'].includes(filtros?.especie) ? 'nao' : null;
  return (publico.assinatura === 'todos' || publico.assinatura === assina) &&
    (publico.invalidez === 'todos' || publico.invalidez === invalidez);
}
