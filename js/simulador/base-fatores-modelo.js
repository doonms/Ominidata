import { parseNumeroCalculo } from './calculadora-fator.js';

export const BACKUP_FATORES_DATADOS = 'ominidata_base_fatores_antes_unificar_datas_v1';
const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
export const chaveTabelaFator = item => JSON.stringify([Number(item.prazo), String(item.plano ?? item.tabela ?? '').trim()]);

export function temFatoresPorData(base) {
  return objeto(base) && Object.values(base).some(b => objeto(b?.fatores) &&
    Object.keys(b.fatores).some(chave => /^\d{4}-\d{2}-\d{2}$/.test(chave)));
}

export function preservarBackupFatoresDatados(base) {
  if (temFatoresPorData(base) && !localStorage.getItem(BACKUP_FATORES_DATADOS)) {
    localStorage.setItem(BACKUP_FATORES_DATADOS, JSON.stringify({ criadoEm: new Date().toISOString(), bancos: base }));
  }
}

// Formato atual: banco.fatores = { margem: [...], cartao: [...] }.
// JSONs antigos são consolidados por prazo/nome, com a versão mais recente vencendo.
export function normalizarBaseFatores(base, { estrito = false } = {}) {
  if (!objeto(base)) {
    if (estrito) throw new Error('O JSON precisa conter bancos com listas de fatores.');
    return {};
  }
  const saida = {};
  for (const [nome, banco] of Object.entries(base)) {
    if (['__proto__', 'constructor', 'prototype'].includes(nome) || !objeto(banco?.fatores)) {
      if (estrito) throw new Error(`Formato inválido no banco "${nome}". Use um JSON exportado da Base de Fatores.`);
      continue;
    }
    const fatores = banco.fatores;
    const atual = Object.hasOwn(fatores, 'margem') || Object.hasOwn(fatores, 'cartao');
    let blocos;
    if (atual) {
      if (estrito && Object.keys(fatores).some(tipo => !['margem', 'cartao'].includes(tipo))) {
        throw new Error(`Estrutura de fatores inválida em ${nome}. Esperado: margem/cartao.`);
      }
      blocos = [fatores];
    } else {
      const datas = Object.keys(fatores).sort();
      blocos = datas.map(data => {
        const parsed = new Date(`${data}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== data) {
          throw new Error(`Data de fatores inválida no arquivo antigo: ${data}.`);
        }
        return fatores[data];
      });
    }
    const resultado = { margem: [], cartao: [] };
    for (const bloco of blocos) {
      if (!objeto(bloco) || Object.keys(bloco).some(tipo => !['margem', 'cartao'].includes(tipo))) {
        throw new Error(`Estrutura de fatores inválida em ${nome}. Esperado: margem/cartao.`);
      }
      for (const tipo of ['margem', 'cartao']) {
        const lista = bloco[tipo] ?? [];
        if (!Array.isArray(lista)) throw new Error(`Lista ${tipo} inválida em ${nome}.`);
        if (atual) {
          resultado[tipo] = JSON.parse(JSON.stringify(lista));
        } else {
          const porChave = new Map(resultado[tipo].map(item => [chaveTabelaFator(item), item]));
          const vistos = new Map();
          const grupos = new Map();
          for (const item of lista) {
            if (!objeto(item)) throw new Error(`Linha inválida em ${nome}, ${tipo}.`);
            if (estrito) {
              const prazo = parseNumeroCalculo(item.prazo), fator = parseNumeroCalculo(item.fator);
              const taxa = item.taxa === '' || item.taxa == null ? null : parseNumeroCalculo(item.taxa);
              if (!Number.isInteger(prazo) || prazo <= 0 || !(fator > 0) ||
                  (item.taxa !== '' && item.taxa != null && (taxa === null || taxa < 0))) {
                throw new Error(`Prazo, fator ou taxa inválidos em ${nome}, ${tipo}.`);
              }
              const assinatura = JSON.stringify([fator, taxa, item.grupo_fator ?? null]);
              const chave = chaveTabelaFator(item);
              if (vistos.has(chave) && vistos.get(chave) !== assinatura) throw new Error(`Tabelas diferentes com o mesmo nome/prazo em ${nome}. Dê um nome distinto para cada tabela.`);
              vistos.set(chave, assinatura);
              if (item.grupo_fator && grupos.has(item.grupo_fator) && grupos.get(item.grupo_fator) !== fator) {
                throw new Error(`As tabelas vinculadas em ${nome} precisam ter o mesmo fator.`);
              }
              if (item.grupo_fator) grupos.set(item.grupo_fator, fator);
            }
            porChave.set(chaveTabelaFator(item), { ...item });
          }
          resultado[tipo] = [...porChave.values()];
        }
      }
    }
    if (!atual) {
      // Um vínculo copiado entre datas pode juntar versões com fatores distintos.
      // Não se escolhe um fator por conta do vínculo: os valores mais recentes são mantidos.
      for (const lista of Object.values(resultado)) {
        const grupos = new Map();
        lista.forEach(item => {
          if (item.grupo_fator) {
            const membros = grupos.get(item.grupo_fator) || [];
            membros.push(item);
            grupos.set(item.grupo_fator, membros);
          }
        });
        grupos.forEach(membros => {
          if (new Set(membros.map(item => parseNumeroCalculo(item.fator))).size > 1) {
            membros.forEach(item => { item.grupo_fator = null; });
          }
        });
      }
    }
    saida[nome] = { ...JSON.parse(JSON.stringify(banco)), fatores: resultado };
  }
  return saida;
}
