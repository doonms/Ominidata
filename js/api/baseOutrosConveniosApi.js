import { supabase } from '../supa/supabaseClient.js';
import { normalize, FAIXAS_CONVENIO } from '../components/utilBaseOutros.js';

const TABELA = 'base_outros_convenios';
const COLUNAS = 'banco_id,nome,suspenso,dados';
const PAGINA = 500;
const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const nomeChave = nome => String(nome ?? '').trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

function validarBanco(raw) {
  if (!objeto(raw) || typeof raw.nome !== 'string' || !raw.nome.trim()) {
    throw new Error('Todo banco precisa ter um nome. Corrija o cadastro ou use um JSON exportado desta página.');
  }
  if (raw.banco_id != null && (typeof raw.banco_id !== 'string' || !raw.banco_id.trim())) {
    throw new Error('Identificação de banco inválida no JSON.');
  }
  if (raw.convenios !== undefined && (!Array.isArray(raw.convenios) || raw.convenios.some(c => !objeto(c)))) {
    throw new Error('A lista de convênios está inválida em ' + raw.nome + '.');
  }
  const ids = new Set();
  let padroes = 0;
  for (const conv of raw.convenios || [raw]) {
    if (conv.tipo != null && !['padrao_banco','prefeitura','governo','siape'].includes(conv.tipo)) {
      throw new Error('Tipo de convênio inválido em ' + raw.nome + '.');
    }
    if (conv.tipo === 'padrao_banco' && ++padroes > 1) throw new Error('Há mais de um Padrão banco em ' + raw.nome + '.');
    if (conv.id != null) {
      if (typeof conv.id !== 'string' || !conv.id || conv.id.includes(':') || ids.has(conv.id)) {
        throw new Error('Convênios com identificação inválida ou repetida em ' + raw.nome + '.');
      }
      ids.add(conv.id);
    }
    for (const { prazos } of FAIXAS_CONVENIO) {
      if (conv[prazos] !== undefined && (!Array.isArray(conv[prazos]) || conv[prazos].some(p => !objeto(p)))) {
        throw new Error('Faixas de idade/prazos inválidos em ' + raw.nome + '.');
      }
    }
  }
  return normalize({ ...raw, nome: raw.nome.trim(), suspenso: raw.suspenso ?? raw.status_suspenso ?? false });
}

export function prepararBaseOutros(json) {
  const lista = Array.isArray(json) ? json : objeto(json)
    ? Object.entries(json).map(([nome, dados]) => {
      if (!objeto(dados)) throw new Error('Formato de banco inválido no JSON.');
      return { ...dados, nome: dados.nome || nome };
    }) : null;
  if (!lista?.length) throw new Error('A base está vazia ou o JSON é inválido. Nenhum envio foi iniciado.');
  const bancos = lista.map(validarBanco);
  const nomes = new Set(), ids = new Set();
  for (const banco of bancos) {
    const nome = nomeChave(banco.nome);
    if (nomes.has(nome) || (banco.banco_id && ids.has(banco.banco_id))) {
      throw new Error('Banco repetido no arquivo: ' + banco.nome + '. Corrija antes de enviar.');
    }
    nomes.add(nome);
    if (banco.banco_id) ids.add(banco.banco_id);
  }
  return bancos;
}

function lerLinhas(rows) {
  return rows.map(row => {
    if (!objeto(row) || typeof row.banco_id !== 'string' || !row.banco_id.trim() || !objeto(row.dados)) {
      throw new Error('O Supabase retornou um banco inválido. A base local foi preservada.');
    }
    return validarBanco({ ...row.dados, banco_id: row.banco_id,
      nome: row.nome ?? row.dados.nome, suspenso: row.suspenso ?? row.dados.suspenso });
  });
}

export async function carregarBaseOutros() {
  const rows = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase.from(TABELA).select(COLUNAS)
      .order('banco_id').range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao consultar a Base Outros Convênios.');
    rows.push(...data);
    if (data.length < PAGINA) break;
  }
  if (!rows.length) return [];
  return prepararBaseOutros(lerLinhas(rows));
}

function mesmoBanco(a, b) {
  return a.banco_id && b.banco_id ? a.banco_id === b.banco_id : nomeChave(a.nome) === nomeChave(b.nome);
}

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  return objeto(valor) ? Object.fromEntries(Object.keys(valor).sort().map(k => [k, ordenar(valor[k])])) : valor;
}

function conteudo(banco) {
  const { banco_id, outrosCollapsed, ...dados } = banco;
  return JSON.stringify(ordenar(dados));
}

// O remoto atualiza o cache limpo. Rascunhos locais nunca são descartados automaticamente.
export function mesclarBaseOutros(local, remoto, anterior = [], priorizarRemoto = false) {
  const resultado = local.slice();
  let preservados = 0;
  for (const banco of remoto) {
    const i = resultado.findIndex(item => mesmoBanco(item, banco));
    if (i < 0) { resultado.push(banco); continue; }
    const atual = resultado[i];
    const ultimo = anterior.find(item => mesmoBanco(item, atual));
    if (priorizarRemoto || conteudo(atual) === conteudo(banco) || (ultimo && conteudo(atual) === conteudo(ultimo))) {
      resultado[i] = { ...banco, outrosCollapsed: atual.outrosCollapsed };
    } else {
      resultado[i] = { ...atual, banco_id: banco.banco_id };
      preservados++;
    }
  }
  return { bancos: resultado, preservados };
}

export async function enviarBaseOutros(json) {
  const bancos = prepararBaseOutros(json); // Validação completa antes de qualquer escrita.
  const { data: sessao, error: erroSessao } = await supabase.auth.getUser();
  if (erroSessao || !sessao?.user) throw new Error('Entre novamente para enviar a Base Outros Convênios.');
  const remotos = await carregarBaseOutros();
  const usados = new Set();
  const registros = bancos.map(banco => {
    const porNome = remotos.find(item => nomeChave(item.nome) === nomeChave(banco.nome));
    if (porNome && banco.banco_id && porNome.banco_id !== banco.banco_id) {
      throw new Error('O nome ' + banco.nome + ' já pertence a outro banco no Supabase. Confira antes de enviar.');
    }
    const banco_id = banco.banco_id || porNome?.banco_id ||
      'banco-' + encodeURIComponent(nomeChave(banco.nome));
    if (usados.has(banco_id) || (!banco.banco_id && !porNome && remotos.some(r => r.banco_id === banco_id))) {
      throw new Error('Identificação de banco repetida: ' + banco.nome + '. Nenhum envio foi iniciado.');
    }
    usados.add(banco_id);
    return { banco_id, nome: banco.nome, suspenso: banco.suspenso, dados: { ...banco, banco_id } };
  });
  // Uma única gravação em lote. Nunca exclui bancos ausentes nem envia coluna id.
  const { data, error } = await supabase.from(TABELA)
    .upsert(registros, { onConflict: 'banco_id' }).select(COLUNAS);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== registros.length) {
    throw new Error('O servidor não confirmou todos os bancos. Confira a base antes de reenviar; seus dados locais foram preservados.');
  }
  const confirmados = lerLinhas(data);
  for (const row of registros) {
    const confirmado = confirmados.find(b => b.banco_id === row.banco_id);
    if (!confirmado || conteudo(confirmado) !== conteudo(row.dados)) {
      throw new Error('A resposta do Supabase não confirmou os dados enviados. Confira a base antes de reenviar.');
    }
  }
  return confirmados;
}

export function mensagemErroOutros(erro) {
  if (erro?.code === '42P01' || erro?.code === 'PGRST205') {
    return 'A tabela public.base_outros_convenios não foi encontrada. Execute o SQL de criação no projeto Supabase configurado no site.';
  }
  if (erro?.code === '42501' || erro?.status === 401 || erro?.status === 403) {
    return 'Sua sessão não tem permissão. Entre novamente com o administrador e confira as políticas da tabela base_outros_convenios.';
  }
  return erro?.message || 'Confira a conexão e sua sessão no Supabase.';
}
