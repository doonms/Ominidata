import { supabase } from "../supa/supabaseClient.js";

const PERFIS = new Set(["master", "admin", "consulta"]);
const ADMIN_PAGES = new Set([
  "base-fatores.html", "fatores-do-dia.html", "base-inss.html",
  "base-credito-pessoal.html", "base-outros-convenios.html",
  "base-inss-admin.html", "importar-inss.html", "ajustes.html"
]);
let pendingRequest = null;
let generation = 0;
// undefined: SDK ainda inicializando; null: logout confirmado.
let sessionUserId;

export function limparIdentidadeLocal() {
  for (const storage of [sessionStorage, localStorage]) {
    storage.removeItem("ominidata_user");
    storage.removeItem("ominidata_role");
  }
}

function guardarIdentidade(user) {
  // Apenas exibição. Nunca lemos estes valores para autorizar.
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.setItem("ominidata_user", JSON.stringify(user));
      storage.setItem("ominidata_role", user.perfil);
    } catch {
      // Falta de espaço no cache de edição não invalida um perfil confirmado.
    }
  }
}

export async function getCurrentUser() {
  // Compartilha só consultas em andamento. Revalida a cada navegação.
  // O perfil vem do banco, nunca do e-mail ou user_metadata.
  if (pendingRequest) return pendingRequest;
  const requestGeneration = generation;
  const request = (async () => {
    const { data, error } = await supabase.auth.getUser();
    // Um logout/troca de conta ocorrido durante a consulta invalida a resposta,
    // inclusive se ela vier com erro. Não limpa a identidade de uma sessão nova.
    if (requestGeneration !== generation) return null;
    if (error) {
      limparIdentidadeLocal();
      throw new Error("Não foi possível confirmar sua sessão. Entre novamente ou tente atualizar a página.");
    }
    if (!data?.user?.id) {
      limparIdentidadeLocal();
      return null;
    }
    if (sessionUserId !== undefined && sessionUserId !== data.user.id) return null;
    sessionUserId = data.user.id;
    const { data: perfil, error: perfilError } = await supabase
      .from("perfis_usuarios").select("perfil").eq("id", data.user.id).maybeSingle();
    if (requestGeneration !== generation) return null;
    if (perfilError || !PERFIS.has(perfil?.perfil)) {
      limparIdentidadeLocal();
      throw new Error("Não foi possível carregar seu perfil de acesso. Peça ao Master para conferir seu cadastro e tente novamente.");
    }
    const user = { ...data.user, perfil: perfil.perfil };
    guardarIdentidade(user);
    return user;
  })();
  pendingRequest = request;
  try {
    return await request;
  } finally {
    if (pendingRequest === request) pendingRequest = null;
  }
}

export function isMaster(user) {
  return user?.perfil === "master";
}

export function isAdmin(user) {
  return isMaster(user) || user?.perfil === "admin";
}

export function canAccessRoute(user, path = window.location.pathname) {
  if (!PERFIS.has(user?.perfil)) return false;
  let normalized;
  try { normalized = decodeURIComponent(path.split(/[?#]/)[0]); }
  catch { return false; }
  const page = normalized.replace(/\/+$/, '').split("/").pop().toLowerCase();
  if (page === "usuarios.html") return isMaster(user);
  return !ADMIN_PAGES.has(page) || isAdmin(user);
}

export function appUrl(relativePath) {
  return new URL("../../" + relativePath, import.meta.url).href;
}

export function finishPageAccess() {
  document.querySelector('.wrap')?.removeAttribute('inert');
}

export async function requirePageAccess() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      window.location.replace(appUrl("pages/login.html"));
      return false;
    }
    if (!canAccessRoute(user)) {
      window.location.replace(appUrl("pages/pesquisa.html"));
      return false;
    }
    return true;
  } catch (err) {
    // Falhar fechado, sem deixar o editor operante nem criar loop de login.
    const wrap = document.querySelector(".wrap");
    if (wrap) {
      wrap.replaceChildren();
      const panel = document.createElement("main");
      panel.className = "panel";
      const title = document.createElement("h1");
      title.textContent = "Acesso não confirmado";
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = err.message;
      const retry = document.createElement("button");
      retry.textContent = "Tentar novamente";
      retry.onclick = () => window.location.reload();
      const login = document.createElement("a");
      login.href = appUrl("pages/login.html");
      login.textContent = " Voltar ao login";
      panel.append(title, message, retry, login);
      wrap.append(panel);
      finishPageAccess();
    }
    return false;
  }
}

supabase.auth.onAuthStateChange?.((event, session) => {
  if (event === "SIGNED_OUT") {
    sessionUserId = null;
    generation++;
    pendingRequest = null;
    limparIdentidadeLocal();
    if (!window.location.pathname.endsWith("/login.html")) {
      window.location.replace(appUrl("pages/login.html"));
    }
    return;
  }
  if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
    const nextUserId = session?.user?.id;
    if (!nextUserId) return;
    // O SDK emite SIGNED_IN ao recuperar/reconfirmar a mesma sessão. Isso não
    // é logout nem troca de conta e não pode cancelar a verificação em curso.
    // O ID aqui só detecta troca: o acesso ainda exige getUser + perfil remoto.
    if (sessionUserId !== undefined && sessionUserId !== nextUserId) {
      generation++;
      pendingRequest = null;
      limparIdentidadeLocal();
    }
    sessionUserId = nextUserId;
  }
});
