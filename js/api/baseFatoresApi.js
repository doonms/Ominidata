import { supabase } from '../supa/supabaseClient.js';
import { parseNumeroCalculo } from '../simulador/calculadora-fator.js';
import { normalizarBaseFatores, chaveTabelaFator } from '../simulador/base-fatores-modelo.js';

const TAMANHO_PAGINA = 1000;
export const MIGRACAO_FATORES = 'supabase/migrations/20261016_base_fatores_plano.sql';
export const MIGRACAO_VINCULOS = 'supabase/migrations/20261020_base_fatores_vinculos.sql';

function objeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function nomeNormalizado(nome) {
  return String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nomeSeguro(nome) {
  return typeof nome === 'string' && nome.trim() &&
    !['__proto__', 'constructor', 'prototype'].includes(nome.trim());
}

function identidade(row) {
  return JSON.stringify([nomeNormalizado(row.banco),
    row.tipo === 'cartao' ? 'cartao' : 'margem', Number(row.prazo),
    String(row.plano ?? row.tabela ?? '').trim()]);
}

function registrosAtuais(rows) {
  // Datas só são consultadas para resolver versões antigas já existentes no servidor.
  // Não fazem parte da identidade nem do formato utilizado no aplicativo.
  const ordem = row => /^\d{4}-\d{2}-\d{2}/.test(row.data || '') ? String(row.data).slice(0, 10) : '9999-12-31';
  const ordenados = rows.filter(row => nomeSeguro(row.banco) &&
    ['margem', 'cartao'].includes(row.tipo) && String(row.convenio || 'INSS').toUpperCase() === 'INSS')
    .sort((a, b) => ordem(a).localeCompare(ordem(b)) || String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true }));
  const mapa = new Map();
  ordenados.forEach(row => mapa.set(identidade(row), row));
  return [...mapa.values()];
}

function grupoFator(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > 128) {
    throw new Error('Vínculo de fator inválido. Use um JSON exportado da Base de Fatores.');
  }
  return valor.trim();
}

function validarGrupos(linhas) {
  const grupos = new Map();
  for (const row of linhas) {
    if (!row.grupo_fator) continue;
    const chave = JSON.stringify([nomeNormalizado(row.banco), row.tipo, grupoFator(row.grupo_fator)]);
    const fator = parseNumeroCalculo(row.fator);
    if (grupos.has(chave) && grupos.get(chave) !== fator) {
      throw new Error(`As tabelas vinculadas em ${row.banco}, ${row.tipo} precisam ter o mesmo fator. Atualize e envie todas as tabelas do vínculo juntas. Nenhum envio foi iniciado.`);
    }
    grupos.set(chave, fator);
  }
}

export function mensagemErroFatores(erro) {
  let mensagem;
  if (erro?.code === '42501' || erro?.status === 401 || erro?.status === 403) {
    mensagem = 'Sua sessão não tem permissão para acessar/gravar a Base de Fatores. Entre novamente e confira as permissões no Supabase.';
  } else {
    mensagem = erro?.message || 'Não foi possível acessar a Base de Fatores. Confira sua conexão e sessão.';
  }
  return erro?.confirmados > 0
    ? `Envio parcial: ${erro.confirmados} fator${erro.confirmados === 1 ? '' : 'es'} com gravação confirmada. O envio não foi concluído; os demais não foram confirmados. ${mensagem}`
    : mensagem;
}

// Valida o arquivo inteiro ANTES de qualquer escrita, sem descartar linhas inválidas silenciosamente.
export function prepararFatores(base) {
  if (!objeto(base) || !Object.keys(base).length) throw new Error('O JSON precisa conter bancos com listas de fatores.');
  const atual = normalizarBaseFatores(base, { estrito: true });
  const linhas = new Map();
  for (const [banco, dados] of Object.entries(atual)) {
    if (!nomeSeguro(banco) || !objeto(dados) || !objeto(dados.fatores)) {
      throw new Error(`Formato inválido no banco "${banco}". Use um JSON exportado da Base de Fatores.`);
    }
    for (const tipo of ['margem', 'cartao']) {
      for (const item of dados.fatores[tipo]) {
        if (!objeto(item)) throw new Error(`Linha inválida em ${banco}, ${tipo}.`);
        const prazo = parseNumeroCalculo(item.prazo);
        const fator = parseNumeroCalculo(item.fator);
        const taxa = item.taxa === '' || item.taxa == null ? null : parseNumeroCalculo(item.taxa);
        if (!Number.isInteger(prazo) || prazo <= 0 || fator === null || fator <= 0 ||
            (item.taxa !== '' && item.taxa != null && (taxa === null || taxa < 0))) {
          throw new Error(`Prazo, fator ou taxa inválidos em ${banco}, ${tipo}. Corrija a linha antes de enviar.`);
        }
        const row = { banco: banco.trim(), convenio: 'INSS', tipo, prazo, fator, taxa,
          plano: String(item.plano ?? item.tabela ?? '').trim() };
        if (Object.hasOwn(item, 'grupo_fator')) row.grupo_fator = grupoFator(item.grupo_fator);
        const chave = identidade(row);
        const anterior = linhas.get(chave);
        if (anterior && (anterior.fator !== fator || anterior.taxa !== taxa ||
            anterior.grupo_fator !== row.grupo_fator)) {
          throw new Error(`Há tabelas diferentes com o mesmo nome/prazo em ${banco}. Dê um nome distinto para cada tabela.`);
        }
        linhas.set(chave, row);
      }
    }
  }
  if (!linhas.size) throw new Error('O arquivo não contém fatores para enviar. Nenhum dado foi alterado.');
  validarGrupos(linhas.values());
  return [...linhas.values()];
}

export async function carregarFatoresRemotos() {
  const linhas = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await supabase.from('base_fatores').select('*')
      .order('id').range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao consultar a Base de Fatores.');
    linhas.push(...data);
    if (data.length < TAMANHO_PAGINA) return linhas;
  }
}

// Preserva tabelas locais, seguros e logos. Remoto atualiza somente as linhas correspondentes.
export function mesclarFatoresRemotos(rows, local = {}) {
  const base = normalizarBaseFatores(local);
  for (const row of registrosAtuais(rows)) {
    if (!nomeSeguro(row.banco) || !['margem', 'cartao'].includes(row.tipo) ||
        (row.convenio && String(row.convenio).toUpperCase() !== 'INSS')) continue;
    const nome = Object.keys(base).find(n => nomeNormalizado(n) === nomeNormalizado(row.banco)) || row.banco;
    const banco = base[nome] ??= { fatores: { margem: [], cartao: [] }, seguros: [] };
    const lista = banco.fatores[row.tipo];
    let plano = String(row.plano ?? row.tabela ?? '').trim();
    if (!plano) {
      const iguais = lista.filter(item => Number(item.prazo) === Number(row.prazo) &&
        parseNumeroCalculo(item.fator) === parseNumeroCalculo(row.fator));
      if (iguais.length === 1) plano = String(iguais[0].plano ?? iguais[0].tabela ?? '');
    }
    const item = { prazo: row.prazo, fator: row.fator, taxa: row.taxa ?? '', plano };
    // Ausência da coluna em um schema antigo não apaga vínculos locais.
    if (Object.hasOwn(row, 'grupo_fator')) item.grupo_fator = grupoFator(row.grupo_fator);
    const indice = lista.findIndex(atual => Number(atual.prazo) === Number(item.prazo) &&
      String(atual.plano ?? atual.tabela ?? '').trim() === plano);
    if (indice < 0) lista.push(item);
    else lista[indice] = { ...lista[indice], ...item };
  }
  return base;
}

export function mesclarArquivoFatores(importado, local = {}) {
  const base = normalizarBaseFatores(local);
  for (const [nome, dados] of Object.entries(normalizarBaseFatores(importado, { estrito: true }))) {
    const chave = Object.keys(base).find(n => nomeNormalizado(n) === nomeNormalizado(nome)) || nome;
    const anterior = base[chave] || {};
    const banco = base[chave] = { ...anterior, ...dados,
      fatores: { margem: [], cartao: [], ...anterior.fatores } };
    for (const tipo of ['margem', 'cartao']) {
      const lista = banco.fatores[tipo];
      for (const item of dados.fatores[tipo]) {
        const indice = lista.findIndex(atual => chaveTabelaFator(atual) === chaveTabelaFator(item));
        if (indice < 0) lista.push({ ...item });
        else lista[indice] = { ...lista[indice], ...item };
      }
    }
  }
  return base;
}

async function colunaDisponivel(nome) {
  const { error } = await supabase.from('base_fatores').select(nome).limit(0);
  if (!error) return true;
  if (['42703', 'PGRST204'].includes(error.code)) return false;
  throw error;
}

export async function enviarFatoresRemotos(base) {
  const linhas = prepararFatores(base);
  const { data: sessao, error: erroSessao } = await supabase.auth.getUser();
  if (erroSessao) throw erroSessao;
  if (!sessao?.user) throw new Error('Entre novamente antes de enviar a Base de Fatores ao Supabase.');
  const temPlano = await colunaDisponivel('plano');
  if (!temPlano && linhas.some(row => row.plano)) {
    throw new Error(`O Supabase ainda não possui a coluna "plano". Execute ${MIGRACAO_FATORES} no SQL Editor e tente novamente. O arquivo foi mantido neste navegador; nenhum registro remoto foi alterado.`);
  }
  const temVinculos = await colunaDisponivel('grupo_fator');
  if (!temVinculos && linhas.some(row => row.grupo_fator)) {
    throw new Error(`O Supabase ainda não possui a coluna "grupo_fator". Execute ${MIGRACAO_VINCULOS} no SQL Editor para publicar os vínculos. Os dados continuam neste navegador; nenhum registro remoto foi alterado.`);
  }
  const temDataLegada = await colunaDisponivel('data');
  const atuais = registrosAtuais(await carregarFatoresRemotos());
  const porChave = new Map();
  for (const row of atuais) {
    if (String(row.convenio || 'INSS').toUpperCase() !== 'INSS' || !['margem', 'cartao'].includes(row.tipo)) continue;
    const chave = identidade(row);
    porChave.set(chave, row);
  }
  const novos = [];
  const alteracoes = [];
  const efetivas = new Map(porChave);
  let mantidos = 0;
  for (const row of linhas) {
    const anterior = porChave.get(identidade(row));
    const novo = { ...row };
    efetivas.set(identidade(row), { ...anterior, ...row });
    if (anterior) {
      if (anterior.id == null) throw new Error('Um fator remoto está sem ID. Nenhum envio foi feito; confira a estrutura da tabela no Supabase.');
      const taxaAnterior = anterior.taxa == null || anterior.taxa === '' ? null : parseNumeroCalculo(anterior.taxa);
      const mudouVinculo = temVinculos && Object.hasOwn(row, 'grupo_fator') &&
        grupoFator(anterior.grupo_fator) !== row.grupo_fator;
      if (parseNumeroCalculo(anterior.fator) === row.fator && taxaAnterior === row.taxa && !mudouVinculo) {
        mantidos++;
      } else {
        // ID apenas no filtro do UPDATE, nunca no conteúdo enviado para gravar.
        const valores = { fator: row.fator, taxa: row.taxa };
        if (temVinculos && Object.hasOwn(row, 'grupo_fator')) valores.grupo_fator = row.grupo_fator;
        alteracoes.push({ id: anterior.id, valores });
      }
    } else {
      if (!temPlano) delete novo.plano;
      if (!temVinculos) delete novo.grupo_fator;
      // Compatibilidade com projetos antigos cuja coluna data ainda é NOT NULL.
      // Valor técnico fixo: nenhuma tabela nova é dividida por data.
      if (temDataLegada) novo.data = '1970-01-01';
      novos.push(novo);
    }
  }
  // Evita que um arquivo parcial altere só um membro de um vínculo já publicado.
  validarGrupos(efetivas.values());
  let atualizados = 0;
  let inseridos = 0;
  try {
    for (const alteracao of alteracoes) {
      const { data, error, count } = await supabase.from('base_fatores')
        .update(alteracao.valores, { count: 'exact' }).eq('id', alteracao.id).select('id');
      if (error) throw error;
      if (count !== 1 || !Array.isArray(data) || data.length !== 1 || String(data[0].id) !== String(alteracao.id)) {
        throw new Error('O Supabase não confirmou a atualização de um fator existente. Confira as permissões de atualização e tente novamente.');
      }
      atualizados++;
    }
    if (novos.length) {
      // INSERT sem ID: funciona também com GENERATED ALWAYS AS IDENTITY.
      const { data, error, count } = await supabase.from('base_fatores')
        .insert(novos, { count: 'exact' }).select('id');
      if (error) throw error;
      // A contagem confirma o lote inteiro mesmo quando max_rows limita as linhas retornadas.
      if (!Array.isArray(data) || count !== novos.length) {
        throw new Error('O Supabase não confirmou todos os fatores novos. Confira a base antes de tentar novamente.');
      }
      inseridos = count;
    }
  } catch (error) {
    const falha = new Error(mensagemErroFatores(error), { cause: error });
    falha.confirmados = atualizados + inseridos;
    throw falha;
  }
  return { linhas, quantidade: mantidos + atualizados + inseridos, mantidos, atualizados, inseridos };
}
