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

function safeHref(link) {
  const raw = String(link || "").trim();
  if (!raw) return "#";
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
}

async function loadBancos() {
  try {
    const base = await carregarBaseInss();
    if (Array.isArray(base)) return base;
    if (base && typeof base === "object") return Object.values(base);
  } catch (err) {
    console.error("Falha ao carregar base de contatos", err);
  }
  return [];
}

function bancoMatchesTerm(banco, termo) {
  if (!termo) return true;
  const nome = String(banco.nomeBanco || "").toLowerCase();
  if (nome.includes(termo)) return true;
  const emails = normalizeList(banco.emails).map(e => String(e).toLowerCase());
  if (emails.some(e => e.includes(termo))) return true;
  const links = normalizeList(banco.links).map(l => String(l).toLowerCase());
  if (links.some(l => l.includes(termo))) return true;
  const contatos = Array.isArray(banco.contatos) ? banco.contatos : [];
  return contatos.some(c => {
    const numero = String(c?.numero || "").toLowerCase();
    const obs = String(c?.obs || "").toLowerCase();
    return numero.includes(termo) || obs.includes(termo);
  });
}

function renderContatosLista(contatos) {
  if (!contatos.length) return "<em>Sem contatos cadastrados</em>";
  return `
    <strong>Contatos</strong>
    <ul class="contatos-lista">
      ${contatos
        .map(c => {
          const numero = escapeHtml(c?.numero || "");
          const obs = c?.obs ? `<small>${escapeHtml(c.obs)}</small>` : "";
          const linha = numero || obs ? `${numero}${obs ? ` ${obs}` : ""}` : "Contato nao informado";
          return `<li>${linha}</li>`;
        })
        .join("")}
    </ul>
  `;
}

function renderEmails(emails) {
  if (!emails.length) return "";
  return `
    <div class="extra-section">
      <strong>E-mails</strong>
      <ul class="extra-lista">
        ${emails.map(email => `<li>${escapeHtml(email)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderLinks(links) {
  if (!links.length) return "";
  return `
    <div class="extra-section">
      <strong>Links</strong>
      <ul class="extra-lista">
        ${links
          .map(link => {
            const href = escapeHtml(safeHref(link));
            const label = escapeHtml(String(link || ""));
            return `<li><a href="${href}" target="_blank" rel="noopener">${label}</a></li>`;
          })
          .join("")}
      </ul>
    </div>
  `;
}

export async function initContatos() {
  const input = document.querySelector("#searchInput");
  const showAllBtn = document.querySelector("#showAllBtn");
  const bankList = document.querySelector("#bankList");

  if (!input || !showAllBtn || !bankList) return;

  const bancos = (await loadBancos())
    .filter(b => b && String(b.nomeBanco || "").trim())
    .sort((a, b) => String(a.nomeBanco || "").localeCompare(String(b.nomeBanco || "")));

  function renderList(filtro = "") {
    bankList.innerHTML = "";
    const termo = String(filtro || "").trim().toLowerCase();
    const filtrados = termo ? bancos.filter(b => bancoMatchesTerm(b, termo)) : bancos;

    if (!filtrados.length) {
      bankList.innerHTML = `<div class="bank-card"><em>Nenhum banco encontrado.</em></div>`;
      return;
    }

    filtrados.forEach(banco => {
      const contatos = Array.isArray(banco.contatos) ? banco.contatos : [];
      const emails = normalizeList(banco.emails);
      const links = normalizeList(banco.links);
      const extraSections = [renderEmails(emails), renderLinks(links)].filter(Boolean);

      const card = document.createElement("div");
      card.className = "bank-card";
      card.innerHTML = `
        <div class="bank-header">
          <h3>${escapeHtml(banco.nomeBanco || "Banco")}</h3>
          <img class="bank-logo" src="${safeLogoPath(banco.nomeBanco)}" onerror="this.src='${FALLBACK_LOGO}'" alt="${escapeHtml(banco.nomeBanco || "Logo")}">
        </div>
        <div class="contact-info">
          ${renderContatosLista(contatos)}
          ${
            extraSections.length
              ? `<div class="expand-btn">+ Mais informacoes</div>
                 <div class="extra-info">${extraSections.join("")}</div>`
              : ""
          }
        </div>
      `;

      const expandBtn = card.querySelector(".expand-btn");
      const extra = card.querySelector(".extra-info");
      if (expandBtn && extra) {
        expandBtn.addEventListener("click", () => {
          const expanded = extra.style.display === "block";
          extra.style.display = expanded ? "none" : "block";
          expandBtn.textContent = expanded ? "+ Mais informacoes" : "- Menos informacoes";
        });
      }

      bankList.appendChild(card);
    });
  }

  input.addEventListener("input", () => renderList(input.value));
  showAllBtn.addEventListener("click", () => {
    input.value = "";
    renderList();
  });

  renderList();
}
