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
  const grpModosCalculo = rbParcela?.closest(".grp") || rbLiberado?.closest(".grp") || null;
  const lblValorMargem = document.querySelector("label[for='inpValorMargem']");

  const resValor = document.querySelector("#resValor");
  const resPrazo = document.querySelector("#resPrazo");
  const resParcela = document.querySelector("#resParcela");
  const resTaxa = document.querySelector("#resTaxa");
  const resPlano = document.querySelector("#resPlano");
  const resSeguro = document.querySelector("#resSeguro");
  const resLogo = document.querySelector("#resLogoBanco");
  const resParcelaLabel = document.querySelector("#resParcelaLabel");

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

  ocultarLogoResultado();
  atualizarDisponibilidadeCartao();
  atualizarPrazos();
  atualizarSeguros();
  atualizarModoUI();
  atualizarLogoResultado();

  slBanco?.addEventListener("change", () => {
    atualizarDisponibilidadeCartao();
    atualizarPrazos();
    atualizarSeguros();
    atualizarLogoResultado();
  });
  swCartao?.addEventListener("change", () => {
    atualizarPrazos();
    atualizarModosDisponiveis();
    atualizarModoUI();
  });
  rbParcela?.addEventListener("change", atualizarModoUI);
  rbLiberado?.addEventListener("change", atualizarModoUI);
  btnSimular?.addEventListener("click", simular);

  function getCalcMode() {
    if (swCartao?.checked) return MODE_LIBERADO;
    return rbLiberado?.checked ? MODE_LIBERADO : MODE_PARCELA;
  }

  function atualizarModoUI(info = getBancoAtualInfo()) {
    const modo = getCalcMode();
    const isCartao = !!swCartao?.checked && info.temCartao;
    const mostrarMargem = isCartao || modo === MODE_LIBERADO;
    const mostrarValor = !isCartao && modo === MODE_PARCELA;

    if (grpValorDesejado) grpValorDesejado.style.display = mostrarValor ? "" : "none";
    if (grpValorMargem) grpValorMargem.style.display = mostrarMargem ? "" : "none";
    if (inpValorDesejado) inpValorDesejado.disabled = !mostrarValor;
    if (inpValorMargem) inpValorMargem.disabled = !mostrarMargem;
    if (lblValorMargem) lblValorMargem.textContent = isCartao ? "Margem do cartao (R$)" : "Valor da margem (R$)";
    if (resParcelaLabel) resParcelaLabel.textContent = isCartao ? "Margem do cartao:" : "Valor da parcela:";
  }

  function getBancoAtualInfo() {
    const bancoAtual = slBanco ? base[slBanco.value] : null;
    return {
      temCartao: bancoTemCartao(bancoAtual),
      temMargem: bancoTemMargem(bancoAtual)
    };
  }

  function atualizarModosDisponiveis(info = getBancoAtualInfo()) {
    const { temCartao, temMargem } = info;
    const somenteCartao = temCartao && !temMargem;
    const isCartao = !!swCartao?.checked && temCartao;

    if (grpModosCalculo) grpModosCalculo.style.display = somenteCartao ? "none" : "";

    if (somenteCartao) {
      if (rbParcela) {
        rbParcela.checked = false;
        rbParcela.disabled = true;
      }
      if (rbLiberado) {
        rbLiberado.checked = true;
        rbLiberado.disabled = true;
      }
      return;
    }

    if (rbLiberado) rbLiberado.disabled = false;
    if (rbParcela) rbParcela.disabled = false;

    if (isCartao) {
      if (rbParcela) {
        rbParcela.checked = false;
        rbParcela.disabled = true;
      }
      if (rbLiberado) rbLiberado.checked = true;
    } else if (!rbParcela?.checked && !rbLiberado?.checked && rbParcela) {
      rbParcela.checked = true;
    }
  }

  function atualizarDisponibilidadeCartao() {
    if (!slBanco) return;
    const info = getBancoAtualInfo();
    const { temCartao, temMargem } = info;
    const somenteCartao = temCartao && !temMargem;
    const somenteMargem = temMargem && !temCartao;

    if (swCartao && cartaoWrapper) {
      if (!temCartao) {
        cartaoWrapper.style.display = "none";
        swCartao.checked = false;
        swCartao.disabled = true;
      } else {
        cartaoWrapper.style.display = somenteCartao ? "none" : "";
        swCartao.disabled = somenteCartao;
        if (somenteCartao) swCartao.checked = true;
      }

      if (somenteMargem) {
        cartaoWrapper.style.display = "none";
        swCartao.checked = false;
        swCartao.disabled = true;
      }
    }

    atualizarModosDisponiveis(info);
    atualizarModoUI(info);
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

  function atualizarLogoResultado() {
    if (!resLogo || !slBanco) return;
    const nomeBanco = slBanco.value;
    if (!nomeBanco) {
      ocultarLogoResultado();
      return;
    }
    const caminho = obterCaminhoLogoBanco(nomeBanco);
    if (!caminho) {
      ocultarLogoResultado();
      return;
    }
    resLogo.style.display = "";
    resLogo.alt = "Logo " + nomeBanco;
    resLogo.onerror = () => {
      resLogo.onerror = null;
      ocultarLogoResultado();
    };
    resLogo.src = caminho;
  }

  function obterCaminhoLogoBanco(nomeBanco) {
    if (!nomeBanco) return "";
    const banco = base[nomeBanco] || {};
    let arquivo = banco.logoArquivo || banco.logo || "";
    if (!arquivo) {
      const slug = criarSlugLogo(nomeBanco);
      if (!slug) return "";
      arquivo = slug + ".png";
    }
    const resolved = normalizarCaminhoLogo(arquivo);
    return resolved;
  }

  function ocultarLogoResultado() {
    if (!resLogo) return;
    resLogo.style.display = "none";
    resLogo.removeAttribute("src");
    resLogo.alt = "";
  }

  function simular() {
    if (!slBanco || !slPrazo) return;
    const banco = base[slBanco.value];
    if (!banco) return alert("Banco nao encontrado.");

    const datas = Object.keys(banco.fatores).sort((a, b) => new Date(b) - new Date(a));
    if (!datas.length) return alert("Nenhuma data cadastrada para este banco.");

    const dataAtual = datas[0];
    const packAtual = banco.fatores[dataAtual] || {};
    const infoBanco = getBancoAtualInfo();
    const isCartao = !!swCartao?.checked && infoBanco.temCartao;
    const tipo = isCartao ? "cartao" : "margem";
    const estrutura = packAtual?.[tipo];
    if (!Array.isArray(estrutura) || !estrutura.length) return alert("Sem fatores para este tipo.");

    const prazo = parseInt(slPrazo.value, 10);
    if (Number.isNaN(prazo)) return alert("Selecione um prazo valido.");

    const entradaPrazo = estrutura.find(f => parseInt(f.prazo, 10) === prazo);
    if (!entradaPrazo) return alert("Prazo nao encontrado para este banco.");

    const fator = parseFloat(entradaPrazo.fator);
    if (!fator || fator <= 0) return alert("Fator invalido para este prazo.");

    const seguroSelecionado = obterSeguroSelecionado();
    const modo = getCalcMode();

    let valorLiberado = 0;
    let parcelaTotal = 0;
    let taxaTexto = (entradaPrazo.taxa || "").toString().trim();
    let planoTexto = (entradaPrazo.plano || "").toString().trim();
    let custoSeguroDisplay = 0;

    if (isCartao) {
      const margemInformada = parseFloat(inpValorMargem?.value || "0");
      if (!margemInformada || margemInformada <= 0) return alert("Informe o valor da margem.");

      parcelaTotal = margemInformada;
      const produtoFator = margemInformada * fator;
      valorLiberado = Math.max(0, produtoFator * 0.70);
      custoSeguroDisplay = calcularCustoSeguroSobreValor(seguroSelecionado, valorLiberado);
    } else if (modo === MODE_PARCELA) {
      const liquidoDesejado = parseFloat(inpValorDesejado?.value || "0");
      if (!liquidoDesejado || liquidoDesejado <= 0) return alert("Informe um valor liberado valido.");

      const principalBruto = converterLiquidoParaBruto(seguroSelecionado, liquidoDesejado);
      valorLiberado = liquidoDesejado;
      parcelaTotal = principalBruto * fator;
      custoSeguroDisplay = Math.max(0, principalBruto - liquidoDesejado);
    } else {
      const margemInformada = parseFloat(inpValorMargem?.value || "0");
      if (!margemInformada || margemInformada <= 0) return alert("Informe o valor da margem.");

      const principalBruto = margemInformada / fator;
      parcelaTotal = margemInformada;
      valorLiberado = converterBrutoParaLiquido(seguroSelecionado, principalBruto);
      custoSeguroDisplay = Math.max(0, principalBruto - valorLiberado);
    }

    if (isCartao) {
      if (!taxaTexto) taxaTexto = ((fator - 1) * 100).toFixed(2) + "%";
      if (!planoTexto) planoTexto = "Cartao consignado";
    } else {
      if (!taxaTexto) taxaTexto = ((Math.pow(fator, 1 / prazo) - 1) * 100).toFixed(2) + "%";
      if (!planoTexto) planoTexto = "Emprestimo consignado";
    }

    const descricaoSeguro = formatarDescricaoSeguro(seguroSelecionado, custoSeguroDisplay);

    if (resValor) resValor.textContent = formatarMoeda(valorLiberado);
    if (resPrazo) resPrazo.textContent = prazo + "x";
    if (resParcela) resParcela.textContent = formatarMoeda(parcelaTotal);
    if (resTaxa) resTaxa.textContent = taxaTexto || "-";
    if (resPlano) resPlano.textContent = planoTexto || "-";
    if (resSeguro) resSeguro.textContent = descricaoSeguro;
    atualizarLogoResultado();
  }
}

  function bancoTemCartao(banco) {
    if (!banco || !banco.fatores) return false;
    return Object.values(banco.fatores).some(pack => Array.isArray(pack?.cartao) && pack.cartao.some(item => parseFloat(item?.fator)));
  }

function bancoTemMargem(banco) {
  if (!banco || !banco.fatores) return false;
  return Object.values(banco.fatores).some(pack => Array.isArray(pack?.margem) && pack.margem.some(item => parseFloat(item?.fator)));
}

function calcularCustoSeguroSobreValor(seguro, valorBase) {
  if (!seguro) return 0;
  const valor = Number(seguro.valor) || 0;
  if (!valor) return 0;
  if (seguro.tipo === "percentual") {
    return Math.max(0, valorBase * (valor / 100));
  }
  return Math.max(0, valor);
}

function criarSlugLogo(nome) {
  const normalizado = normalizarTexto(nome);
  return normalizado
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizarTexto(txt) {
  return String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizarCaminhoLogo(arquivo) {
  if (!arquivo) return "";
  const trimmed = String(arquivo).trim();
  if (!trimmed) return "";
  if (/^(https?:|data:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) {
    try { return new URL(trimmed, window.location.origin).href; }
    catch { return trimmed; }
  }
  const semPrefixo = trimmed.replace(/^\.\/+/, "").replace(/^\.{2,}\//, "");
  const path = /[\\/]/.test(semPrefixo) ? semPrefixo : `imagens/logos/${semPrefixo}`;
  try {
    return new URL(path, window.location.origin + "/").href;
  } catch {
    return path;
  }
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
