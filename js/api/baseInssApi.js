// js/api/baseInssApi.js
import { supabase } from "../supa/supabaseClient.js";

const LOCAL_KEY = "regras_bancos_v1";

/**
 * Gera o ID interno do banco (banco_id) a partir do nome.
 * Regra combinada: primeiras letras da primeira palavra,
 * minúsculo, sem acento, sem caracteres estranhos.
 */
export function gerarBancoId(nome) {
  if (!nome) return "";
  const primeira = nome.toString().trim().split(/\s+/)[0];
  const normalizado = primeira
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return normalizado.length <= 3 ? normalizado : normalizado.slice(0, 3);
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
