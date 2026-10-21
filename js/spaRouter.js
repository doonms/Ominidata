// js/spaRouter.js
// SPA leve com transiÃ§Ãµes, carregamento dinÃ¢mico de CSS/JS e navegaÃ§Ã£o por data-nav OU href de pÃ¡ginas.

import { getCurrentUser, canAccessRoute, appUrl, finishPageAccess } from "./auth/accessControl.js";

const PUBLIC_REDIRECT = 'pages/pesquisa.html';


let SPA_BASE_PREFIX = '';

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
  if (!href) return;
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .find(link => link.href === href);
  if (existing) { existing.disabled = false; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.spaLoaded = '1';
  document.head.appendChild(link);
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
  'pages/usuarios.html': async () => {
    ensureStyle('css/style.css');
    ensureStyle('css/layout-operacional.css');
    ensureStyle('css/usuarios.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./usuarios/usuarios.js');
    await mod.initUsuarios();
  },
  'index.html': async () => {
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
  },
  'pages/simulador.html': async () => {
    ensureStyle('css/style.css');
    ensureStyle('css/simulador-inss.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./simulador/index.js?v=20261021-origem-2');
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
  'pages/fatores-do-dia.html': async () => {
    ensureStyle('css/style.css');
    ensureStyle('css/simulador.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./simulador/base-fatores.js');
    mod.initBaseFatores?.();
  },
  'pages/base-inss.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const headerLogo = document.querySelector('.header .logo-img');
    if (headerLogo) {
      const prefix = window.location.pathname.includes('/pages/') ? '../' : './';
      headerLogo.src = `${prefix}imagens/logos/logo.png`;
    }
    const mod = await import('./main.js');
    mod.initBase?.();
  },
  'pages/base-credito-pessoal.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
  },
  'pages/base-outros-convenios.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    const mod = await import('./main-outros-convenios.js');
    mod.initBase?.();
  },
  'pages/pesquisa.html': async () => {
    ensureStyle('css/style.css');
    const { carregarMenuLateral } = await import('./components/menuLateral.js');
    carregarMenuLateral();
    await hydrateBaseInssCache();
    await Promise.all([
      import('./filtros/rapido.js'),
      import('./filtros/avancado.js'),
      import('./filtros/modos-bridge.js')
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
    const layout = await import('./filtros/pesquisa-layout.js');
    layout.initPesquisaLayout();
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
  document.body.classList.toggle('simulador-page', clean === 'pages/simulador.html');
  document.body.classList.toggle('base-fatores-page', ['pages/base-fatores.html', 'pages/fatores-do-dia.html'].includes(clean));
  document.body.classList.toggle('pesquisa-page', clean === 'pages/pesquisa.html');
  document.body.classList.toggle('usuarios-page', clean === 'pages/usuarios.html');
  document.body.classList.toggle('od-page', [
    'index.html', 'pages/base-inss.html', 'pages/base-outros-convenios.html',
    'pages/base-credito-pessoal.html', 'pages/contatos.html', 'pages/bancos.html', 'pages/usuarios.html'
  ].includes(clean));
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

async function applyHeadResources(htmlText, pageUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const targetUrl = new URL(pageUrl, window.location.href);
  const pending = [];
  const activeStyles = new Set();
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const relativeHref = link.getAttribute('href');
    if (!relativeHref) return;
    const href = new URL(relativeHref, targetUrl).href;
    activeStyles.add(href);
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find(item => item.href === href);
    if (existing) {
      existing.disabled = false;
      // Mantém a mesma ordem de estilos declarada pela página.
      document.head.appendChild(existing);
    } else {
      const clone = link.cloneNode();
      clone.href = href;
      pending.push(new Promise((resolve, reject) => {
        clone.onload = resolve;
        clone.onerror = () => reject(new Error(`Falha ao carregar estilos: ${href}`));
      }));
      document.head.appendChild(clone);
    }
  });
  await Promise.all(pending);
  const appCssPrefix = new URL('css/', window.location.origin + SPA_BASE_PREFIX).href;
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    if (link.href.startsWith(appCssPrefix) && !activeStyles.has(link.href)) link.remove();
  });
  return [...doc.querySelectorAll('script[type="module"][src]')]
    .map(s => new URL(s.getAttribute('src'), targetUrl).href);
}

export function iniciarSPA() {
  const sidebar = document.getElementById('sidebar');

  const basePrefix = (() => {
    const path = window.location.pathname;
    if (path.includes('/pages/')) return path.split('/pages/')[0] + '/';
    return path.replace(/index\.html$/, '').replace(/[^/]+$/, '');
  })();
  SPA_BASE_PREFIX = basePrefix;
  // O pushState altera a resolução de URLs relativas; fixa as folhas iniciais.
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    link.href = new URL(link.getAttribute('href'), document.baseURI).href;
  });

  const routes = {
    home: 'index.html',
    simulador: 'pages/simulador.html',
    base_fatores: 'pages/base-fatores.html',
    fatores_do_dia: 'pages/fatores-do-dia.html',
    base_inss: 'pages/base-inss.html',
    base_credito: 'pages/base-credito-pessoal.html',
    base_outros_convenios: 'pages/base-outros-convenios.html',
    bancos: 'pages/bancos.html',
    pesquisa: 'pages/pesquisa.html',
    contatos: 'pages/contatos.html',
    usuarios: 'pages/usuarios.html'
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

    let user;
    try {
      user = await getCurrentUser();
    } catch (err) {
      alert(err.message);
      return;
    }
    if (!user) {
      window.location.replace(appUrl('pages/login.html'));
      return;
    }
    if (!canAccessRoute(user, normalized)) {
      const redirectTarget = PUBLIC_REDIRECT;
      if (normalized === redirectTarget) {
        console.warn('Usuário sem acesso administrativo tentou acessar rota protegida.');
      } else {
        return loadPage(redirectTarget, push);
      }
    }

    const url = new URL(normalized, window.location.origin + basePrefix).href;
    const wrap = ensureWrap();
    const currentPanel = wrap.querySelector('.panel');
    await fadeOut(currentPanel);

    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const scriptsToLoad = await applyHeadResources(html, url);

      const temp = document.createElement('div');
      temp.innerHTML = html;
      const newWrap = temp.querySelector('.wrap');
      const newPanel = temp.querySelector('.panel');
      if (newWrap) {
        newWrap.querySelectorAll('img[src]').forEach(img => {
          img.src = new URL(img.getAttribute('src'), new URL(url, window.location.href)).href;
        });
      }

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
      finishPageAccess();
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
      const route = routes[a.dataset.nav];
      if (!route) return;
      e.preventDefault();
      loadPage(route, true);
      sidebar.classList.remove('open');
    });
  }

  document.addEventListener('click', e => {
    if (e.defaultPrevented) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    let href;
    try { href = new URL(a.getAttribute('href'), document.baseURI); }
    catch { return; }
    if (href.origin !== window.location.origin) return;
    let path = href.pathname;
    if (SPA_BASE_PREFIX && path.startsWith(SPA_BASE_PREFIX)) {
      path = path.slice(SPA_BASE_PREFIX.length);
    }
    path = path.replace(/^\/+/, '');
    if (pageInitializers[path]) {
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
