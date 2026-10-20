import {
  calcularFator, calcularParcela, calcularValorLiberado,
  parseNumeroCalculo, formatarFatorCalculo, formatarMoedaCalculo
} from './calculadora-fator.js';

// Os dois últimos campos editados são as entradas; o terceiro é o resultado.
export function initCalculadoraFator({ campos, status, limpar, aoAtualizar = () => {} }) {
  if (Object.values(campos).some(campo => !campo)) return;
  let historico = [];
  function informar(mensagem, erro = false, valido = false) {
    if (status) {
      status.textContent = mensagem;
      status.classList.toggle('is-error', erro);
    }
    aoAtualizar(valido);
  }
  function calcular(editado) {
    const valores = Object.fromEntries(Object.entries(campos).map(([nome, campo]) =>
      [nome, parseNumeroCalculo(campo.value)]));
    const fontes = valores[editado] === null
      ? Object.keys(valores).filter(nome => nome !== editado && valores[nome] !== null)
      : historico.filter(nome => valores[nome] !== null);
    if (fontes.length < 2) {
      informar('Preencha mais um campo para realizar o cálculo.');
      return;
    }
    const destino = Object.keys(campos).find(nome => !fontes.slice(-2).includes(nome));
    if (destino === 'valor' && valores.fator <= 0) {
      informar('O fator precisa ser maior que zero.', true);
      return;
    }
    if (destino === 'fator' && valores.valor <= 0) {
      informar('O valor liberado precisa ser maior que zero.', true);
      return;
    }
    const operacoes = {
      valor: () => calcularValorLiberado(valores.parcela, valores.fator),
      fator: () => calcularFator(valores.parcela, valores.valor),
      parcela: () => calcularParcela(valores.valor, valores.fator)
    };
    const resultado = operacoes[destino]?.();
    if (!Number.isFinite(resultado) || resultado < 0) {
      informar('Confira os valores informados.', true);
      return;
    }
    campos[destino].value = destino === 'fator'
      ? formatarFatorCalculo(resultado) : formatarMoedaCalculo(resultado);
    campos[destino].classList.add('is-calculated');
    window.setTimeout(() => campos[destino].classList.remove('is-calculated'), 320);
    const formulas = {
      valor: 'Valor liberado = parcela ÷ fator',
      fator: 'Fator = parcela ÷ valor liberado',
      parcela: 'Parcela = valor liberado × fator'
    };
    informar(`${formulas[destino]}. Resultado atualizado automaticamente.`, false, true);
  }
  Object.entries(campos).forEach(([nome, campo]) => {
    campo.addEventListener('input', () => {
      historico = historico.filter(item => item !== nome);
      historico.push(nome);
      if (historico.length > 2) historico.shift();
      calcular(nome);
    });
    campo.addEventListener('blur', () => {
      const numero = parseNumeroCalculo(campo.value);
      if (numero !== null) campo.value = nome === 'fator'
        ? formatarFatorCalculo(numero) : formatarMoedaCalculo(numero);
    });
  });
  limpar?.addEventListener('click', () => {
    Object.values(campos).forEach(campo => {
      campo.value = '';
      campo.classList.remove('is-calculated');
    });
    historico = [];
    informar('Use parcela ÷ fator para encontrar o valor liberado.');
    campos.parcela.focus();
  });
}
