// Classificação operacional informada pelo administrador; não é promessa de prazo.
export const VELOCIDADES_BANCO = Object.freeze({
  manual: { nome: 'Esteira manual', descricao: 'Processo manual, mais lento.', arquivo: 'esteira-manual.png', simbolo: '⌛' },
  rapido: { nome: 'Paga rápido', descricao: 'Pagamento geralmente rápido.', arquivo: 'paga-rapido.png', simbolo: '⚡' },
  medio: { nome: 'Paga em tempo médio', descricao: 'Pagamento em velocidade intermediária.', arquivo: 'paga-medio.png', simbolo: '◷' },
  lento: { nome: 'Paga lento', descricao: 'Pagamento geralmente mais lento.', arquivo: 'paga-lento.png', simbolo: '◴' }
});

export function normalizarVelocidadeBanco(valor) {
  return typeof valor === 'string' && Object.hasOwn(VELOCIDADES_BANCO, valor) ? valor : '';
}

export function simboloVelocidadeSrc(valor) {
  const codigo = normalizarVelocidadeBanco(valor);
  return codigo ? new URL(`../../imagens/velocidade/${VELOCIDADES_BANCO[codigo].arquivo}`, import.meta.url).href : '';
}

export function criarSeloVelocidade(valor) {
  const codigo = normalizarVelocidadeBanco(valor);
  if (!codigo) return null;
  const info = VELOCIDADES_BANCO[codigo];
  const selo = document.createElement('span');
  selo.className = 'sim-bank-speed';
  selo.title = `${info.nome} — ${info.descricao}`;
  selo.setAttribute('role', 'img');
  selo.setAttribute('aria-label', selo.title);
  const fallback = document.createElement('span');
  fallback.className = 'sim-bank-speed-fallback';
  fallback.textContent = info.simbolo;
  fallback.setAttribute('aria-hidden', 'true');
  const imagem = document.createElement('img');
  imagem.className = 'sim-bank-speed-icon';
  imagem.alt = '';
  imagem.hidden = true;
  imagem.setAttribute('aria-hidden', 'true');
  imagem.addEventListener('load', () => { imagem.hidden = false; fallback.hidden = true; });
  imagem.addEventListener('error', () => { imagem.hidden = true; fallback.hidden = false; });
  imagem.src = simboloVelocidadeSrc(codigo);
  selo.append(imagem, fallback);
  return selo;
}
