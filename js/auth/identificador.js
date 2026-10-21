// Domínio reservado, sem envio de e-mail. O Supabase Auth continua cuidando
// das senhas/sessões; não armazenamos senhas nem criamos autenticação paralela.
export const DOMINIO_USUARIOS = 'usuarios.ominidata.invalid';

export function normalizarUsuario(value) {
  return String(value || '').trim().toLowerCase();
}

export function usuarioValido(value) {
  return value.length >= 3 && value.length <= 32 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

export function emailParaLogin(value) {
  const login = normalizarUsuario(value);
  if (login.includes('@')) {
    if (login.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) return login;
  } else if (usuarioValido(login)) {
    return `${login}@${DOMINIO_USUARIOS}`;
  }
  throw new Error('Informe um usuário válido ou o e-mail da sua conta existente.');
}

export function nomeDeAcesso(email) {
  const value = String(email || '');
  const suffix = `@${DOMINIO_USUARIOS}`;
  return value.toLowerCase().endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
