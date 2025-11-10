const FALLBACK_LOGO = 'imagens/logos/logo.png';

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
  return slug ? `imagens/logos/${slug}.png` : FALLBACK_LOGO;
}
