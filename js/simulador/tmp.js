// === Simulador INSS Ominidata ===
// Usa os fatores gravados em localStorage (base_fatores_v1)

import { BASE_FATORES_KEY, BASE_FATORES_FALLBACKS, readFromStorage } from "../config/storageKeys.js";

const MODE_PARCELA = "parcela";
const MODE_LIBERADO = "liberado";

function carregarBaseFatores() {
  const base = readFromStorage(BASE_FATORES_KEY, BASE_FATORES_FALLBACKS);
  return base && typeof base === "object" && !Array.isArray(base) ? base : {};
}

export function initSimulador() {
  const slBanco = document.querySelector("#slBanco");
  const slPrazo = document.querySelector("#slPrazo");
  const slSeguro = document.querySelector("#slSeguro");
  const inpValorDesejado = document.querySelector("#inpValorDesejado");
  const inpValorMargem = document.querySelector("#inpValorMargem");
  const rbParcela = document.querySelector("#modoParcela");
  const rbLiberado = document.querySelector("#modoLiberado");
  const grpValorDesejado = document.querySelector("#grpValorDesejado");
  const grpValorMargem = document.querySelector("#grpValorMargem");
  const swCartao = document.querySelector("#swCartao");
  const cartaoWrapper = document.querySelector("#grpCartaoSwitch");
  const btnSimular = document.querySelector("#btnSimular");

  const resValor = document.querySelector("#resValor");
  const resPrazo = document.querySelector("#resPrazo");
  const resParcela = document.querySelector("#resParcela");
  const resTaxa = document.querySelector("#resTaxa");
  const resPlano = document.querySelector("#resPlano");
  const resSeguro = document.querySelector("#resSeguro");

  const base = carregarBaseFatores();
  const bancos = Object.keys(base);
  if (!bancos.length) {
    if (slBanco) slBanco.innerHTML = "<option disabled>Nenhum banco cadastrado</option>";
    return;
  }

  if (slBanco) {
    slBanco.innerHTML = bancos.map(b => `<option value="${b}">${b}</option>`).join("");
    if (!slBanco.value) slBanco.value = bancos[0];
  }

  atualizarDisponibilidadeCartao();
  atualizarPrazos();
  atualizarSeguros();
  atualizarModoUI();

  slBanco?.addEventListener("change", () => {
    atualizarDisponibilidadeCartao();
    atualizarPrazos();
    atualizarSeguros();
  });
  swCartao?.addEventListener("change", atualizarPrazos);
  rbParcela?.addEventListener("change", atualizarModoUI);
  rbLiberado?.addEventListener("change", atualizarModoUI);
  btnSimular?.addEventListener("click", simular);

  function getCalcMode() {
    return rbLiberado?.checked ? MODE_LIBERADO : MODE_PARCELA;
  }

  function atualizarModoUI() {
    const modo = getCalcMode();
    if (grpValorDesejado) grpValorDesejado.style.display = modo === MODE_PARCELA ? "" : "none";
    if (grpValorMargem) grpValorMargem.style.display = modo === MODE_LIBERADO ? "" : "none";
    if (inpValorDesejado) inpValorDesejado.disabled = modo === MODE_LIBERADO;
    if (inpValorMargem) inpValorMargem.disabled = modo === MODE_PARCELA;
  }

  function atualizarDisponibilidadeCartao() {
    if (!swCartao || !cartaoWrapper || !slBanco) return;
    const banco = base[slBanco.value];
    const temCartao = bancoTemCartao(banco);
    if (!temCartao) {
      cartaoWrapper.style.display = "none";
      swCartao.checked = false;
      swCartao.disabled = true;
    } else {
      cartaoWrapper.style.display = "";
      swCartao.disabled = false;
    }
  }

  function atualizarPrazos() {
    if (!slBanco || !slPrazo) return;
    const banco = base[slBanco.value];
    if (!banco || !banco.fatores) {
      slPrazo.innerHTML = "<option disabled>Nenhum prazo disponivel</option>";
      return;
    }

    const datas = Object.keys(banco.fatores).sort((a, b) => new Date(b) - new Date(a));
    if (!datas.length) {
      slPrazo.innerHTML = "<option disabled>Nenhum prazo disponivel</option>";
      return;
    }

    const data = datas[0];
    const estrutura = banco.fatores[data] || {};
    let tipoAtual = swCartao?.checked ? "cartao" : "margem";
    let lista = Array.isArray(estrutura[tipoAtual]) ? estrutura[tipoAtual] : [];

    if (!lista.length && tipoAtual === "cartao") {
      swCartao.checked = false;
      tipoAtual = "margem";
      lista = Array.isArray(estrutura[tipoAtual]) ? estrutura[tipoAtual] : [];
    }

    if (!lista.length) {
      slPrazo.innerHTML = "<option disabled>Nenhum prazo disponivel</option>";
      return;
    }

    slPrazo.innerHTML = lista.map(f => `<option value="${f.prazo}">${f.prazo}x</option>`).join("");
    slPrazo.value = String(lista[0].prazo ?? "");
  }

  function atualizarSeguros() {
    if (!slBanco || !slSeguro) return;
    const banco = base[slBanco.value];
    slSeguro.innerHTML = '<option value="">Sem seguro</option>';
    slSeguro.disabled = true;

    const lista = Array.isArray(banco?.seguros) ? banco.seguros : [];
    if (!lista.length) {
      if (resSeguro) resSeguro.textContent = "Sem seguro";
      return;
    }

    lista.forEach((seg, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      const valor = Number(seg?.valor) || 0;
      const sufixo = seg?.tipo === "percentual"
        ? " (" + valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%)"
        : " (" + formatarMoeda(valor) + ")";
      opt.textContent = (seg?.nome || "Seguro " + (idx + 1)) + sufixo;
      slSeguro.appendChild(opt);
    });

    slSeguro.disabled = false;
    slSeguro.value = "";
    if (resSeguro) resSeguro.textContent = "Sem seguro";
  }

  function obterSeguroSelecionado() {
    if (!slBanco || !slSeguro) return null;
    const idx = parseInt(slSeguro.value, 10);
    if (Number.isNaN(idx)) return null;
    const banco = base[slBanco.value];
    const lista = Array.isArray(banco?.seguros) ? banco.seguros : [];
    return lista[idx] || null;
  }

  function simular() {
    if (!slBanco || !slPrazo) return;
    const banco = base[slBanco.value];
    if (!banco) return alert("Banco nao encontrado.");

    const datas = Object.keys(banco.fatores).sort((a, b) => new Date(b) - new Date(a));
    if (!datas.length) return alert("Nenhuma data cadastrada para este banco.");

    const dataAtual = datas[0];
    const packAtual = banco.fatores[dataAtual] || {};
    const isCartao = !!swCartao?.checked;
    const tipo = isCartao ? "cartao" : "margem";
    const estrutura = packAtual?.[tipo];
    if (!Array.isArray(estrutura) || !estrutura.length) return alert("Sem fatores para este tipo.");

    const prazo = parseInt(slPrazo.value, 10);
    if (Number.isNaN(prazo)) return alert("Selecione um prazo valido.");

    const entradaPrazo = estrutura.find(f => parseInt(f.prazo, 10) === prazo);
    if (!entradaPrazo) return alert("Prazo nao encontrado para este banco.");

    const fator = parseFloat(entradaPrazo.fator);
    if (!fator || fator <= 0) return alert("Fator invalido para este prazo.");

    const temMargemDisponivel = Array.isArray(packAtual?.margem)
      && packAtual.margem.some(item => parseFloat(item?.fator));
    const bancoSemMargem = !temMargemDisponivel;

    const seguroSelecionado = obterSeguroSelecionado();
    const modo = getCalcMode();

    const custoSeguroPorLiquido = valorLiquido => {
      if (!seguroSelecionado) return 0;
      const bruto = converterLiquidoParaBruto(seguroSelecionado, valorLiquido);
      return Math.max(0, bruto - valorLiquido);
    };

    const custoSeguroPorBruto = valorBruto => {
      if (!seguroSelecionado) return 0;
      const liquido = converterBrutoParaLiquido(seguroSelecionado, valorBruto);
      return Math.max(0, valorBruto - liquido);
    };

    let valorLiberado = 0;
    let parcelaTotal = 0;
    let taxaTexto = (entradaPrazo.taxa || "").toString().trim();
    let planoTexto = (entradaPrazo.plano || "").toString().trim();
    let custoSeguro = 0;

    if (modo === MODE_PARCELA) {
      const liquidoDesejado = parseFloat(inpValorDesejado?.value || "0");
      if (!liquidoDesejado || liquidoDesejado <= 0) return alert("Informe um valor liberado valido.");

      valorLiberado = liquidoDesejado;
      let principalParaCalculo = liquidoDesejado;

      if (!isCartao) {
        principalParaCalculo = converterLiquidoParaBruto(seguroSelecionado, liquidoDesejado);
      }

      parcelaTotal = principalParaCalculo * fator;
      custoSeguro = isCartao
        ? custoSeguroPorLiquido(valorLiberado)
        : Math.max(0, principalParaCalculo - valorLiberado);
    } else {
      const margemInformada = parseFloat(inpValorMargem?.value || "0");
      if (!margemInformada || margemInformada <= 0) return alert("Informe o valor da margem.");

      if (isCartao && bancoSemMargem) {
        const margemCartao = margemInformada * 0.30;
        parcelaTotal = margemCartao;
        valorLiberado = fator * margemCartao;
        custoSeguro = custoSeguroPorLiquido(valorLiberado);
      } else {
        const principalBruto = margemInformada / fator;
        parcelaTotal = margemInformada;

        if (isCartao) {
          valorLiberado = principalBruto;
          custoSeguro = custoSeguroPorBruto(principalBruto);
        } else {
          valorLiberado = converterBrutoParaLiquido(seguroSelecionado, principalBruto);
          custoSeguro = Math.max(0, principalBruto - valorLiberado);
        }
      }
    }

    if (isCartao) {
      if (!taxaTexto) taxaTexto = ((fator - 1) * 100).toFixed(2) + "%";
      if (!planoTexto) planoTexto = "Cartao consignado";
    } else {
      if (!taxaTexto) taxaTexto = ((Math.pow(fator, 1 / prazo) - 1) * 100).toFixed(2) + "%";
      if (!planoTexto) planoTexto = "Emprestimo consignado";
    }

    const descricaoSeguro = formatarDescricaoSeguro(seguroSelecionado, custoSeguro);

    if (resValor) resValor.textContent = formatarMoeda(valorLiberado);
    if (resPrazo) resPrazo.textContent = prazo + "x";
    if (resParcela) resParcela.textContent = formatarMoeda(parcelaTotal);
    if (resTaxa) resTaxa.textContent = taxaTexto || "-";
    if (resPlano) resPlano.textContent = planoTexto || "-";
    if (resSeguro) resSeguro.textContent = descricaoSeguro;
  }
}

function bancoTemCartao(banco) {
  if (!banco || !banco.fatores) return false;
  return Object.values(banco.fatores).some(pack => Array.isArray(pack?.cartao) && pack.cartao.some(item => parseFloat(item?.fator)));
}

function converterLiquidoParaBruto(seguro, liquido) {
  if (!seguro) return liquido;
  const valor = Number(seguro.valor) || 0;
  if (!valor) return liquido;
  if (seguro.tipo === "percentual") {
    const percent = valor / 100;
    if (percent >= 1) return liquido;
    return liquido / (1 - percent);
  }
  return liquido + valor;
}

function converterBrutoParaLiquido(seguro, bruto) {
  if (!seguro) return bruto;
  const valor = Number(seguro.valor) || 0;
  if (!valor) return bruto;
  if (seguro.tipo === "percentual") {
    const percent = valor / 100;
    return Math.max(0, bruto * (1 - percent));
  }
  return Math.max(0, bruto - valor);
}

function formatarDescricaoSeguro(seguro, custo) {
  if (!seguro) return "Sem seguro";
  const valor = Number(seguro.valor) || 0;
  const nome = seguro.nome || "Seguro";
  if (!valor) return nome;
  if (seguro.tipo === "percentual") {
    return nome + " (" + valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% - " + formatarMoeda(custo) + ")";
  }
  return nome + " (" + formatarMoeda(valor) + ")";
}

function formatarMoeda(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

