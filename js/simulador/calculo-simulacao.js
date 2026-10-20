import { calcularParcela, calcularValorLiberado, parseNumeroCalculo } from './calculadora-fator.js';

// Motor único para a simulação individual e a comparação de condições.
export function calcularCondicaoSimulacao({ informado, fator, porParcela, cartaoTabela, seguro }) {
  informado = parseNumeroCalculo(informado);
  fator = parseNumeroCalculo(fator);
  if (!(informado > 0) || !(fator > 0)) return null;
  let liberado, prestacao, custoSeguro;
  if (cartaoTabela) {
    // Mantém a regra de cartão já utilizada no simulador.
    prestacao = informado;
    liberado = informado * fator * 0.70;
    custoSeguro = seguro ? Number(seguro.valor) * (seguro.tipo === 'percentual' ? liberado / 100 : 1) : 0;
  } else if (porParcela) {
    liberado = informado;
    const bruto = liquidoParaBruto(seguro, informado);
    prestacao = calcularParcela(bruto, fator);
    custoSeguro = bruto - informado;
  } else {
    prestacao = informado;
    const bruto = calcularValorLiberado(informado, fator);
    liberado = brutoParaLiquido(seguro, bruto);
    custoSeguro = bruto - liberado;
  }
  return [liberado, prestacao, custoSeguro].every(n => n !== null && Number.isFinite(n) && n >= 0)
    ? { liberado, prestacao, custoSeguro } : null;
}

function liquidoParaBruto(seguro, liquido) {
  const valor = parseNumeroCalculo(seguro?.valor) || 0;
  if (!valor) return liquido;
  if (seguro.tipo === 'percentual') return valor < 100 ? liquido / (1 - valor / 100) : liquido;
  return liquido + valor;
}

function brutoParaLiquido(seguro, bruto) {
  const valor = parseNumeroCalculo(seguro?.valor) || 0;
  if (!valor) return bruto;
  return Math.max(0, seguro.tipo === 'percentual' ? bruto * (1 - valor / 100) : bruto - valor);
}

export function formatarTaxaSimulacao(valor) {
  if (valor == null || String(valor).trim() === '') return '';
  const numero = parseNumeroCalculo(valor);
  return numero === null ? String(valor).trim()
    : `${numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}
