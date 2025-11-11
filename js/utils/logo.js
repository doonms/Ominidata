function resolveLogoPath(relative) {
  if (typeof window === 'undefined') return relative;
  const path = window.location?.pathname || '';
  const prefix = path.includes('/pages/') ? '../' : './';
  return `${prefix}${relative}`;
}

export function slugLogo(nome = '') {
  return nome
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getLogoSrc(nome = '') {
  const slug = slugLogo(nome);
  if (!slug || /^\d+$/.test(slug)) return resolveLogoPath('imagens/logos/logo.png');
  return resolveLogoPath(`imagens/logos/${slug}.png`);
}

export function getLogoFallbackAttr() {
  const fallback = resolveLogoPath('imagens/logos/logo.png');
  return `this.onerror=null; this.src='${fallback}'; this.style.visibility='visible';`;
}
