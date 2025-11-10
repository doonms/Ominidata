import { carregarBaseInss } from "../api/baseInssApi.js";

const FALLBACK_LOGO = "../imagens/logos/logo.png";
const ATTR_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

const escapeHtml = value =>
  String(value ?? "").replace(/[&<>"']/g, ch => ATTR_ESCAPE[ch] || ch);

const normalizeList = arr => (Array.isArray(arr) ? arr.filter(Boolean) : []);

function safeLogoPath(nome) {
  const base = String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `../imagens/logos/${base}.png` : FALLBACK_LOGO;
}

async function loadBancos() {
  try {
    const base = await carregarBaseInss({ incluirSuspensos: true });
    if (Array.isArray(base)) return base;
    if (base && typeof base === "object") return Object.values(base);
  } catch (err) {
    console.error("Falha ao carregar base de bancos", err);
  }
  return [];
}

function highlightMatch(text, term) {
  const value = String(text ?? "");
  const needle = String(term || "").trim().toLowerCase();
  if (!needle) return escapeHtml(value);
  const haystack = value.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return escapeHtml(value);
  const before = escapeHtml(value.slice(0, index));
  const match = escapeHtml(value.slice(index, index + needle.length));
  const after = escapeHtml(value.slice(index + needle.length));
  return `${before}<mark>${match}</mark>${after}`;
}

function bancoMatchesTerm(banco, termo) {
  if (!termo) return true;
  const needle = termo.toLowerCase();
  if (String(banco.nomeBanco || "").toLowerCase().includes(needle)) return true;

  const aceitos = normalizeList(banco.bancosAceitos).map(item => String(item).toLowerCase());
  if (aceitos.some(item => item.includes(needle))) return true;

  const naoAceitos = normalizeList(banco.bancosNaoAceitos).map(item => String(item).toLowerCase());
  return naoAceitos.some(item => item.includes(needle));
}

function renderLista(titulo, itens, vazioMsg, termo, variant = "") {
  const variantClass = variant ? ` bancos-section--${variant}` : "";
  if (!itens.length) {
    return `
      <div class="bancos-section${variantClass}">
        <strong>${escapeHtml(titulo)}</strong>
        <em>${escapeHtml(vazioMsg)}</em>
      </div>
    `;
  }

  const lista = itens
    .map(item => `<li>${highlightMatch(item, termo)}</li>`)
    .join("");

  return `
    <div class="bancos-section${variantClass}">
      <strong>${escapeHtml(titulo)}</strong>
      <ul class="bancos-lista">${lista}</ul>
    </div>
  `;
}

function renderResumo(aceitos, naoAceitos) {
  return `
    <div class="bancos-resumo">
      <span class="chip chip-ok">${aceitos.length} aceitos</span>
      <span class="chip chip-alert">${naoAceitos.length} nao aceitos</span>
    </div>
  `;
}

function computeSummary(bancos) {
  return bancos.reduce(
    (acc, banco) => {
      acc.parceiros += 1;
      acc.aceitos += normalizeList(banco.bancosAceitos).length;
      acc.restritos += normalizeList(banco.bancosNaoAceitos).length;
      return acc;
    },
    { parceiros: 0, aceitos: 0, restritos: 0 }
  );
}

function renderSummary(panel, summary) {
  if (!panel) return;
  const { parceiros, aceitos, restritos } = summary;
  panel.innerHTML = `
    <div class="summary-card">
      <strong>${parceiros}</strong>
      <span>parceiros</span>
    </div>
    <div class="summary-card">
      <strong>${aceitos}</strong>
      <span>bancos aceitos</span>
    </div>
    <div class="summary-card">
      <strong>${restritos}</strong>
      <span>bancos com restricao</span>
    </div>
  `;
}

export async function initBancos() {
  const input = document.querySelector("#searchInput");
  const showAllBtn = document.querySelector("#showAllBtn");
  const bankList = document.querySelector("#bankList");
  const filterAceitos = document.querySelector("#filterAceitos");
  const filterRestritos = document.querySelector("#filterRestritos");
  const summaryPanel = document.querySelector("#summaryPanel");

  if (!input || !showAllBtn || !bankList) return;

  const bancos = (await loadBancos())
    .filter(b => b && String(b.nomeBanco || "").trim())
    .sort((a, b) => String(a.nomeBanco || "").localeCompare(String(b.nomeBanco || "")));

  const updateSummary = lista => renderSummary(summaryPanel, computeSummary(lista));

  function render(filtro = "") {
    bankList.innerHTML = "";
    const termoBruto = String(filtro || "").trim();
    const termo = termoBruto.toLowerCase();
    let filtrados = termo ? bancos.filter(b => bancoMatchesTerm(b, termo)) : bancos;

    const somenteAceitos = !!filterAceitos?.checked;
    const somenteRestritos = !!filterRestritos?.checked;

    if (somenteAceitos) {
      filtrados = filtrados.filter(b => normalizeList(b.bancosAceitos).length > 0);
    }
    if (somenteRestritos) {
      filtrados = filtrados.filter(b => normalizeList(b.bancosNaoAceitos).length > 0);
    }

    updateSummary(filtrados);

    if (!filtrados.length) {
      bankList.innerHTML = `<div class="bank-card"><em>Nenhum banco encontrado.</em></div>`;
      return;
    }

    filtrados.forEach(banco => {
      const aceitos = normalizeList(banco.bancosAceitos);
      const naoAceitos = normalizeList(banco.bancosNaoAceitos);

      const card = document.createElement("div");
      card.className = "bank-card";
      card.innerHTML = `
        <div class="bank-header">
          <h3>${highlightMatch(banco.nomeBanco || "Banco", termoBruto)}</h3>
          <img class="bank-logo" src="${safeLogoPath(banco.nomeBanco)}" onerror="this.src='${FALLBACK_LOGO}'" alt="${escapeHtml(banco.nomeBanco || "Logo")}">
        </div>
        ${renderResumo(aceitos, naoAceitos)}
        <div class="bank-info">
          ${renderLista("Bancos aceitos", aceitos, "Nenhum banco aceito informado.", termoBruto, "ok")}
          ${renderLista("Bancos nao aceitos", naoAceitos, "Nenhum banco nao aceito informado.", termoBruto, "alert")}
        </div>
      `;

      bankList.appendChild(card);
    });
  }

  input.addEventListener("input", () => render(input.value));
  showAllBtn.addEventListener("click", () => {
    input.value = "";
    render();
  });
  filterAceitos?.addEventListener("change", () => render(input.value));
  filterRestritos?.addEventListener("change", () => render(input.value));

  render();
}
