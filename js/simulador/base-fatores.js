import { BASE_FATORES_KEY, BASE_FATORES_FALLBACKS, BASE_FATORES_MIRRORS, readFromStorage, writeToStorage } from '../config/storageKeys.js';
import { carregarFatoresRemotos, enviarFatoresRemotos, mesclarFatoresRemotos,
  mesclarArquivoFatores, mensagemErroFatores, prepararFatores } from '../api/baseFatoresApi.js';
import { initCalculadoraFator } from './calculadora-fator-ui.js';
import { normalizarBaseFatores, preservarBackupFatoresDatados } from './base-fatores-modelo.js';
import { criarCadastroTabelas, temPrazosPendentes } from './cadastro-tabelas-fatores.js';
import { initEditorTabelas } from './tabelas-fatores-editor.js';
// === Base de Fatores (Simulador Limpo) ===
// Controle de INSS, margem/cartão e seguros, sem divisão por datas.

let state = {
  bancos: {},
  bancoAtual: null,
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
  swMargem: '#bf-swMargem',
  swCartao: '#bf-swCartao',
  blocoMargem: '#bf-blocoMargem',
  listaPrazosMargem: '#bf-listaPrazosMargem',
  addTabelaMargem: '#bf-addTabelaMargem',
  blocoCartao: '#bf-blocoCartao',
  listaPrazosCartao: '#bf-listaPrazosCartao',
  addTabelaCartao: '#bf-addTabelaCartao',
  listaSeguros: '#bf-listaSeguros',
  addSeguro: '#bf-addSeguro',
  btnNovo: '#bf-novoBanco',
  btnRemover: '#bf-removerBanco',
  btnSalvar: '#bf-salvarBanco',
  btnImportar: '#bf-importarBanco',
  btnExportar: '#bf-exportarBanco',
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
    state.bancos = criarCadastroTabelas(mesclarArquivoFatores(baseFatores, state.bancos), state.bancos);
    saveState();
    state.filtroBanco = '';
    if (els.buscaBanco) els.buscaBanco.value = '';
    syncBancoSelecionado(els, renderBancoSelect(els));
    selectBanco(els);
    informarSincronizacao('Arquivo preservado neste navegador. Enviando fatores ao Supabase…');
    const resultado = await enviarFatoresRemotos(baseFatores);
    if (!els.slBanco.isConnected) return;
    renderBaseFatores(resultado.linhas, els);
    informarSincronizacao(`${resultado.quantidade} fatores confirmados no Supabase: ${resultado.inseridos} novos, ${resultado.atualizados} atualizados, ${resultado.mantidos} já estavam iguais. Os demais registros, seguros e logos foram mantidos.`);
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

  if (!loadState()) {
    // Sem backup confirmado não sobrescrevemos a base antiga.
    if (els.btnExportar) els.btnExportar.onclick = exportarJSON;
    [uploadBtn, els.btnSalvar, els.btnNovo, els.btnRemover, els.btnImportar].forEach(botao => {
      if (botao) botao.disabled = true;
    });
    return;
  }

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

  // preencher select de bancos
  els.editorTabelas = initEditorTabelas({
    root: els.slBanco.closest('.bf-page'), getBanco: getBancoAtual, salvar: saveState,
    listas: { margem: els.listaPrazosMargem, cartao: els.listaPrazosCartao }, avisar: avisarVinculos
  });
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);

  // eventos
  if (els.slBanco) els.slBanco.onchange = () => selectBanco(els);
  if (els.btnNovo) els.btnNovo.onclick = () => novoBanco(els);
  if (els.btnRemover) els.btnRemover.onclick = () => removerBanco(els);
  if (els.btnSalvar) els.btnSalvar.onclick = () => salvarTudo();
  if (els.btnImportar) els.btnImportar.onclick = () => importarJSON(els);
  if (els.btnExportar) els.btnExportar.onclick = () => exportarJSON();
  if (els.swMargem) els.swMargem.onchange = () => toggleMargem(els);
  if (els.swCartao) els.swCartao.onchange = () => toggleCartao(els);
  if (els.addTabelaMargem) els.addTabelaMargem.onclick = () => addTabela(els, "margem");
  if (els.addTabelaCartao) els.addTabelaCartao.onclick = () => addTabela(els, "cartao");
  els.slBanco.closest('.bf-page')?.querySelectorAll('[data-bf-add-tabela]').forEach(botao => {
    botao.onclick = () => addTabela(els, botao.dataset.bfAddTabela);
  });
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
  initCalculadoraFator({
    campos: { parcela: els.calcParcela, fator: els.calcFator, valor: els.calcValor },
    status: els.calcStatus,
    limpar: els.calcLimpar
  });
}

function loadState() {
  state.keyStorage = BASE_FATORES_KEY;
  const data = readFromStorage(BASE_FATORES_KEY, BASE_FATORES_FALLBACKS);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    try {
      preservarBackupFatoresDatados(data);
      const normalizada = normalizarBaseFatores(data);
      const cadastro = criarCadastroTabelas(Object.fromEntries(Object.keys(normalizada).map(nome =>
        [nome, data[nome]?.tabelas ? data[nome] : normalizada[nome]])));
      if (temPrazosPendentes(cadastro) && !localStorage.getItem('ominidata_base_fatores_antes_editor_tabelas_v1')) {
        localStorage.setItem('ominidata_base_fatores_antes_editor_tabelas_v1', JSON.stringify({
          data: new Date().toISOString(), bancos: data
        }));
      }
      state.bancos = cadastro;
      writeToStorage(state.keyStorage, state.bancos, BASE_FATORES_MIRRORS);
    } catch (error) {
      state.bancos = data;
      informarSincronizacao(`Não foi possível converter a base com segurança. Os dados originais foram mantidos. Exporte o JSON antes de liberar espaço no navegador ou corrigir o arquivo. ${error.message}`, true);
      return false;
    }
  } else {
    state.bancos = {};
  }
  return true;
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
    state.bancos[nome] = { tabelas: novaEstrutura(), seguros: [] };
  }
  const b = state.bancos[nome];
  renderBanco(b, els);
}

function renderBaseFatores(baseFatoresRows, els) {
  if (!baseFatoresRows?.length) return;
  const bancos = criarCadastroTabelas(mesclarFatoresRemotos(baseFatoresRows, state.bancos), state.bancos);
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
  b.tabelas ??= novaEstrutura();
  aplicarSwitchesBanco(b, els);
  renderFatores(b, els);
  renderSeguros(b, els);
}

function aplicarSwitchesBanco(b, els) {
  if (!b) return;
  if (!els.swMargem && !els.swCartao) return;
  const fatores = b.tabelas || novaEstrutura();
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
  state.bancos[nome] = { tabelas: novaEstrutura(), seguros: [] };
  saveState();
  state.filtroBanco = "";
  if (els.buscaBanco) els.buscaBanco.value = "";
  const nomes = renderBancoSelect(els);
  syncBancoSelecionado(els, nomes);
  els.slBanco.value = nome;
  selectBanco(els);
}

function toggleMargem(els) {
  const ativo = els.swMargem.checked;
  const b = getBancoAtual();
  if (b) {
    b.fazMargem = ativo;
    saveState();
  }
  els.blocoMargem.style.display = ativo ? "block" : "none";
  els.slBanco.closest('.bf-page')?.querySelectorAll('[data-bf-add-tabela="margem"]').forEach(botao => { botao.hidden = !ativo; });
}

function toggleCartao(els) {
  const ativo = els.swCartao.checked;
  const b = getBancoAtual();
  if (b) {
    b.fazCartao = ativo;
    saveState();
  }
  els.blocoCartao.style.display = ativo ? "block" : "none";
  els.slBanco.closest('.bf-page')?.querySelectorAll('[data-bf-add-tabela="cartao"]').forEach(botao => { botao.hidden = !ativo; });
}

function addTabela(els, tipo) {
  els.editorTabelas.adicionarTabela(tipo);
}

function renderFatores(_banco, els) {
  els.editorTabelas.renderizar();
}

function avisarVinculos(mensagem, erro = false) {
  const status = document.getElementById('bf-vinculos-status');
  if (!status) return;
  status.textContent = mensagem;
  status.classList.toggle('is-error', erro);
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
        normalizarBaseFatores(data, { estrito: true });
        guardarBackupLocal();
        const cadastro = criarCadastroTabelas(mesclarArquivoFatores(data, state.bancos), state.bancos);
        // A projeção de fatores não contém tabelas vazias: preserve também os rascunhos importados,
        // sem substituir tabelas ou prazos locais ausentes em um arquivo parcial.
        const chaveBanco = nome => nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [nome, banco] of Object.entries(data)) {
          if (!banco?.tabelas) continue;
          const destino = cadastro[Object.keys(cadastro).find(n => chaveBanco(n) === chaveBanco(nome))];
          for (const tipo of ['margem', 'cartao']) {
            for (const tabela of banco.tabelas[tipo] || []) {
              if (!tabela.prazos.length && !destino.tabelas[tipo].some(t => t.nome === tabela.nome)) {
                destino.tabelas[tipo].push(JSON.parse(JSON.stringify(tabela)));
              }
            }
          }
        }
        state.bancos = cadastro;
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
  a.download = 'base-fatores.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function salvarTudo() {
  saveState();
  informarSincronizacao('Alterações salvas neste navegador. Para publicar: exporte o JSON e use “Enviar base ao Supabase”.');
  alert("Salvo neste navegador. Para publicar, exporte o JSON e use Enviar base ao Supabase.");
}

function getBancoAtual() { return state.bancos[state.bancoAtual]; }

function getBancosFiltrados() {
  const nomes = Object.keys(state.bancos).sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (!state.filtroBanco) return nomes;
  return nomes.filter(nome => normalizarTexto(nome).includes(state.filtroBanco));
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
  els.listaPrazosMargem.innerHTML = "";
  els.listaPrazosCartao.innerHTML = "";
  els.listaSeguros.innerHTML = "";
  els.editorTabelas?.limpar();
  if (els.logo) {
    ocultarLogo(els.logo);
  }
  if (els.btnRemover) els.btnRemover.disabled = true;
}

function normalizarTexto(txt) {
  return (txt || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}












