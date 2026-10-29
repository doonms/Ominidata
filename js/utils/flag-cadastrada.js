// Dados antigos podem conter strings. "false" e "não" nunca significam sim.
export function flagCadastrada(valor) {
  return valor === true || valor === 1 || ['true', '1', 'sim'].includes(String(valor ?? '').trim().toLowerCase());
}
