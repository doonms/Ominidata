import { supabase } from '../supa/supabaseClient.js';
import { getCurrentUser, isAdmin } from '../auth/accessControl.js';
import { arquivoBaseClt, prepararBaseClt } from '../clt/modelo.js';

export const CACHE_CLT_PUBLICADA = 'ominidata_base_clt_publicada_v1';
export const SQL_BASE_CLT = 'supabase/migrations/20261103_base_clt.sql';
const COLUNAS = 'banco_id,nome,suspenso,dados';
const PAGINA = 500;
const ordenar = valor => Array.isArray(valor) ? valor.map(ordenar)
  : valor && typeof valor === 'object' ? Object.fromEntries(Object.keys(valor).sort().map(k => [k, ordenar(valor[k])])) : valor;
export const conteudoClt = valor => JSON.stringify(ordenar(valor));

export function bancosDasLinhasClt(registros) {
  if (!Array.isArray(registros)) throw new Error('Resposta inválida ao consultar a Base CLT.');
  const bancos = registros.map(row => {
    if (!row || typeof row.banco_id !== 'string' || !row.banco_id.trim() || typeof row.nome !== 'string' ||
        typeof row.suspenso !== 'boolean' || !row.dados || typeof row.dados !== 'object' || Array.isArray(row.dados)) {
      throw new Error('O Supabase retornou um cadastro CLT inválido. Os dados locais foram preservados.');
    }
    return { ...row.dados, banco_id: row.banco_id, nome: row.nome, suspenso: row.suspenso };
  });
  return prepararBaseClt(arquivoBaseClt(bancos));
}

export async function carregarEstadoClt() {
  const registros = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase.from('base_clt').select(COLUNAS).order('banco_id').range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao consultar a Base CLT.');
    registros.push(...data);
    if (data.length < PAGINA) break;
  }
  return { registros, bancos: bancosDasLinhasClt(registros) };
}

export function salvarCacheCltPublicado(bancos) {
  try { localStorage.setItem(CACHE_CLT_PUBLICADA, JSON.stringify(arquivoBaseClt(bancos))); return true; }
  catch { return false; }
}

export function lerCacheCltPublicado() {
  try {
    const raw = localStorage.getItem(CACHE_CLT_PUBLICADA);
    return raw === null ? null : prepararBaseClt(JSON.parse(raw));
  } catch { return null; }
}

export async function enviarBaseClt(bancos, { anteriores, confirmarVazia = false } = {}) {
  const preparados = prepararBaseClt(arquivoBaseClt(bancos));
  if (!preparados.length && !confirmarVazia) throw new Error('Esvaziar a Base CLT exige confirmação explícita.');
  if (!isAdmin(await getCurrentUser())) throw new Error('Somente Master ou Admin podem enviar a Base CLT.');
  if (!Array.isArray(anteriores)) throw new Error('Consulte o Supabase antes de enviar a Base CLT.');
  const registros = preparados.map(b => ({ banco_id: b.banco_id, nome: b.nome, suspenso: b.suspenso, dados: b }));
  const { data, error } = await supabase.rpc('substituir_base_clt', {
    p_registros: registros, p_base_anterior: anteriores, p_confirmar_vazia: confirmarVazia
  });
  if (error) throw error;
  const ordenarLinhas = rows => [...rows].sort((a, b) => a.banco_id.localeCompare(b.banco_id));
  if (!data || !Array.isArray(data.registros) || !Number.isInteger(data.removidos) || data.removidos < 0 || data.backup_id == null ||
      conteudoClt(ordenarLinhas(data.registros)) !== conteudoClt(ordenarLinhas(registros))) {
    throw new Error('O servidor não confirmou o conteúdo enviado. Confira o Supabase antes de reenviar; os rascunhos locais foram preservados.');
  }
  return { registros: data.registros, bancos: bancosDasLinhasClt(data.registros), removidos: data.removidos };
}

export function mensagemErroClt(error) {
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error?.code)) return `Instale a Base CLT executando ${SQL_BASE_CLT} no SQL Editor do Supabase. Nenhum envio foi iniciado.`;
  if (error?.code === '40001') return 'A base publicada mudou desde a leitura. Nenhuma substituição foi feita. Exporte seu rascunho, sincronize e revise antes de enviar novamente.';
  if (error?.code === '42501') return 'Sem permissão para essa ação. Confira o perfil Master/Admin e as políticas da Base CLT.';
  return error?.message || 'Confira sua conexão e sua sessão no Supabase.';
}
