export const BASE_CLT_KEY = 'ominidata_base_clt_v1';
export const BACKUP_CLT_KEY = 'ominidata_base_clt_antes_importacao_v1';
export const CAMPOS_NUMERICOS = {
  tempoEmpresaMeses: 'Tempo mínimo de empresa', idadeMinima: 'Idade mínima', idadeMaxima: 'Idade máxima',
  minimoFuncionarios: 'Mínimo de funcionários', tempoCnpjMeses: 'Tempo mínimo de CNPJ ativo'
};
export const OPCOES_SEGURO = {
  '': 'Não informado', nao: 'Sem seguro', opcional: 'Com seguro — opcional', obrigatorio: 'Com seguro — obrigatório'
};
export const DOCUMENTOS_CLT = ['RG', 'CPF', 'CTPS', 'OUTROS'];
export const normalizarNomeClt = nome => String(nome ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

export function novoBancoClt() {
  return { banco_id: `clt-${crypto.randomUUID()}`, nome: '', tempoEmpresaMeses: null,
    idadeMinima: null, idadeMaxima: null, minimoFuncionarios: null, tempoCnpjMeses: null,
    faixasIdade: [{ idadeMinima: null, idadeMaxima: null }], documentos: [], outrosDocumentos: '',
    seguro: '', seguroDescricao: '', observacoes: '', suspenso: false };
}

export function prepararBaseClt(arquivo, { rascunho = false } = {}) {
  // O identificador evita importar acidentalmente uma Base INSS/Outros nesta tela.
  if (!arquivo || arquivo.tipo !== 'base_clt' || arquivo.versao !== 1 || !Array.isArray(arquivo.bancos)) {
    throw new Error('Selecione um JSON exportado pela Base CLT (versão 1). As outras bases não foram alteradas.');
  }
  const nomes = new Set(), ids = new Set();
  return arquivo.bancos.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Banco ${index + 1}: cadastro inválido.`);
    const b = novoBancoClt();
    const erro = texto => { throw new Error(`Banco ${index + 1}${raw.nome ? ` (${String(raw.nome)})` : ''}: ${texto}`); };
    if (typeof raw.nome !== 'string') erro('informe o nome do banco.');
    b.nome = rascunho ? raw.nome : raw.nome.trim();
    const nome = normalizarNomeClt(b.nome);
    if (!rascunho && (!nome || nomes.has(nome))) erro(nome ? 'há outro banco com o mesmo nome.' : 'informe o nome do banco.');
    nomes.add(nome);
    b.banco_id = typeof raw.banco_id === 'string' && raw.banco_id.trim() ? raw.banco_id.trim() : b.banco_id;
    if (ids.has(b.banco_id)) erro('identificação repetida.');
    ids.add(b.banco_id);
    function numeroOpcional(value, label, idade = false) {
      if (value == null || value === '') return null;
      if (rascunho && (typeof value === 'number' || typeof value === 'string')) return value;
      if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') erro(`${label}: use um número inteiro ou deixe vazio.`);
      const numero = Number(value);
      if (!Number.isSafeInteger(numero) || numero < 0 || (idade && numero > 120)) erro(`${label}: ${idade ? 'use uma idade inteira entre 0 e 120 anos' : 'use um número inteiro válido, igual ou maior que 0'}.`);
      return numero;
    }
    for (const [campo, label] of Object.entries(CAMPOS_NUMERICOS)) {
      if (!campo.startsWith('idade')) b[campo] = numeroOpcional(raw[campo], label);
    }
    // A lista nova é a fonte principal. Só usa o par antigo quando a lista não existe.
    const faixas = Object.hasOwn(raw, 'faixasIdade') ? raw.faixasIdade
      : [{ idadeMinima: raw.idadeMinima, idadeMaxima: raw.idadeMaxima }];
    if (!Array.isArray(faixas)) erro('as faixas de idade precisam ser uma lista.');
    b.faixasIdade = faixas.map((faixa, i) => {
      if (!faixa || typeof faixa !== 'object' || Array.isArray(faixa)) erro(`faixa de idade ${i + 1} inválida.`);
      const idadeMinima = numeroOpcional(faixa.idadeMinima, `Faixa ${i + 1} — idade mínima`, true);
      const idadeMaxima = numeroOpcional(faixa.idadeMaxima, `Faixa ${i + 1} — idade máxima`, true);
      if (!rascunho && idadeMinima !== null && idadeMaxima !== null && idadeMinima > idadeMaxima) erro(`faixa ${i + 1}: a idade mínima não pode ser maior que a máxima.`);
      return { idadeMinima, idadeMaxima };
    }).filter(faixa => rascunho || faixa.idadeMinima !== null || faixa.idadeMaxima !== null);
    if (rascunho && !b.faixasIdade.length) b.faixasIdade.push({ idadeMinima: null, idadeMaxima: null });
    // Espelho da primeira faixa para arquivos v1; nunca representa as faixas seguintes.
    b.idadeMinima = b.faixasIdade[0]?.idadeMinima ?? null;
    b.idadeMaxima = b.faixasIdade[0]?.idadeMaxima ?? null;
    if (raw.documentos != null && !Array.isArray(raw.documentos)) erro('os documentos precisam ser uma lista.');
    b.documentos = [...new Set((raw.documentos || []).map(doc => {
      if (typeof doc !== 'string' || !DOCUMENTOS_CLT.includes(doc.trim().toUpperCase())) erro('documento inválido; use RG, CPF, CTPS ou OUTROS.');
      return doc.trim().toUpperCase();
    }))];
    b.outrosDocumentos = typeof raw.outrosDocumentos === 'string' ? raw.outrosDocumentos : '';
    if (!rascunho && b.documentos.includes('OUTROS') && !b.outrosDocumentos.trim()) erro('descreva os outros documentos.');
    if (!rascunho && !b.documentos.includes('OUTROS')) b.outrosDocumentos = '';
    if (!Object.hasOwn(OPCOES_SEGURO, raw.seguro ?? '')) erro('opção de seguro inválida.');
    b.seguro = raw.seguro ?? '';
    b.seguroDescricao = typeof raw.seguroDescricao === 'string' ? raw.seguroDescricao : '';
    if (!rascunho && ['opcional', 'obrigatorio'].includes(b.seguro) && !b.seguroDescricao.trim()) erro('explique como funciona o seguro.');
    if (!rascunho && !['opcional', 'obrigatorio'].includes(b.seguro)) b.seguroDescricao = '';
    b.observacoes = typeof raw.observacoes === 'string' ? raw.observacoes : '';
    b.suspenso = raw.suspenso === true;
    return b;
  });
}

export function arquivoBaseClt(bancos) {
  return { tipo: 'base_clt', versao: 1, bancos };
}
