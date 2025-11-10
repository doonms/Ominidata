import { supabase } from "../supa/supabaseClient.js";

export const ADMIN_EMAIL = "dominicplf@gmail.com";
const ADMIN_EMAIL_NORMALIZED = ADMIN_EMAIL.trim().toLowerCase();

// TESTE DE USUÁRIO LOGADO
(async () => {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  console.log("Usuário logado:", user?.email);
})();

let cachedUser = null;
let pendingRequest = null;

function fallbackUserFromStorage() {
  try {
    const stored = sessionStorage.getItem("ominidata_user") || localStorage.getItem("ominidata_user");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed && parsed.email) {
      return {
        email: parsed.email,
        ...parsed
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function getCurrentUser() {
  if (cachedUser) return cachedUser;
  if (pendingRequest) return pendingRequest;

  pendingRequest = (async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    cachedUser = user || fallbackUserFromStorage() || null;
    pendingRequest = null;
    return cachedUser;
  })();

  return pendingRequest;
}

export function isAdmin(userLike) {
  const email = (userLike?.email || "").trim().toLowerCase();
  return email && email === ADMIN_EMAIL_NORMALIZED;
}

// CODIGO ADICIONADO PARA CONTROLE DE ACESSO: utilitário atualizado para normalizar email do administrador, usar fallback de session/localStorage e expor helper isAdmin.
