export function parseNumeroCalculo(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  let texto = valor.trim().replace(/[^\d,.-]/g, "");
  if (!texto || texto === "-" || texto === "," || texto === ".") return null;

  const ultimaVirgula = texto.lastIndexOf(",");
  const ultimoPonto = texto.lastIndexOf(".");
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    const separadorDecimal = ultimaVirgula > ultimoPonto ? "," : ".";
    const separadorMilhar = separadorDecimal === "," ? /\./g : /,/g;
    texto = texto.replace(separadorMilhar, "");
    if (separadorDecimal === ",") texto = texto.replace(",", ".");
  } else if (ultimaVirgula >= 0) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

export function calcularValorLiberado(parcela, fator) {
  const parcelaNumero = parseNumeroCalculo(parcela);
  const fatorNumero = parseNumeroCalculo(fator);
  if (parcelaNumero === null || fatorNumero === null || fatorNumero <= 0) return null;
  const resultado = parcelaNumero / fatorNumero;
  return Number.isFinite(resultado) && resultado >= 0 ? resultado : null;
}

export function calcularParcela(valorLiberado, fator) {
  const valorNumero = parseNumeroCalculo(valorLiberado);
  const fatorNumero = parseNumeroCalculo(fator);
  if (valorNumero === null || fatorNumero === null || fatorNumero < 0) return null;
  const resultado = valorNumero * fatorNumero;
  return Number.isFinite(resultado) && resultado >= 0 ? resultado : null;
}

export function calcularFator(parcela, valorLiberado) {
  const parcelaNumero = parseNumeroCalculo(parcela);
  const valorNumero = parseNumeroCalculo(valorLiberado);
  if (parcelaNumero === null || valorNumero === null || valorNumero <= 0) return null;
  const resultado = parcelaNumero / valorNumero;
  return Number.isFinite(resultado) && resultado >= 0 ? resultado : null;
}

export function formatarMoedaCalculo(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatarFatorCalculo(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 10,
    useGrouping: false
  });
}
