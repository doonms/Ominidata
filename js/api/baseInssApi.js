// js/api/baseInssApi.js
import { supabase } from "../supa/supabaseClient.js";
import { normalize } from '../components/util.js';

const LOCAL_KEY = "regras_bancos_v1";

/**
 * Gera o ID interno do banco (banco_id) a partir do nome.
 * Novos bancos usam o nome completo; identificações remotas já existentes são preservadas.
 */
export function gerarBancoId(nome) {
  if (!nome) return "";
  const normalizado = nome.toString().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalizado ? `inss-${normalizado}` : '';
}

const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const nomeChave = valor => String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
export const BACKUP_ENVIO_INSS = 'ominidata_base_inss_antes_envio_v1';

export function prepararBaseInss(json, remotos = []) {
  if (!Array.isArray(json) && !objeto(json)) throw new Error('O arquivo precisa conter uma lista ou objeto de bancos.');
  const entradas = Array.isArray(json) ? json.map(banco => [banco?.nome || banco?.nomeBanco, banco]) : Object.entries(json);
  if (!entradas.length) throw new Error('O arquivo está vazio. Nenhum envio foi iniciado.');
  const nomes = new Set(), ids = new Map();
  return entradas.map(([nome, original]) => {
    if (typeof nome !== 'string' || !nome.trim() || !objeto(original) ||
        ['__proto__','constructor','prototype'].includes(nome.trim())) {
      throw new Error('Arquivo com banco sem nome ou dados inválidos. Nenhum envio foi iniciado.');
    }
    const chave = nomeChave(nome);
    if (!chave) throw new Error(`Nome de banco inválido: "${nome}".`);
    if (nomes.has(chave)) throw new Error(`O banco "${nome}" está repetido no arquivo. Mantenha um único cadastro para esse banco.`);
    nomes.add(chave);
    const correspondentes = remotos.filter(row => nomeChave(row.nome || row.dados?.nome) === chave);
    if (correspondentes.length > 1) throw new Error(`Há mais de um cadastro remoto para "${nome}". Confira as identificações antes de enviar.`);
    const remoto = correspondentes[0];
    // O nome identifica o banco em arquivos antigos que perderam banco_id ao carregar/exportar.
    const banco_id = remoto?.banco_id ?? original.banco_id ?? gerarBancoId(nome);
    if (typeof banco_id !== 'string' || !banco_id.trim()) throw new Error(`Identificação inválida no banco "${nome}".`);
    const outro = remotos.find(row => row.banco_id === banco_id && nomeChave(row.nome || row.dados?.nome) !== chave);
    if (outro && !original.banco_id && remoto?.banco_id !== banco_id) {
      throw new Error(`A identificação "${banco_id}" de "${nome}" já pertence a "${outro.nome || outro.dados?.nome}". Confira o nome/identificação antes de reenviar; nenhum envio foi iniciado.`);
    }
    if (ids.has(banco_id)) throw new Error(`"${ids.get(banco_id)}" e "${nome}" usam a mesma identificação "${banco_id}". Corrija os cadastros antes de enviar.`);
    ids.set(banco_id, nome);
    const suspenso = original.suspenso ?? original.status_suspenso ?? false;
    if (typeof suspenso !== 'boolean') throw new Error(`Status de suspensão inválido em "${nome}".`);
    const dados = normalize(JSON.parse(JSON.stringify({ ...original, banco_id, nome: nome.trim(), suspenso })));
    return { banco_id, nome: nome.trim(), suspenso, dados };
  });
}

export async function carregarLinhasInss() {
  const linhas = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase.from('base_inss').select('*').order('banco_id').range(inicio, inicio + 999);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao consultar a Base INSS.');
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

function ordenarJson(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarJson);
  return objeto(valor) ? Object.fromEntries(Object.keys(valor).sort().map(k => [k, ordenarJson(valor[k])])) : valor;
}

function conteudoRegistro(row) {
  return JSON.stringify(ordenarJson({ banco_id: row.banco_id, nome: row.nome, suspenso: row.suspenso, dados: row.dados }));
}

export async function enviarBaseInss(json, { antesDeEnviar = () => true, baseLocal = null } = {}) {
  prepararBaseInss(json); // Arquivo inválido não inicia nem consulta de gravação.
  const { data: sessao, error: erroSessao } = await supabase.auth.getUser();
  if (erroSessao) throw erroSessao;
  if (!sessao?.user) throw new Error('Entre novamente antes de enviar a Base INSS.');
  const anteriores = await carregarLinhasInss();
  if (anteriores.some(row => typeof row.banco_id !== 'string' || !row.banco_id.trim())) {
    throw new Error('Há um banco remoto sem identificação válida. Confira a tabela base_inss antes de publicar.');
  }
  const registros = prepararBaseInss(json, anteriores);
  const ids = new Set(registros.map(row => row.banco_id));
  const remover = anteriores.filter(row => !ids.has(row.banco_id)).map(row => row.banco_id);
  if (!await antesDeEnviar({ quantidade: registros.length, removidos: remover.length })) return null;
  // Backup rotativo; falhar ao salvar interrompe o envio ANTES de gravar no servidor.
  localStorage.setItem(BACKUP_ENVIO_INSS, JSON.stringify({ data: new Date().toISOString(), arquivo: json,
    local: baseLocal, remoto: anteriores }));
  let confirmados = 0, removidos = 0;
  try {
    // Grava primeiro: uma falha de INSERT/UPDATE não apaga antecipadamente a base publicada.
    const { data, error, count } = await supabase.from('base_inss')
      .upsert(registros, { onConflict: 'banco_id', count: 'exact' }).select('banco_id');
    if (error) throw error;
    if (count !== registros.length || !Array.isArray(data) || data.some(row => !ids.has(row.banco_id))) {
      throw new Error('O Supabase não confirmou todos os bancos enviados. Nenhuma exclusão foi iniciada.');
    }
    confirmados = count;
    for (let i = 0; i < remover.length; i += 100) {
      const lote = remover.slice(i, i + 100);
      const exclusao = await supabase.from('base_inss').delete({ count: 'exact' })
        .in('banco_id', lote).select('banco_id');
      if (exclusao.error) throw exclusao.error;
      if (exclusao.count !== lote.length) throw new Error('O Supabase não confirmou a remoção dos bancos antigos.');
      removidos += exclusao.count;
    }
    const final = await carregarLinhasInss();
    const mapa = new Map(final.map(row => [row.banco_id, row]));
    if (final.length !== registros.length || registros.some(row => !mapa.has(row.banco_id) ||
      conteudoRegistro(row) !== conteudoRegistro(mapa.get(row.banco_id)))) {
      throw new Error('A conferência final não confirmou o conteúdo publicado. Confira a base antes de reenviar.');
    }
    return { quantidade: registros.length, removidos };
  } catch (erro) {
    const falha = new Error(erro?.message || 'Falha de comunicação durante o envio.', { cause: erro });
    falha.code = erro?.code;
    falha.status = erro?.status;
    falha.envioIniciado = true;
    falha.confirmados = confirmados;
    falha.removidos = removidos;
    throw falha;
  }
}

export function mensagemErroInss(erro) {
  let motivo = erro?.message || 'Confira a conexão e tente novamente.';
  if (erro instanceof SyntaxError) motivo = 'O arquivo selecionado não é um JSON válido.';
  if (erro?.code === '42501' || [401,403].includes(erro?.status)) {
    motivo = 'Sua sessão não tem permissão para publicar a Base INSS. Entre com um perfil Master ou Admin e confira as políticas RLS da tabela base_inss.';
  } else if (erro?.code === '42P10') {
    motivo = 'O Supabase não possui a restrição UNIQUE necessária em banco_id para atualizar a Base INSS. Confira a estrutura da tabela antes de reenviar.';
  } else if (erro?.code === '22001') {
    motivo = 'Um campo excede o tamanho permitido na tabela base_inss. Confira os limites de nome e banco_id no Supabase.';
  }
  const codigo = erro?.code ? ` [${erro.code}]` : '';
  const estado = erro?.envioIniciado
    ? `${erro.confirmados || 0} bancos com gravação confirmada; ${erro.removidos || 0} exclusões confirmadas. O envio não foi concluído. Confira o servidor antes de reenviar. Backup local preservado.`
    : 'Nenhuma gravação foi iniciada. Seus dados locais foram preservados.';
  return `${motivo}${codigo} ${estado}`;
}

/**
 * Lê a base INSS do Supabase.
 * Se der erro e useFallback = true, tenta cair para o localStorage.
 * 
 * Retorno: objeto no mesmo formato que você já usava,
 * ex: { "C6": { ...dadosDoBanco... }, "PAN": { ... } }
 */
export async function carregarBaseInss({ incluirSuspensos = false, useFallback = true } = {}) {
  try {
    let query = supabase
      .from("base_inss")
      .select(`
        *,
        nomeBanco:dados->>nome
      `);

    if (!incluirSuspensos) {
      query = query.eq("suspenso", false);
    }

    const { data, error } = await query;
    if (error) throw error;

    const mapa = {};

    for (const row of data) {
      const nomeBanco = row.nomeBanco || row.nome || row.dados?.nome || row.banco_id;
      // chave que seu código já usa hoje (nome comercial)
      const chave = row.nome || row.dados?.nome || row.banco_id;

      // garante que dentro de dados tem nome/banco_id/suspenso também
      const dadosBanco = {
        ...row.dados,
        nome: row.nome || row.dados?.nome || nomeBanco,
        banco_id: row.banco_id,
        suspenso: row.suspenso,
        nomeBanco
      };

      mapa[chave] = dadosBanco;
    }

    // opcional: sincroniza localStorage pra uso offline / fallback
    if (useFallback) {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(mapa));
    }

    return mapa;
  } catch (err) {
    console.error("Erro ao carregar base_inss do Supabase:", err);

    if (!useFallback) throw err;

    // fallback pro que já existia
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}
