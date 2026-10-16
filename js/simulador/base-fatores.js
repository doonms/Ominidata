import { BASE_FATORES_KEY, BASE_FATORES_FALLBACKS, BASE_FATORES_MIRRORS, readFromStorage, writeToStorage } from '../config/storageKeys.js';
import { carregarFatoresRemotos, enviarFatoresRemotos, mesclarFatoresRemotos,
  mesclarArquivoFatores, mensagemErroFatores, prepararFatores } from '../api/baseFatoresApi.js';
import {
  calcularFator,
  calcularParcela,
  calcularValorLiberado,
  formatarFatorCalculo as formatarFator,
  formatarMoedaCalculo as formatarMoedaManual,
  parseNumeroCalculo as parseNumeroManual
} from './calculadora-fator.js';
// === Base de Fatores (Simulador Limpo) ===
// Controle de INSS, margem/cartão, seguros e calendário.

let state = {
  bancos: {},
  bancoAtual: null,
  dataAtual: null,
  keyStorage: BASE_FATORES_KEY,
  lastSave: null,
  filtroBanco: ""
};
let versaoLocal = 0;

function informarSincronizacao(texto, erro = false) {
  const status = document.getElementById('bf-sync-status');
  if (!status) return;
  status.textContent = texto;
  status.setAttribute('role', erro ? 'alert' : 'status');
}

function guardarBackupLocal() {
  if (Object.keys(state.bancos).length) {
    localStorage.setItem('ominidata_base_fatores_backup_v1', JSON.stringify({
      data: new Date().toISOString(), bancos: state.bancos
    }));
  }
}

const DEFAULT_SELECTORS = {
  slBanco: '#bf-slBanco',
  logo: '#bf-logoBanco',
  data: '#bf-data',
  infoData: '#bf-infoData',
  swMargem: '#bf-swMargem',
  swCartao: '#bf-swCartao',
  blocoMargem: '#bf-blocoMargem',
  listaPrazosMargem: '#bf-listaPrazosMargem',
  addPrazoMargem: '#bf-addPrazoMargem',
  blocoCartao: '#bf-blocoCartao',
  listaPrazosCartao: '#bf-listaPrazosCartao',
  addPrazoCartao: '#bf-addPrazoCartao',
  listaSeguros: '#bf-listaSeguros',
  addSeguro: '#bf-addSeguro',
  btnNovo: '#bf-novoBanco',
  btnRemover: '#bf-removerBanco',
  btnSalvar: '#bf-salvarBanco',
  btnImportar: '#bf-importarBanco',
  btnExportar: '#bf-exportarBanco',
  btnLimparAntigos: '#bf-limparAntigos',
  buscaBanco: '#bf-buscaBanco',
  calcParcela: '#bf-calcParcela',
  calcFator: '#bf-calcFator',
  calcValor: '#bf-calcValor',
  calcStatus: '#bf-calcStatus',
  calcLimpar: '#bf-calcLimpar'
};

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

// ⚙️ Função para enviar os dados da base de fatores para o Supabase
async function uploadBaseFatores(file, els) {
  const botao = document.getElementById('uploadBaseBtn');
  try {
    if (!file) {
      alert('Selecione um arquivo JSON para enviar.');
      return;
    }

    if (botao) botao.disabled = true;
    const baseFatores = await readJsonFile(file);
    prepararFatores(baseFatores);
    guardarBackupLocal();
    state.bancos = mesclarArquivoFatores(baseFatores, state.bancos);
    saveState();
    state.filtroBanco = '';
    if (els.buscaBanco) els.buscaBanco.value = '';
    syncBancoSelecionado(els, renderBancoSelect(els));
    selectBanco(els);
    informarSincronizacao('Arquivo preservado neste navegador. Enviando fatores ao Supabase…');
    const resultado = await enviarFatoresRemotos(baseFatores);
    if (!els.slBanco.isConnected) return;
    renderBaseFatores(resultado.linhas, els);
    informarSincronizacao(`${resultado.quantidade} fatores confirmados no Supabase. Registros ausentes no arquivo foram mantidos. Seguros e logos continuam locais.`);
    alert(`✅ ${resultado.quantidade} fatores enviados/atualizados e confirmados no Supabase. Os demais registros foram mantidos.`);
  } catch (error) {
    console.error('Erro ao enviar base:', error);
    const mensagem = `Não foi possível confirmar o envio. ${mensagemErroFatores(error)}`;
    if (els.slBanco.isConnected) informarSincronizacao(mensagem, true);
    alert(mensagem);
  } finally {
    if (botao) botao.disabled = false;
  }
}

export function initBaseFatores(cfg = {}) {
  const els = mapEls(cfg.els ?? DEFAULT_SELECTORS);
  const uploadBtn = document.getElementById('uploadBaseBtn');
  const uploadInput = document.getElementById('uploadBaseFile');

  // 🔘 Evento do botão
  if (uploadBtn && uploadInput) {
    uploadBtn.onclick = () => uploadInput.click();
    uploadInput.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await uploadBaseFatores(file, els);
      event.target.value = '';
    };
  }

  // Carregar do localStorage
  loadState();

  // preencher select de bancos
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);

  // eventos
  if (els.slBanco) els.slBanco.onchange = () => selectBanco(els);
  if (els.btnNovo) els.btnNovo.onclick = () => novoBanco(els);
  if (els.btnRemover) els.btnRemover.onclick = () => removerBanco(els);
  if (els.btnSalvar) els.btnSalvar.onclick = () => salvarTudo();
  if (els.btnImportar) els.btnImportar.onclick = () => importarJSON(els);
  if (els.btnExportar) els.btnExportar.onclick = () => exportarJSON();
  if (els.data) els.data.onchange = () => mudarData(els);
  if (els.swMargem) els.swMargem.onchange = () => toggleMargem(els);
  if (els.swCartao) els.swCartao.onchange = () => toggleCartao(els);
  if (els.addPrazoMargem) els.addPrazoMargem.onclick = () => addPrazo(els, "margem");
  if (els.addPrazoCartao) els.addPrazoCartao.onclick = () => addPrazo(els, "cartao");
  if (els.btnLimparAntigos) els.btnLimparAntigos.onclick = limparAntigos;
  if (els.buscaBanco) els.buscaBanco.oninput = () => filtrarBancos(els);

  initCalculadoraManual(els);

  // render inicial
  selectBanco(els);

  carregarBaseFatoresRemota(els);
}

function mapEls(map) {
  const out = {};
  for (const k in map) out[k] = document.querySelector(map[k]);
  return out;
}

function initCalculadoraManual(els) {
  const campos = {
    parcela: els.calcParcela,
    fator: els.calcFator,
    valor: els.calcValor
  };
  if (!campos.parcela || !campos.fator || !campos.valor) return;

  let historico = [];

  Object.entries(campos).forEach(([nome, campo]) => {
    campo.addEventListener("input", () => {
      historico = historico.filter(item => item !== nome);
      historico.push(nome);
      if (historico.length > 2) historico.shift();
      calcularCampoManual(campos, historico, nome, els.calcStatus);
    });

    campo.addEventListener("blur", () => {
      const numero = parseNumeroManual(campo.value);
      if (numero === null) return;
      campo.value = nome === "fator" ? formatarFator(numero) : formatarMoedaManual(numero);
    });
  });

  if (els.calcLimpar) {
    els.calcLimpar.addEventListener("click", () => {
      Object.values(campos).forEach(campo => { campo.value = ""; });
      historico = [];
      atualizarStatusCalculadora(
        els.calcStatus,
        "Use parcela ÷ fator para encontrar o valor liberado."
      );
      campos.parcela.focus();
    });
  }
}

function calcularCampoManual(campos, historico, campoEditado, status) {
  const valores = {
    parcela: parseNumeroManual(campos.parcela.value),
    fator: parseNumeroManual(campos.fator.value),
    valor: parseNumeroManual(campos.valor.value)
  };

  let fontes;
  if (valores[campoEditado] === null) {
    fontes = Object.keys(valores).filter(nome => nome !== campoEditado && valores[nome] !== null);
  } else {
    fontes = historico.filter(nome => valores[nome] !== null);
  }

  if (fontes.length < 2) {
    atualizarStatusCalculadora(status, "Preencha mais um campo para realizar o cálculo.");
    return;
  }

  const chaves = new Set(fontes.slice(-2));
  let destino;
  if (chaves.has("parcela") && chaves.has("fator")) destino = "valor";
  if (chaves.has("parcela") && chaves.has("valor")) destino = "fator";
  if (chaves.has("fator") && chaves.has("valor")) destino = "parcela";
  if (!destino) return;

  let resultado;
  let mensagem;
  if (destino === "valor") {
    if (valores.fator <= 0) {
      atualizarStatusCalculadora(status, "O fator precisa ser maior que zero.", true);
      return;
    }
    resultado = calcularValorLiberado(valores.parcela, valores.fator);
    mensagem = "Valor liberado = parcela ÷ fator";
  } else if (destino === "fator") {
    if (valores.valor <= 0) {
      atualizarStatusCalculadora(status, "O valor liberado precisa ser maior que zero.", true);
      return;
    }
    resultado = calcularFator(valores.parcela, valores.valor);
    mensagem = "Fator = parcela ÷ valor liberado";
  } else {
    resultado = calcularParcela(valores.valor, valores.fator);
    mensagem = "Parcela = valor liberado × fator";
  }

  if (!Number.isFinite(resultado) || resultado < 0) {
    atualizarStatusCalculadora(status, "Confira os valores informados.", true);
    return;
  }

  campos[destino].value = destino === "fator"
    ? formatarFator(resultado)
    : formatarMoedaManual(resultado);
  campos[destino].classList.add("is-calculated");
  window.setTimeout(() => campos[destino].classList.remove("is-calculated"), 320);
  atualizarStatusCalculadora(status, `${mensagem}. Resultado atualizado automaticamente.`);
}

function atualizarStatusCalculadora(elemento, mensagem, erro = false) {
  if (!elemento) return;
  elemento.textContent = mensagem;
  elemento.classList.toggle("is-error", erro);
}

function loadState() {
  state.keyStorage = BASE_FATORES_KEY;
  const data = readFromStorage(BASE_FATORES_KEY, BASE_FATORES_FALLBACKS);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    state.bancos = Object.fromEntries(Object.entries(data).filter(([, banco]) => banco?.fatores));
    writeToStorage(state.keyStorage, state.bancos, BASE_FATORES_MIRRORS);
  } else {
    state.bancos = {};
  }
}

function saveState() {
  writeToStorage(state.keyStorage, state.bancos, BASE_FATORES_MIRRORS);
  state.lastSave = new Date();
  versaoLocal++;
}

function renderBancoSelect(els) {
  const sl = els.slBanco;
  sl.innerHTML = "";
  const nomes = getBancosFiltrados();
  nomes.forEach(nome => {
    const o = document.createElement("option");
    o.value = nome;
    o.textContent = nome;
    sl.appendChild(o);
  });
  return nomes;
}

function syncBancoSelecionado(els, nomes) {
  let ativo = state.bancoAtual;
  if (!ativo || !nomes.includes(ativo)) ativo = nomes[0] || "";
  els.slBanco.value = ativo;
  state.bancoAtual = ativo || null;
  if (!ativo) limparInterface(els);
  return ativo;
}

function filtrarBancos(els) {
  state.filtroBanco = normalizarTexto(els.buscaBanco.value || "");
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);
  selectBanco(els);
}

function removerBanco(els) {
  const nome = state.bancoAtual;
  if (!nome) {
    alert("Nenhum banco selecionado");
    return;
  }
  if (!confirm(`Remover banco "${nome}"?`)) return;
  delete state.bancos[nome];
  saveState();
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);
  selectBanco(els);
}

function selectBanco(els) {
  const nome = els.slBanco.value;
  state.bancoAtual = nome || null;
  if (!nome) {
    limparInterface(els);
    return;
  }
  if (!state.bancos[nome]) {
    state.bancos[nome] = { fatores: {}, seguros: [] };
  }
  const b = state.bancos[nome];
  renderBanco(b, els);
}

function renderBaseFatores(baseFatoresRows, els) {
  if (!baseFatoresRows?.length) return;
  const bancos = mesclarFatoresRemotos(baseFatoresRows, state.bancos);
  guardarBackupLocal();
  state.bancos = bancos;
  saveState();
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);
  selectBanco(els);
}

function renderBanco(b, els) {
  if (els.btnRemover) els.btnRemover.disabled = false;
  atualizarLogo(els, state.bancoAtual);
  let data = state.dataAtual;
  if (!data || !b.fatores[data]) {
    const ultima = getUltimaData(b);
    if (ultima) {
      data = ultima;
    } else {
      data = getHojeISO();
      if (!b.fatores[data]) b.fatores[data] = novaEstrutura();
      saveState();
    }
  }
  els.data.value = data;
  state.dataAtual = data;
  els.infoData.textContent = `Data: ${data}`;
  aplicarSwitchesBanco(b, els, data);
  renderFatores(b, els);
  renderSeguros(b, els);
}

function aplicarSwitchesBanco(b, els, data) {
  if (!b) return;
  if (!els.swMargem && !els.swCartao) return;
  const fatores = b.fatores?.[data] || novaEstrutura();
  const fazMargem = b.hasOwnProperty("fazMargem")
    ? !!b.fazMargem
    : (fatores.margem?.length ?? 0) > 0;
  const fazCartao = b.hasOwnProperty("fazCartao")
    ? !!b.fazCartao
    : (fatores.cartao?.length ?? 0) > 0;

  if (els.swMargem) {
    els.swMargem.checked = fazMargem;
    toggleMargem(els);
  }
  if (els.swCartao) {
    els.swCartao.checked = fazCartao;
    toggleCartao(els);
  }
}

function novoBanco(els) {
  let nome = prompt("Nome do novo banco:");
  if (!nome) return;
  nome = nome.trim();
  if (!nome) return;
  if (state.bancos[nome]) return alert("Banco ja existe");
  state.bancos[nome] = { fatores: {}, seguros: [] };
  saveState();
  state.filtroBanco = "";
  if (els.buscaBanco) els.buscaBanco.value = "";
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);
  els.slBanco.value = nome;
  selectBanco(els);
}

function mudarData(els) {
  const d = els.data.value;
  if (!d) return;
  state.dataAtual = d;
  const b = getBancoAtual();
  if (!b.fatores[d]) {
    // clonar da data mais recente
    const ult = getUltimaData(b);
    if (ult) b.fatores[d] = JSON.parse(JSON.stringify(b.fatores[ult]));
    else b.fatores[d] = novaEstrutura();
  }
  aplicarSwitchesBanco(b, els, d);
  renderFatores(b, els);
}

function toggleMargem(els) {
  const ativo = els.swMargem.checked;
  const b = getBancoAtual();
  if (b) {
    b.fazMargem = ativo;
    saveState();
  }
  els.blocoMargem.style.display = ativo ? "block" : "none";
}

function toggleCartao(els) {
  const ativo = els.swCartao.checked;
  const b = getBancoAtual();
  if (b) {
    b.fazCartao = ativo;
    saveState();
  }
  els.blocoCartao.style.display = ativo ? "block" : "none";
}

function addPrazo(els, tipo) {
  const b = getBancoAtual();
  const d = state.dataAtual;
  if (!b.fatores[d]) b.fatores[d] = novaEstrutura();
  const arr = b.fatores[d][tipo];
  arr.push({ prazo: "", fator: "", taxa: "", plano: "" });
  renderFatores(b, els);
}

function renderFatores(b, els) {
  const d = state.dataAtual;
  if (!b.fatores[d]) b.fatores[d] = novaEstrutura();

  const m = els.listaPrazosMargem;
  const c = els.listaPrazosCartao;
  m.innerHTML = "";
  c.innerHTML = "";

  b.fatores[d].margem.forEach((f, i) => m.appendChild(renderLinhaPrazo(f, i, "margem", b, els)));
  b.fatores[d].cartao.forEach((f, i) => c.appendChild(renderLinhaPrazo(f, i, "cartao", b, els)));
}

function renderLinhaPrazo(f, idx, tipo, b, els) {
  const div = document.createElement("div");
  div.className = "factor-row";
  if (typeof f.taxa !== "string") f.taxa = f.taxa != null ? String(f.taxa) : "";
  if (typeof f.plano !== "string") f.plano = f.plano != null ? String(f.plano) : "";
  div.innerHTML = `
    <input type="number" class="prazo" placeholder="Prazo" value="${f.prazo ?? ""}" />
    <input type="number" step="0.0001" class="fator" placeholder="Fator" value="${f.fator ?? ""}" />
    <input type="text" class="taxa" placeholder="Taxa" value="${f.taxa ?? ""}" />
    <input type="text" class="plano" placeholder="Plano/Tabela" value="${f.plano ?? ""}" />
    <button class="danger small">Remover</button>
  `;
  const [inPrazo, inFator, inTaxa, inPlano, bt] = div.children;
  inPrazo.addEventListener("input", () => { f.prazo = parseInt(inPrazo.value) || ""; saveState(); });
  inFator.addEventListener("input", () => { f.fator = parseFloat(inFator.value) || ""; saveState(); });
  inTaxa.addEventListener("input", () => { f.taxa = inTaxa.value; saveState(); });
  inPlano.addEventListener("input", () => { f.plano = inPlano.value; saveState(); });
  bt.addEventListener("click", () => {
    b.fatores[state.dataAtual][tipo].splice(idx, 1);
    renderFatores(b, els);
    saveState();
  });
  return div;
}

function renderSeguros(b, els) {
  const list = els.listaSeguros;
  list.innerHTML = "";
  const segs = b.seguros = b.seguros || [];
  let atualizouTipo = false;

  segs.forEach((s, i) => {
    const tipo = s.tipo === "percentual" ? "percentual" : "fixo";
    if (s.tipo !== tipo) {
      s.tipo = tipo;
      atualizouTipo = true;
    }

    const row = document.createElement("div");
    row.className = "seguro-row";
    row.innerHTML = `
      <input value="${s.nome || ""}" placeholder="Nome do seguro"/>
      <select>
        <option value="fixo" ${tipo === "fixo" ? "selected" : ""}>Fixo (R$)</option>
        <option value="percentual" ${tipo === "percentual" ? "selected" : ""}>Percentual (%)</option>
      </select>
      <input type="number" value="${s.valor ?? ""}" step="0.01" placeholder="${tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}"/>
      <button class="danger small">Remover</button>
    `;

    const [inNome, inTipo, inValor, btRemover] = row.children;

    inNome.addEventListener("input", () => {
      s.nome = inNome.value;
      saveState();
    });

    inTipo.addEventListener("change", () => {
      const novoTipo = inTipo.value === "percentual" ? "percentual" : "fixo";
      s.tipo = novoTipo;
      ajustarPlaceholderSeguro(inValor, novoTipo);
      saveState();
    });

    inValor.addEventListener("input", () => {
      const valor = parseFloat(inValor.value);
      s.valor = Number.isNaN(valor) ? "" : valor;
      saveState();
    });

    ajustarPlaceholderSeguro(inValor, tipo);

    btRemover.addEventListener("click", () => {
      b.seguros.splice(i, 1);
      renderSeguros(b, els);
      saveState();
    });

    list.appendChild(row);
  });

  if (atualizouTipo) saveState();

  if (els.addSeguro) {
    els.addSeguro.onclick = () => {
      b.seguros.push({ nome: "", valor: "", tipo: "fixo" });
      renderSeguros(b, els);
      saveState();
    };
  }
}

function ajustarPlaceholderSeguro(input, tipo) {
  if (!input) return;
  if (tipo === "percentual") {
    input.placeholder = "Percentual (%)";
    input.step = "0.01";
  } else {
    input.placeholder = "Valor (R$)";
    input.step = "0.01";
  }
}

function importarJSON(els) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json";
  inp.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        prepararFatores(data);
        guardarBackupLocal();
        state.bancos = mesclarArquivoFatores(data, state.bancos);
        state.filtroBanco = "";
        if (els.buscaBanco) els.buscaBanco.value = "";
        saveState();
        const nomes = renderBancoSelect(els);
        syncBancoSelecionado(els, nomes);
        selectBanco(els);
        informarSincronizacao('JSON importado somente neste navegador. Use “Enviar base ao Supabase” para disponibilizar os fatores aos outros usuários.');
        alert("Importado neste navegador. Para publicar, use Enviar base ao Supabase.");
      } catch (err) {
        console.error("Erro ao importar JSON", err);
        alert(`Erro ao importar JSON: ${mensagemErroFatores(err)}`);
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function exportarJSON() {
  const blob = new Blob([JSON.stringify(state.bancos, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `base-fatores-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function salvarTudo() {
  saveState();
  informarSincronizacao('Alterações salvas neste navegador. Para publicar: exporte o JSON e use “Enviar base ao Supabase”.');
  alert("Salvo neste navegador. Para publicar, exporte o JSON e use Enviar base ao Supabase.");
}

function limparAntigos() {
  const hoje = new Date();
  Object.values(state.bancos).forEach(b => {
    Object.keys(b.fatores).forEach(d => {
      const diff = (hoje - new Date(d)) / (1000 * 60 * 60 * 24);
      if (diff > 30) delete b.fatores[d];
    });
  });
  saveState();
  alert("Fatores antigos removidos (>30 dias)");
}

function getBancoAtual() { return state.bancos[state.bancoAtual]; }

function getUltimaData(b) {
  const datas = Object.keys(b.fatores).sort((a, b) => new Date(b) - new Date(a));
  return datas[0];
}

function getBancosFiltrados() {
  const nomes = Object.keys(state.bancos).sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (!state.filtroBanco) return nomes;
  return nomes.filter(nome => normalizarTexto(nome).includes(state.filtroBanco));
}

function getHojeISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function carregarBaseFatoresRemota(els) {
  const versaoInicial = versaoLocal;
  informarSincronizacao('Consultando fatores do Supabase… Os dados locais foram mantidos.');
  try {
    const baseFatores = await carregarFatoresRemotos();
    if (!els.slBanco.isConnected) return;
    if (versaoLocal !== versaoInicial) {
      informarSincronizacao('Suas alterações locais foram mantidas; a consulta em segundo plano não as sobrescreveu.');
      return;
    }
    if (!baseFatores.length) {
      informarSincronizacao('O Supabase não retornou fatores visíveis para esta sessão. Dados locais preservados; confira uploads e permissões de leitura.');
      return;
    }
    renderBaseFatores(baseFatores, els);
    informarSincronizacao(`${baseFatores.length} fatores consultados no Supabase. Seguros, logos e registros locais foram preservados.`);
  } catch (err) {
    console.error('Erro inesperado ao carregar base do Supabase:', err);
    if (els.slBanco.isConnected) informarSincronizacao(`Dados locais preservados. ${mensagemErroFatores(err)}`, true);
  }
}

function novaEstrutura() {
  return { margem: [], cartao: [] };
}

function atualizarLogo(els, nomeBanco) {
  if (!els.logo) return;
  const img = els.logo;
  img.onerror = null;
  if (!nomeBanco) {
    ocultarLogo(img);
    return;
  }
  const banco = state.bancos[nomeBanco] || {};
  let arquivo = banco.logoArquivo || banco.logo || "";
  if (!arquivo) {
    const slug = criarSlugLogo(nomeBanco);
    if (!slug) {
      ocultarLogo(img);
      return;
    }
    arquivo = `${slug}.png`;
  }
  if (!/[\/\\]/.test(arquivo)) {
    if (!/\.(png|jpe?g|gif|svg)$/i.test(arquivo)) arquivo += ".png";
    const prefix = window.location.pathname.includes('/pages/') ? '../' : '';
    arquivo = `${prefix}imagens/logos/${arquivo}`;
  }
  img.style.display = "";
  img.alt = `Logo ${nomeBanco}`;
  img.onerror = () => {
    img.onerror = null;
    ocultarLogo(img);
  };
  img.src = arquivo;
}

function ocultarLogo(img) {
  if (!img) return;
  img.style.display = "none";
  img.src = "";
  img.removeAttribute("data-logo");
  img.alt = "";
}

function criarSlugLogo(nome) {
  const base = normalizarTexto(nome).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return base.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function limparInterface(els) {
  els.data.value = "";
  state.dataAtual = null;
  els.infoData.textContent = "";
  els.listaPrazosMargem.innerHTML = "";
  els.listaPrazosCartao.innerHTML = "";
  els.listaSeguros.innerHTML = "";
  if (els.logo) {
    ocultarLogo(els.logo);
  }
  if (els.btnRemover) els.btnRemover.disabled = true;
}

function normalizarTexto(txt) {
  return (txt || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}












