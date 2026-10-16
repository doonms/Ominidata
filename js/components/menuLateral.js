// js/components/menuLateral.js
// =====================================================
// MENU LATERAL â€” Ominidata (compatÃ­vel com SPA)
// - Reanexa eventos apÃ³s navegaÃ§Ã£o (spa:page-loaded)
// - Resolve caminhos (root vs /pages/)
// - MantÃ©m compatibilidade com criarMenuLateral/carregarMenuLateral
// =====================================================

import { getCurrentUser, isAdmin } from "../auth/accessControl.js";

function getBasePrefix() {
  // Se a pÃ¡gina atual estÃ¡ em /pages/, usamos "../" como base; caso contrÃ¡rio, "./"
  const path = window.location.pathname || '';
  return /\/pages\/.+\.html$/i.test(path) ? '../' : './';
}

function buildLink(href) {
  // Monta link relativo ao local atual, respeitando /pages/
  const base = getBasePrefix();
  return base + href.replace(/^\.?\//, '');
}

function buildLogoSrc() {
  // Garante que o caminho do logo funciona tanto no index quanto em /pages/
  return buildLink('imagens/logos/logo.png');
}

export function criarMenuLateral() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const wasOpen = sidebar.classList.contains('open') || sidebar.classList.contains('active'); // preserva estado aberto/fechado
  const homeHref = buildLink('index.html');
  const simuladorHref = buildLink('pages/simulador.html');
  const fatoresHref = buildLink('pages/base-fatores.html');
  const fatoresDoDiaHref = buildLink('pages/fatores-do-dia.html');
  const inssHref = buildLink('pages/base-inss.html');
  const creditoHref = buildLink('pages/base-credito-pessoal.html');
  const outrosConveniosHref = buildLink('pages/base-outros-convenios.html');
  const bancosHref = buildLink('pages/bancos.html');
  const pesquisaHref = buildLink('pages/pesquisa.html');
  const contatosHref = buildLink('pages/contatos.html');

  sidebar.innerHTML = `
    <div class="menu-logo">
      <div class="menu-bg" aria-hidden="true"></div>
      <img src="${buildLogoSrc()}" class="menu-logo-img" alt="Logo" />
    </div>

    <a class="publico" href="${homeHref}" data-nav="home">&#127968; Início</a>
    <a class="publico" href="${simuladorHref}" data-nav="simulador">&#128187; Simulador</a>
    <a class="admin-only" href="${fatoresHref}" data-nav="base_fatores">&#128201; Base de Fatores</a>
    <a class="admin-only" href="${fatoresDoDiaHref}" data-nav="fatores_do_dia">&#128198; Fatores do Dia</a>
    <a class="admin-only" href="${inssHref}" data-nav="base_inss">&#128200; Base INSS</a>
    <a class="admin-only" href="${creditoHref}" data-nav="base_credito">&#128179; Crédito Pessoal</a>
    <a class="admin-only" href="${outrosConveniosHref}" data-nav="base_outros_convenios">&#128221; Outros Convênios</a>
    <a class="publico" href="${bancosHref}" data-nav="bancos">&#128181; Bancos</a>
    <a class="publico" href="${pesquisaHref}" data-nav="pesquisa">&#128269; Pesquisa</a>
    <a class="publico" href="${contatosHref}" data-nav="contatos">&#128231; Contatos</a>
  `;

  // Rebind do botÃ£o hamburguer â˜° â€” usa .onclick para evitar mÃºltiplos handlers
  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    menuBtn.onclick = () => {
      sidebar.classList.toggle('open');
      sidebar.classList.toggle('active');
    };
  }

  // Fecha o menu quando clicar em qualquer link do prÃ³prio menu (delegaÃ§Ã£o)
  // Garante um Ãºnico handler reutilizÃ¡vel mesmo apÃ³s innerHTML
  if (!sidebar.dataset.bound) {
    sidebar.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      // Fecha sÃ³ para navegaÃ§Ã£o interna
      const sameOrigin = (() => {
        try { return new URL(a.href, window.location.origin).origin === window.location.origin; }
        catch { return true; }
      })();
      if (sameOrigin){
        sidebar.classList.remove('open');
        sidebar.classList.remove('active');
      }
    });
    sidebar.dataset.bound = '1';
  }

  // Restaura estado aberto se estava aberto antes do re-render
  if (wasOpen){
    sidebar.classList.add('open');
    sidebar.classList.add('active');
  }

  getCurrentUser()
    .then(user => {
      if (!isAdmin(user)) {
        sidebar.querySelectorAll('.admin-only').forEach(el => el.remove());
      }
    })
    .catch(err => {
      console.error("Falha ao obter usuÃ¡rio para controle de acesso:", err);
      sidebar.querySelectorAll('.admin-only').forEach(el => el.remove());
    });
}

// Alias para compatibilidade retroativa
export const carregarMenuLateral = criarMenuLateral;

// Reexecuta o setup apÃ³s cada navegaÃ§Ã£o do SPA
document.addEventListener('spa:page-loaded', () => {
  criarMenuLateral();
});

// Executa ao carregar o DOM (para acessos diretos aos HTMLs)
if (document.readyState !== 'loading') {
  criarMenuLateral();
} else {
  document.addEventListener('DOMContentLoaded', criarMenuLateral);
}

// CODIGO ADICIONADO PARA CONTROLE DE ACESSO: importaÃ§Ãµes de acesso, classes nas entradas e remoÃ§Ã£o condicional de links administrativos apÃ³s render do menu.



