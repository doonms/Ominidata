import { normalizarPublico, publicoDaLinha } from './publico-tabelas.js';

export const PRAZOS_PADRAO = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120];
const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const temPublico = linha => Object.hasOwn(linha, 'publico_assinatura') || Object.hasOwn(linha, 'publico_invalidez');
const publicoIgual = (a, b) => a.assinatura === b.assinatura && a.invalidez === b.invalidez;
export const prazoPendente = linha => objeto(linha) &&
  (linha.prazo == null || (typeof linha.prazo === 'string' && !linha.prazo.trim()));
export const temPrazosPendentes = base => Object.values(base || {}).some(banco =>
  ['margem', 'cartao'].some(tipo => banco?.tabelas?.[tipo]?.some(tabela => tabela.prazos.some(prazoPendente))));

// Modelo do editor/JSON: banco.tabelas.modalidade = [{ nome, prazos: [...] }].
// A projeção de leitura permite usar o mesmo cadastro no simulador e na API.
export function projetarCadastroFatores(base, { estrito = true } = {}) {
  if (!objeto(base)) return base;
  return Object.fromEntries(Object.entries(base).map(([nome, banco]) => {
    if (!objeto(banco?.tabelas)) return [nome, banco];
    const { tabelas, fatores: _anterior, ...dados } = banco;
    if (Object.keys(tabelas).some(tipo => !['margem', 'cartao'].includes(tipo))) {
      throw new Error(`Modalidade inválida em ${nome}. Use margem ou cartao.`);
    }
    const fatores = { margem: [], cartao: [] };
    for (const tipo of ['margem', 'cartao']) {
      if (!Array.isArray(tabelas[tipo] ?? [])) throw new Error(`Cadastro de tabelas inválido em ${nome}.`);
      for (const tabela of tabelas[tipo] || []) {
        if (!objeto(tabela) || typeof tabela.nome !== 'string' || !Array.isArray(tabela.prazos)) {
          throw new Error(`Tabela inválida em ${nome}. Informe nome e lista de prazos.`);
        }
        const publico = Object.hasOwn(tabela, 'publico') ? normalizarPublico(tabela.publico, true) : null;
        for (const linha of tabela.prazos) {
          // Um rascunho não participa do cálculo, mas permanece no cadastro para correção.
          if (!estrito && prazoPendente(linha)) continue;
          if (!objeto(linha) || !Number.isSafeInteger(Number(linha.prazo)) || Number(linha.prazo) <= 0) {
            throw new Error(`Prazo inválido na tabela "${tabela.nome}".`);
          }
          fatores[tipo].push({ ...linha, plano: tabela.nome.trim(), ...(publico ? {
            publico_assinatura: publico.assinatura, publico_invalidez: publico.invalidez
          } : {}) });
        }
      }
    }
    return [nome, { ...dados, fatores }];
  }));
}

export function criarCadastroTabelas(base, anterior = {}) {
  const cadastro = {};
  for (const [nome, banco] of Object.entries(base || {})) {
    if (objeto(banco?.tabelas)) {
      const copia = JSON.parse(JSON.stringify(banco));
      copia.tabelas = { margem: copia.tabelas.margem ?? [], cartao: copia.tabelas.cartao ?? [] };
      cadastro[nome] = copia;
      continue;
    }
    const { fatores, ...dados } = banco;
    const tabelas = { margem: [], cartao: [] };
    for (const tipo of ['margem', 'cartao']) {
      for (const item of fatores?.[tipo] || []) {
        const nomeTabela = String(item.plano ?? item.tabela ?? '').trim();
        let tabela = tabelas[tipo].find(t => t.nome === nomeTabela);
        if (!tabela) { tabela = { nome: nomeTabela, prazos: [] }; tabelas[tipo].push(tabela); }
        if (temPublico(item)) {
          const publico = publicoDaLinha(item);
          if (tabela.publico && !publicoIgual(tabela.publico, publico)) {
            throw new Error(`O público da tabela "${nomeTabela}" está diferente entre os prazos. Corrija os dados antes de publicar.`);
          }
          tabela.publico = publico;
        }
        const { plano: _plano, tabela: _tabela, publico_assinatura: _assinatura,
          publico_invalidez: _invalidez, ...prazo } = item;
        tabela.prazos.push({ ...prazo });
      }
      // Schemas sem as novas colunas não devem apagar as marcações locais.
      for (const tabela of tabelas[tipo]) {
        const anteriorTabela = anterior[nome]?.tabelas?.[tipo]?.find(t => t.nome === tabela.nome);
        if (!tabela.publico && anteriorTabela && Object.hasOwn(anteriorTabela, 'publico')) {
          tabela.publico = normalizarPublico(anteriorTabela.publico);
        }
      }
      // Rascunhos vazios ou com prazo pendente não são descartados pela projeção/consulta remota.
      for (const tabela of anterior[nome]?.tabelas?.[tipo] || []) {
        if (!tabela.prazos.length && !tabelas[tipo].some(t => t.nome === tabela.nome && t.prazos.length)) {
          tabelas[tipo].push(JSON.parse(JSON.stringify(tabela)));
        } else {
          const pendentes = tabela.prazos.filter(prazoPendente);
          if (!pendentes.length) continue;
          let destino = tabelas[tipo].find(t => t.nome === tabela.nome);
          if (!destino) {
            destino = { ...JSON.parse(JSON.stringify(tabela)), prazos: [] };
            tabelas[tipo].push(destino);
          }
          destino.prazos.push(...JSON.parse(JSON.stringify(pendentes)));
        }
      }
    }
    cadastro[nome] = { ...dados, tabelas };
  }
  return cadastro;
}

export function validarCadastroTabelas(base) {
  projetarCadastroFatores(base);
  for (const [banco, dados] of Object.entries(base || {})) {
    if (!dados?.tabelas) continue;
    for (const tipo of ['margem', 'cartao']) {
      const nomes = new Set();
      if (!Array.isArray(dados.tabelas[tipo] ?? [])) throw new Error(`Lista de tabelas inválida em ${banco}.`);
      for (const tabela of dados.tabelas[tipo] || []) {
        const nome = tabela.nome.trim();
        if (!nome) throw new Error(`Informe o nome de todas as tabelas em ${banco}.`);
        if (nomes.has(nome)) throw new Error(`O nome "${nome}" está repetido em ${banco}, ${tipo}.`);
        nomes.add(nome);
        if (!Array.isArray(tabela.prazos) || !tabela.prazos.length) {
          throw new Error(`Adicione pelo menos um prazo na tabela "${nome}" antes de publicar.`);
        }
        const prazos = new Set();
        for (const linha of tabela.prazos) {
          const prazo = Number(linha.prazo);
          if (prazos.has(prazo)) throw new Error(`O prazo ${prazo}x está repetido na tabela "${nome}".`);
          prazos.add(prazo);
        }
      }
    }
  }
}
