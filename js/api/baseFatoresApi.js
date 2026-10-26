import { supabase } from '../supa/supabaseClient.js';
import { parseNumeroCalculo } from '../simulador/calculadora-fator.js';
import { normalizarBaseFatores, chaveTabelaFator } from '../simulador/base-fatores-modelo.js';
import { validarCadastroTabelas } from '../simulador/cadastro-tabelas-fatores.js';
import { normalizarPublico } from '../simulador/publico-tabelas.js';

const TAMANHO_PAGINA = 1000;
export const MIGRACAO_FATORES = 'supabase/migrations/20261016_base_fatores_plano.sql';
export const MIGRACAO_VINCULOS = 'supabase/migrations/20261020_base_fatores_vinculos.sql';
export const MIGRACAO_PUBLICO = 'supabase/migrations/20261020_base_fatores_publico.sql';
export const MIGRACAO_SUBSTITUICAO_FATORES = 'supabase/migrations/20261026_base_fatores_sincronizacao.sql';
export const CACHE_FATORES_REMOTOS = 'ominidata_base_fatores_remota_v1';
const COLUNAS_PUBLICO = ['publico_assinatura', 'publico_invalidez'];

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

function identidadeTabela(row) {
  return JSON.stringify([nomeNormalizado(row.banco), row.tipo, String(row.plano ?? row.tabela ?? '').trim()]);
}

function temPublico(row) {
  return COLUNAS_PUBLICO.some(coluna => Object.hasOwn(row, coluna));
}

function normalizarPublicoLinha(row) {
  return normalizarPublico({
    assinatura: row.publico_assinatura ?? 'todos',
    invalidez: row.publico_invalidez ?? 'todos'
  }, true);
}

function camposPublico(row) {
  const publico = normalizarPublicoLinha(row);
  return { publico_assinatura: publico.assinatura, publico_invalidez: publico.invalidez };
}

function validarPublicos(linhas) {
  const tabelas = new Map();
  for (const row of linhas) {
    const publico = normalizarPublicoLinha(row);
    const chave = identidadeTabela(row);
    const anterior = tabelas.get(chave);
    if (anterior && (anterior.assinatura !== publico.assinatura || anterior.invalidez !== publico.invalidez)) {
      throw new Error(`O público da tabela "${row.plano || row.tabela || '(sem nome)'}" em ${row.banco} está diferente entre os prazos. Corrija e envie todos os prazos da tabela juntos. Nenhum envio foi iniciado.`);
    }
    tabelas.set(chave, publico);
  }
}

// A ausência de uma coluna não é uma ordem para apagar as marcações locais.
// Quando o remoto/arquivo informa a marcação, ela vale para a tabela inteira.
function reunirPublicos(linhas) {
  const tabelas = new Map();
  for (const row of linhas) {
    if (!temPublico(row)) continue;
    const chave = identidadeTabela(row);
    const campos = camposPublico(row);
    const atual = tabelas.get(chave) || {};
    for (const coluna of COLUNAS_PUBLICO) {
      if (!Object.hasOwn(row, coluna)) continue;
      if (Object.hasOwn(atual, coluna) && atual[coluna] !== campos[coluna]) {
        throw new Error(`O público da tabela "${row.plano || row.tabela || '(sem nome)'}" está diferente entre os prazos.`);
      }
      atual[coluna] = campos[coluna];
    }
    tabelas.set(chave, atual);
  }
  return tabelas;
}

function aplicarPublicos(base, publicos) {
  for (const [banco, dados] of Object.entries(base)) {
    for (const tipo of ['margem', 'cartao']) {
      for (const item of dados.fatores[tipo]) {
        const campos = publicos.get(identidadeTabela({ ...item, banco, tipo }));
        if (campos) Object.assign(item, campos);
      }
    }
  }
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
    if (grupos.has(chave) && grupos.get(chave).prazo !== Number(row.prazo)) {
      throw new Error('Um vínculo não pode compartilhar fatores entre prazos diferentes.');
    }
    if (grupos.has(chave) && grupos.get(chave).fator !== fator) {
      throw new Error(`As tabelas vinculadas em ${row.banco}, ${row.tipo} precisam ter o mesmo fator. Atualize e envie todas as tabelas do vínculo juntas. Nenhum envio foi iniciado.`);
    }
    grupos.set(chave, { fator, prazo: Number(row.prazo) });
  }
}

export function mensagemErroFatores(erro) {
  let mensagem;
  if (['PGRST202', '42883'].includes(erro?.code)) {
    mensagem = `O envio direto precisa da função SQL. Execute ${MIGRACAO_SUBSTITUICAO_FATORES} no SQL Editor. Nenhuma substituição foi iniciada; seus dados locais foram preservados.`;
  } else if (erro?.code === '40001') {
    mensagem = 'A base mudou no Supabase desde a consulta. Sincronize, revise e envie novamente. A substituição foi cancelada.';
  } else if (erro?.code === '42501' || erro?.status === 401 || erro?.status === 403) {
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
  validarCadastroTabelas(base);
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
        if (temPublico(item)) Object.assign(row, camposPublico(item));
        const chave = identidade(row);
        const anterior = linhas.get(chave);
        if (anterior && (anterior.fator !== fator || anterior.taxa !== taxa ||
            anterior.grupo_fator !== row.grupo_fator ||
            COLUNAS_PUBLICO.some(coluna => anterior[coluna] !== row[coluna]))) {
          throw new Error(`Há tabelas diferentes com o mesmo nome/prazo em ${banco}. Dê um nome distinto para cada tabela.`);
        }
        linhas.set(chave, row);
      }
    }
  }
  if (!linhas.size) throw new Error('O arquivo não contém fatores para enviar. Nenhum dado foi alterado.');
  validarGrupos(linhas.values());
  validarPublicos(linhas.values());
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
  const publicosRemotos = [];
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
    for (const coluna of COLUNAS_PUBLICO) {
      if (Object.hasOwn(row, coluna)) item[coluna] = camposPublico(row)[coluna];
    }
    publicosRemotos.push({ ...item, banco: nome, tipo: row.tipo });
    const indice = lista.findIndex(atual => Number(atual.prazo) === Number(item.prazo) &&
      String(atual.plano ?? atual.tabela ?? '').trim() === plano);
    if (indice < 0) lista.push(item);
    else lista[indice] = { ...lista[indice], ...item };
  }
  aplicarPublicos(base, reunirPublicos(publicosRemotos));
  return base;
}

// Consulta autoritativa: mantém seguros/logos, nunca fatores antigos ausentes no servidor.
export function substituirFatoresLocais(rows, local = {}) {
  const metadados = normalizarBaseFatores(local);
  for (const banco of Object.values(metadados)) banco.fatores = { margem: [], cartao: [] };
  return mesclarFatoresRemotos(rows, metadados);
}

const vazio = valor => valor == null || (typeof valor === 'string' && !valor.trim());

// Rascunhos são preservados no editor, mas não bloqueiam a publicação dos completos.
// Valores preenchidos incorretamente continuam sendo rejeitados pela validação estrita.
export function prepararPublicacaoFatores(base) {
  if (!objeto(base)) throw new Error('A base de fatores é inválida.');
  const copia = JSON.parse(JSON.stringify(base));
  const pendentes = [];
  for (const [banco, dados] of Object.entries(copia)) {
    if (objeto(dados?.tabelas)) {
      for (const tipo of ['margem', 'cartao']) {
        if (!Array.isArray(dados.tabelas[tipo] ?? [])) throw new Error(`Lista de tabelas inválida em ${banco}.`);
        dados.tabelas[tipo] = (dados.tabelas[tipo] || []).filter(tabela => {
          if (!objeto(tabela) || typeof tabela.nome !== 'string' || !Array.isArray(tabela.prazos)) {
            throw new Error(`Tabela inválida em ${banco}.`);
          }
          if (!tabela.nome.trim() || !tabela.prazos.length) {
            pendentes.push(`${banco}, ${tipo}: tabela ${tabela.nome || 'sem nome'}`);
            return false;
          }
          tabela.prazos = tabela.prazos.filter(linha => {
            if (objeto(linha) && (vazio(linha.prazo) || vazio(linha.fator))) {
              pendentes.push(`${banco}, ${tabela.nome}: prazo ${linha.prazo || 'não informado'}`);
              return false;
            }
            if (objeto(linha) && vazio(linha.taxa)) linha.taxa = '';
            return true;
          });
          return tabela.prazos.length > 0;
        });
      }
    } else if (objeto(dados?.fatores)) {
      // Arquivos antigos também podem conter rascunhos; datas continuam aceitas na importação.
      const blocos = Object.hasOwn(dados.fatores, 'margem') || Object.hasOwn(dados.fatores, 'cartao')
        ? [dados.fatores] : Object.values(dados.fatores);
      for (const bloco of blocos) for (const tipo of ['margem', 'cartao']) {
        if (!Array.isArray(bloco?.[tipo] ?? [])) throw new Error(`Lista ${tipo} inválida em ${banco}.`);
        bloco[tipo] = (bloco[tipo] || []).filter(linha => {
          if (objeto(linha) && (vazio(linha.prazo) || vazio(linha.fator))) {
            pendentes.push(`${banco}, ${tipo}: prazo ${linha.prazo || 'não informado'}`);
            return false;
          }
          if (objeto(linha) && vazio(linha.taxa)) linha.taxa = '';
          return true;
        });
      }
    }
  }
  const normalizada = normalizarBaseFatores(copia, { estrito: true });
  const temLinhas = Object.values(normalizada).some(b => b.fatores.margem.length || b.fatores.cartao.length);
  if (!temLinhas && pendentes.length) {
    throw new Error('Nenhum fator completo para enviar. Preencha o nome da tabela, prazo e fator em pelo menos uma linha. A taxa é opcional. Nenhum dado remoto foi alterado.');
  }
  return { base: copia, linhas: temLinhas ? prepararFatores(copia) : [], pendentes };
}

export async function substituirFatoresRemotos(base, { confirmarVazia = false, baseAnterior } = {}) {
  const { linhas, pendentes } = prepararPublicacaoFatores(base);
  if (!linhas.length && !confirmarVazia) throw new Error('Esvaziar a base exige confirmação explícita.');
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error('Entre novamente antes de enviar a Base de Fatores.');
  const anteriores = (baseAnterior ?? await carregarFatoresRemotos())
    .filter(row => String(row.convenio ?? 'INSS').toUpperCase() === 'INSS');
  const registros = linhas.map(row => ({ ...row, grupo_fator: row.grupo_fator ?? null,
    publico_assinatura: row.publico_assinatura ?? 'todos', publico_invalidez: row.publico_invalidez ?? 'todos' }));
  const resposta = await supabase.rpc('substituir_base_fatores', {
    p_registros: registros, p_base_anterior: anteriores, p_confirmar_vazia: confirmarVazia
  });
  if (resposta.error) throw resposta.error;
  const confirmado = resposta.data;
  if (!objeto(confirmado) || !Array.isArray(confirmado.registros) ||
      confirmado.registros.length !== registros.length || confirmado.backup_id == null ||
      !Number.isInteger(confirmado.removidos) || confirmado.removidos < 0) {
    throw new Error('O Supabase não confirmou a substituição. Confira o servidor antes de reenviar; seus dados locais foram preservados.');
  }
  const porChave = new Map(confirmado.registros.map(row => [identidade(row), row]));
  if (porChave.size !== registros.length || registros.some(row => {
    const salvo = porChave.get(identidade(row));
    return !salvo || parseNumeroCalculo(salvo.fator) !== row.fator ||
      (salvo.taxa == null ? null : parseNumeroCalculo(salvo.taxa)) !== row.taxa ||
      (salvo.grupo_fator ?? null) !== row.grupo_fator ||
      COLUNAS_PUBLICO.some(coluna => salvo[coluna] !== row[coluna]);
  })) throw new Error('A resposta não confirmou os fatores enviados. Confira o servidor antes de reenviar.');
  return { linhas: confirmado.registros, quantidade: registros.length, removidos: confirmado.removidos,
    backupId: confirmado.backup_id, pendentes };
}

export function mesclarArquivoFatores(importado, local = {}) {
  const base = normalizarBaseFatores(local);
  const publicosImportados = [];
  for (const [nome, dados] of Object.entries(normalizarBaseFatores(importado, { estrito: true }))) {
    const chave = Object.keys(base).find(n => nomeNormalizado(n) === nomeNormalizado(nome)) || nome;
    const anterior = base[chave] || {};
    const banco = base[chave] = { ...anterior, ...dados,
      fatores: { margem: [], cartao: [], ...anterior.fatores } };
    for (const tipo of ['margem', 'cartao']) {
      const lista = banco.fatores[tipo];
      for (const item of dados.fatores[tipo]) {
        publicosImportados.push({ ...item, banco: chave, tipo });
        const indice = lista.findIndex(atual => chaveTabelaFator(atual) === chaveTabelaFator(item));
        if (indice < 0) lista.push({ ...item });
        else lista[indice] = { ...lista[indice], ...item };
      }
    }
  }
  aplicarPublicos(base, reunirPublicos(publicosImportados));
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
  const colunasPublico = await Promise.all(COLUNAS_PUBLICO.map(colunaDisponivel));
  const temColunasPublico = colunasPublico.every(Boolean);
  if (!temColunasPublico && linhas.some(temPublico)) {
    throw new Error(`O Supabase ainda não possui as colunas de público das tabelas. Execute ${MIGRACAO_PUBLICO} no SQL Editor para publicar as restrições de assinatura e invalidez. Os dados continuam neste navegador; nenhum registro remoto foi alterado.`);
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
    const camposEfetivos = { ...row };
    if (!temColunasPublico) COLUNAS_PUBLICO.forEach(coluna => delete camposEfetivos[coluna]);
    efetivas.set(identidade(row), { ...anterior, ...camposEfetivos });
    if (anterior) {
      if (anterior.id == null) throw new Error('Um fator remoto está sem ID. Nenhum envio foi feito; confira a estrutura da tabela no Supabase.');
      const taxaAnterior = anterior.taxa == null || anterior.taxa === '' ? null : parseNumeroCalculo(anterior.taxa);
      const mudouVinculo = temVinculos && Object.hasOwn(row, 'grupo_fator') &&
        grupoFator(anterior.grupo_fator) !== row.grupo_fator;
      const mudouPublico = temColunasPublico && temPublico(row) &&
        COLUNAS_PUBLICO.some(coluna => (anterior[coluna] ?? 'todos') !== row[coluna]);
      if (parseNumeroCalculo(anterior.fator) === row.fator && taxaAnterior === row.taxa && !mudouVinculo && !mudouPublico) {
        mantidos++;
      } else {
        // ID apenas no filtro do UPDATE, nunca no conteúdo enviado para gravar.
        const valores = { fator: row.fator, taxa: row.taxa };
        if (temVinculos && Object.hasOwn(row, 'grupo_fator')) valores.grupo_fator = row.grupo_fator;
        if (temColunasPublico && temPublico(row)) Object.assign(valores, camposPublico(row));
        alteracoes.push({ id: anterior.id, valores });
      }
    } else {
      if (!temPlano) delete novo.plano;
      if (!temVinculos) delete novo.grupo_fator;
      if (!temColunasPublico) COLUNAS_PUBLICO.forEach(coluna => delete novo[coluna]);
      // Compatibilidade com projetos antigos cuja coluna data ainda é NOT NULL.
      // Valor técnico fixo: nenhuma tabela nova é dividida por data.
      if (temDataLegada) novo.data = '1970-01-01';
      novos.push(novo);
    }
  }
  // Evita que um arquivo parcial altere só um membro de um vínculo já publicado.
  validarGrupos(efetivas.values());
  validarPublicos(efetivas.values());
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
