// js/spaRouter.js
// SPA leve com transiÃ§Ãµes, carregamento dinÃ¢mico de CSS/JS e navegaÃ§Ã£o por data-nav OU href de pÃ¡ginas.

import { getCurrentUser, isAdmin } from "./auth/accessControl.js";

const ADMIN_ROUTES = new Set([
  'pages/base-fatores.html',
  'pages/base-inss.html',
  'pages/base-siape.html',
  'pages/base-credito-pessoal.html',
  'pages/base-inss-admin.html',
  'pages/usuarios.html',
  'pages/ajustes.html'
]);
const PUBLIC_REDIRECT = 'pages/pesquisa.html';

let currentUserPromise = null;

async function ensureCurrentUser() {
  if (!currentUserPromise) {
    currentUserPromise = getCurrentUser().catch(err => {
      console.error("Não foi possível obter usuário autenticado:", err);
      return null;
    });
  }
  return currentUserPromise;
}


let SPA_BASE_PREFIX = '';
const LOADED_STYLES = new Set();

function resolveAssetHref(path) {
  if (!path) return path;
  if (/^(https?:|data:|\/)/i.test(path)) {
    if (path.startsWith('/')) {
      try { return new URL(path, window.location.origin).href; }
      catch { return path; }
    }
    return path;
  }
  try {
    const base = new URL(window.location.origin + SPA_BASE_PREFIX);
    return new URL(path, base).href;
  } catch {
    return path;
  }
}

function ensureStyle(path) {
  const href = resolveAssetHref(path);
  if (!href || LOADED_STYLES.has(href)) return;
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .find(link => link.href === href);
  if (existing) { LOADED_STYLES.add(href); return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.spaLoaded = '1';
  document.head.appendChild(link);
  LOADED_STYLES.add(href);
}

async function hydrateBaseInssCache() {
  try {
    const [api, config] = await Promise.all([
      import('./api/baseInssApi.js'),
      import('./config/storageKeys.js')
    ]);
    const baseInss = await api.carregarBaseInss();
    const list = Array.isArray(baseInss)
      ? baseInss
      : (baseInss && typeof baseInss === 'object') ? Object.values(baseInss) : [];
    const payload = JSON.stringify(list);
    const key = config.BASE_INSS_KEY;
    const mirrors = Array.isArray(config.BASE_INSS_MIRRORS) ? config.BASE_INSS_MIRRORS : [];
    if (key) {
      localStorage.setItem(key, payload);
    }
    for (const mirror of mirrors) {
      localStorage.setItem(mirror, payload);
    }
  } catch (err) {
    console.warn('Falha ao atualizar cache da base INSS', err);
  }
}

// ===============================
// ðŸ”§ Inicializadores por pÃ¡gina
// ===============================
const pageInitializers = {
  'index.html': async () => {
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
  },
  'pages/simulador.html': async () => {
    ensureStyle('css/style.css');
    ensureStyle('css/simulador.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./simulador/index.js');
    mod.initSimulador?.();
  },
  'pages/base-fatores.html': async () => {
    // âš™ï¸ Carrega estilos e inicializa apÃ³s o DOM pronto
    ensureStyle('css/style.css');
    ensureStyle('css/simulador.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    // Aguarda o DOM renderizado antes de inicializar
    await new Promise(r => setTimeout(r, 100));
    const mod = await import('./simulador/base-fatores.js');
    mod.initBaseFatores?.();
  },
  'pages/base-inss.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./main.js');
    mod.initBase?.();
  },
  'pages/base-siape.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
  },
  'pages/base-credito-pessoal.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
  },
  'pages/pesquisa.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    await hydrateBaseInssCache();
    await Promise.all([
      import('./filtros/rapido.js'),
      import('./filtros/avancado.js'),
      import('./filtros/modos-bridge.js'),
      import('./filtros/basico.js')
    ]);
    const mod = await import('./filtros/filtros.js');
    mod.initFiltros?.({
      resultsEl: '#results',
      triggerBtn: '#btn-search',
      controls: {
        idade: '#f-idade',
        especie: '#f-especie',
        assina: '#f-assina',
        nome: '#f-nome',
        prods: {
          margem: '#p-margem',
          cartao: '#p-cartao',
          refin: '#p-refin',
          port: '#p-port',
          saque: '#p-saque'
        },
        advanced: '#f-advanced'
      }
    });
  },
  'pages/contatos.html': async () => {
    ensureStyle('css/style.css');
    ensureStyle('css/filtros.css');
    ensureStyle('css/contatos.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./contatos/contatos.js');
    if (typeof mod.initContatos === 'function') {
      await mod.initContatos();
    }
  },
  'pages/bancos.html': async () => {
    ensureStyle('css/style.css');
    ensureStyle('css/filtros.css');
    ensureStyle('css/bancos.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./bancos/bancos.js');
    if (typeof mod.initBancos === 'function') {
      await mod.initBancos();
    }
  }
};

// ===============================
// ðŸš€ Core SPA
// ===============================
async function runPageInitializer(href) {
  let clean = href;
  if (/^(https?|file):/i.test(clean)) {
    try { clean = new URL(clean, window.location.origin).pathname; }
    catch { clean = href; }
  }
  if (SPA_BASE_PREFIX && clean.startsWith(SPA_BASE_PREFIX)) {
    clean = clean.slice(SPA_BASE_PREFIX.length);
  }
  clean = clean.replace(/^\/+/, '').split(/[?#]/)[0] || 'index.html';
  const init = pageInitializers[clean];
  if (init) {
    try { await init(); }
    catch (err) { console.warn(`Falha ao inicializar ${clean}`, err); }
  } else {
    try {
      const { carregarMenuLateral } = await import('./components/menuLateral.js');
      carregarMenuLateral();
    } catch (err) {
      console.warn('Falha ao preparar menu lateral', err);
    }
  }
}

async function applyHeadResources(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href && !document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
      const clone = link.cloneNode();
      document.head.appendChild(clone);
    }
  });
  return [...doc.querySelectorAll('script[type="module"][src]')].map(s => s.getAttribute('src'));
}

export function iniciarSPA() {
  const sidebar = document.getElementById('sidebar');

  const basePrefix = (() => {
    const path = window.location.pathname;
    if (path.includes('/pages/')) return path.split('/pages/')[0] + '/';
    return path.replace(/index\.html$/, '').replace(/[^/]+$/, '');
  })();
  SPA_BASE_PREFIX = basePrefix;

  const routes = {
    home: 'index.html',
    simulador: 'pages/simulador.html',
    base_fatores: 'pages/base-fatores.html',
    base_inss: 'pages/base-inss.html',
    base_siape: 'pages/base-siape.html',
    base_credito: 'pages/base-credito-pessoal.html',
    bancos: 'pages/bancos.html',
    pesquisa: 'pages/pesquisa.html',
    contatos: 'pages/contatos.html'
  };

  const fadeOut = async el => { if (!el) return; el.style.transition='opacity .25s'; el.style.opacity='0'; await new Promise(r=>setTimeout(r,250)); };
  const fadeIn = el => { if (!el) return; el.style.opacity='0'; el.style.transition='opacity .25s'; requestAnimationFrame(()=>{ el.style.opacity='1'; }); };

  const ensureWrap = () => {
    let wrap = document.querySelector('.wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'wrap';
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.style.minHeight = '60px';
      wrap.appendChild(panel);
      document.body.appendChild(wrap);
    }
    return wrap;
  };

  const loadPage = async (href, push = true) => {
    let normalized = href;
    if (/^(https?|file):/i.test(normalized)) {
      try { normalized = new URL(normalized, window.location.origin).pathname; }
      catch { normalized = href; }
    }
    if (SPA_BASE_PREFIX && normalized.startsWith(SPA_BASE_PREFIX)) {
      normalized = normalized.slice(SPA_BASE_PREFIX.length);
    }
    normalized = normalized.replace(/^\/+/, '').split(/[?#]/)[0] || 'index.html';

    const user = await ensureCurrentUser();
    if (ADMIN_ROUTES.has(normalized) && !isAdmin(user)) {
      const redirectTarget = PUBLIC_REDIRECT;
      if (normalized === redirectTarget) {
        console.warn('Usuário sem acesso administrativo tentou acessar rota protegida.');
      } else {
        return loadPage(redirectTarget, push);
      }
    }

    const url = href.startsWith('http') || href.startsWith('file:') ? href : basePrefix + href.replace(/^\/+/, '');
    const wrap = ensureWrap();
    const currentPanel = wrap.querySelector('.panel');
    await fadeOut(currentPanel);

    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const scriptsToLoad = await applyHeadResources(html);

      const temp = document.createElement('div');
      temp.innerHTML = html;
      const newWrap = temp.querySelector('.wrap');
      const newPanel = temp.querySelector('.panel');

      if (newWrap) {
        wrap.replaceWith(newWrap);
        fadeIn(newWrap.querySelector('.panel') || newWrap);
      } else if (newPanel) {
        currentPanel.replaceWith(newPanel);
        fadeIn(newPanel);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'panel';
        fallback.innerHTML = html;
        currentPanel.replaceWith(fallback);
        fadeIn(fallback);
      }

      if (push) history.pushState({ href: url }, '', url);

      for (const src of scriptsToLoad) {
        if (src && !document.querySelector(`script[type="module"][src="${src}"]`)) {
          const modScript = document.createElement('script');
          modScript.type = 'module';
          modScript.src = src;
          document.body.appendChild(modScript);
        }
      }

      // chama o inicializador da pÃ¡gina apÃ³s injeÃ§Ã£o
      await runPageInitializer(href);
      document.dispatchEvent(new CustomEvent('spa:page-loaded', { detail: { href } }));
    } catch (err) {
      console.error('Erro ao carregar pÃ¡gina:', err);
      fadeIn(currentPanel);
      alert('NÃ£o foi possÃ­vel carregar esta pÃ¡gina.');
    }
  };

  if (sidebar) {
    sidebar.addEventListener('click', e => {
      const a = e.target.closest('a[data-nav]');
      if (!a) return;
      e.preventDefault();
      const route = routes[a.dataset.nav];
      if (!route) return;
      loadPage(route, true);
      sidebar.classList.remove('open');
    });
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    let href;
    try { href = new URL(a.getAttribute('href'), window.location.origin); }
    catch { return; }
    if (href.origin !== window.location.origin) return;
    let path = href.pathname;
    if (SPA_BASE_PREFIX && path.startsWith(SPA_BASE_PREFIX)) {
      path = path.slice(SPA_BASE_PREFIX.length);
    }
    path = path.replace(/^\/+/, '');
    if (path === 'index.html' || /^pages\/.+\.html$/.test(path)) {
      e.preventDefault();
      loadPage(path, true);
      sidebar?.classList.remove('open');
    }
  });

  window.addEventListener('popstate', e => {
    const href = e.state?.href || (window.location.pathname.replace(basePrefix, '') || 'index.html');
    loadPage(href, false);
  });
}

// CODIGO ADICIONADO PARA CONTROLE DE ACESSO: importação do utilitário, rotas administrativas e verificação de usuário antes de carregar páginas protegidas.
