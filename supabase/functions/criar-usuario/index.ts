// Código completo para "criar-usuario": cadastro e troca de senha pelo Master.
// A chave administrativa só é lida do ambiente do Supabase, nunca do site.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

export function createHandler(
  clientFactory: typeof createClient,
  getEnv: (key: string) => string | undefined
) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const extraOrigins = (getEnv("OMINIDATA_ALLOWED_ORIGINS") || "")
      .split(",").map(value => value.trim()).filter(Boolean);
    let allowedOrigin = !origin;
    if (origin) {
      try {
        const url = new URL(origin);
        allowedOrigin = origin === "https://ominidata.netlify.app" || extraOrigins.includes(origin) ||
          (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
      } catch { allowedOrigin = false; }
    }
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "600"
    });
    if (origin && allowedOrigin) headers.set("Access-Control-Allow-Origin", origin);
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    if (!allowedOrigin) return reply(403, { ok: false, message: "Origem não autorizada." });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply(405, { ok: false, message: "Use POST." });

    try {
      const url = getEnv("SUPABASE_URL");
      const publicKey = getEnv("SUPABASE_ANON_KEY");
      const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !publicKey || !serviceKey) {
        return reply(503, { ok: false, message: "Ambiente da função incompleto. Confira as variáveis padrão do Supabase." });
      }
      const authorization = req.headers.get("authorization") || "";
      if (!/^Bearer\s+\S+$/i.test(authorization) || authorization.length > 8192) {
        return reply(401, { ok: false, message: "Entre novamente para confirmar sua sessão." });
      }
      const token = authorization.replace(/^Bearer\s+/i, "");
      const caller = clientFactory(url, publicKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      // Valida a sessão no Auth; não decodifica um JWT sem verificar a assinatura.
      const { data: authData, error: authError } = await caller.auth.getUser(token);
      if (authError || !authData?.user?.id) {
        return reply(401, { ok: false, message: "Sessão inválida ou expirada. Entre novamente." });
      }
      const { data: profile, error: profileError } = await caller.from("perfis_usuarios")
        .select("perfil").eq("id", authData.user.id).maybeSingle();
      if (profileError) return reply(503, { ok: false, message: "Não foi possível confirmar o perfil. Nenhum cadastro foi iniciado." });
      if (profile?.perfil !== "master") {
        return reply(403, { ok: false, message: "Somente o Master pode gerenciar acessos." });
      }
      if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return reply(415, { ok: false, message: "Envie os dados como JSON." });
      }
      if (Number(req.headers.get("content-length")) > 4096) {
        return reply(413, { ok: false, message: "Solicitação muito grande." });
      }
      const text = await req.text();
      if (new TextEncoder().encode(text).length > 4096) {
        return reply(413, { ok: false, message: "Solicitação muito grande." });
      }
      let body;
      try { body = JSON.parse(text); }
      catch { return reply(400, { ok: false, message: "JSON inválido." }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reply(400, { ok: false, message: "Campos inválidos." });
      }
      const acao = body.acao ?? "criar";
      if (acao === "alterar_senha") {
        if (Object.keys(body).some(key => !["acao", "usuario_id", "senha", "senha_atual"].includes(key)) ||
            typeof body.usuario_id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.usuario_id) ||
            typeof body.senha !== "string" || body.senha.length < 12 || body.senha.length > 128) {
          return reply(400, { ok: false, message: "Informe a conta e uma nova senha de 12 a 128 caracteres." });
        }
        const admin = clientFactory(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        const { data: target, error: targetError } = await admin.auth.admin.getUserById(body.usuario_id);
        if (targetError || target?.user?.id !== body.usuario_id) {
          return reply(404, { ok: false, message: "Não foi possível localizar a conta. Nenhuma senha foi alterada." });
        }
        const { data: targetProfile, error: targetProfileError } = await admin.from("perfis_usuarios")
          .select("perfil").eq("id", body.usuario_id).maybeSingle();
        if (targetProfileError) return reply(503, { ok: false, message: "Não foi possível conferir a conta. Nenhuma senha foi alterada." });
        const propriaConta = body.usuario_id === authData.user.id;
        if (targetProfile?.perfil === "master" && !propriaConta) {
          return reply(403, { ok: false, message: "Você não pode redefinir a senha de outra conta Master." });
        }
        if (propriaConta) {
          if (typeof body.senha_atual !== "string" || !body.senha_atual || body.senha_atual.length > 128 || !authData.user.email) {
            return reply(400, { ok: false, message: "Para mudar sua própria senha, informe também a senha atual." });
          }
          // Reautenticação isolada: nunca troca a conta da sessão no navegador.
          const reauth = clientFactory(url, publicKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
          const { data: checked, error: checkError } = await reauth.auth.signInWithPassword({
            email: authData.user.email, password: body.senha_atual
          });
          if (checkError || checked?.user?.id !== authData.user.id) {
            return reply(403, { ok: false, message: "A senha atual não foi confirmada. Nenhuma senha foi alterada." });
          }
          // Encerra só a sessão temporária criada para conferir a senha atual.
          try { await reauth.auth.signOut({ scope: "local" }); } catch { /* não usa a sessão Master do navegador */ }
        }
        // Confere novamente o papel do chamador imediatamente antes da escrita.
        const { data: currentProfile, error: currentProfileError } = await caller.from("perfis_usuarios")
          .select("perfil").eq("id", authData.user.id).maybeSingle();
        if (currentProfileError || currentProfile?.perfil !== "master") {
          return reply(403, { ok: false, message: "Seu acesso Master não foi confirmado. Nenhuma senha foi alterada." });
        }
        const { data: changed, error: changeError } = await admin.auth.admin.updateUserById(body.usuario_id, {
          password: body.senha
        });
        if (changeError?.code === "weak_password") {
          return reply(400, { ok: false, message: "A nova senha não atende às regras de segurança do Supabase. Escolha uma senha mais forte." });
        }
        if (changeError || changed?.user?.id !== body.usuario_id) {
          return reply(502, { ok: false, message: "Não foi possível confirmar a troca. Confira o acesso com a nova senha antes de reenviar." });
        }
        return reply(200, { ok: true, usuario_id: body.usuario_id, senha_alterada: true });
      }
      if (acao !== "criar" || Object.keys(body).some(key => !["acao", "usuario", "email", "senha", "perfil"].includes(key))) {
        return reply(400, { ok: false, message: "Ação ou campos inválidos." });
      }
      let email = "";
      let nomeUsuario = "";
      if (body.usuario !== undefined) {
        if (body.email !== undefined || typeof body.usuario !== "string") {
          return reply(400, { ok: false, message: "Informe somente o nome de usuário para o novo formato." });
        }
        nomeUsuario = body.usuario.trim().toLowerCase();
        if (nomeUsuario.length < 3 || nomeUsuario.length > 32 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(nomeUsuario)) {
          return reply(400, { ok: false, message: "Use um usuário de 3 a 32 caracteres, sem espaços ou acentos. Separe letras/números com ponto, hífen ou _." });
        }
        email = `${nomeUsuario}@usuarios.ominidata.invalid`;
      } else {
        // Compatibilidade com o formulário anterior. Não migra contas existentes.
        email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      }
      const senha = body.senha;
      const perfil = body.perfil;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          typeof senha !== "string" || senha.length < 12 || senha.length > 128 ||
          !["admin", "consulta"].includes(perfil)) {
        return reply(400, { ok: false, message: "Informe e-mail válido, senha de 12 a 128 caracteres e perfil Administrador ou Consulta." });
      }
      // Confere a instalação da etapa SQL ANTES de criar a conta no Auth.
      const { error: setupError } = await caller.rpc("listar_usuarios", {
        p_busca: "", p_limite: 1, p_offset: 0
      });
      if (setupError) return reply(503, { ok: false, message: "Não foi possível autorizar o cadastro. Confira o SQL da etapa 3. Nenhuma conta foi criada." });

      const admin = clientFactory(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true
      });
      if (createError) {
        if (["email_exists", "user_already_exists"].includes(createError.code || "")) {
          return reply(409, { ok: false, code: "EMAIL_EXISTENTE", message: "Este usuário ou e-mail já tem uma conta. Procure na lista, sem criar novamente." });
        }
        if (createError.code === "weak_password") {
          return reply(400, { ok: false, message: "A senha não atende às regras de segurança do seu Supabase. Escolha uma senha mais forte." });
        }
        // Não propaga erros internos que possam conter informações sensíveis.
        return reply(502, { ok: false, message: "Não foi possível confirmar o cadastro no Auth. Atualize a lista antes de tentar novamente." });
      }
      if (!created?.user?.id) {
        return reply(502, { ok: false, message: "O Auth não confirmou a conta. Atualize a lista antes de tentar novamente." });
      }
      const usuario = { id: created.user.id, email: created.user.email || email, usuario: nomeUsuario || email };
      // Conta sem perfil não pode entrar no site nem ler as bases. Só libera
      // após o SQL conferir novamente que o chamador continua sendo Master.
      try {
        const { data: assigned, error: assignError } = await caller.rpc("definir_perfil_usuario", {
          p_usuario_id: usuario.id, p_perfil: perfil
        });
        if (assignError || assigned?.id !== usuario.id || assigned?.perfil !== perfil) {
          throw new Error("Perfil não confirmado");
        }
      } catch {
        // Não apaga a conta nem tenta recriá-la automaticamente em falhas parciais.
        return reply(409, {
          ok: false, code: "PERFIL_PENDENTE", usuario,
          message: "A conta foi criada, mas o perfil não foi confirmado. Atualize a lista e use Salvar perfil ou Liberar acesso nessa conta. Não crie o mesmo usuário ou e-mail novamente."
        });
      }
      return reply(201, { ok: true, usuario: { ...usuario, perfil } });
    } catch {
      return reply(503, { ok: false, message: "Não foi possível confirmar a operação. Atualize a lista antes de reenviar. Nenhum reenvio foi feito automaticamente." });
    }
  };
}

if (typeof Deno !== "undefined") {
  Deno.serve(createHandler(createClient, key => Deno.env.get(key)));
}
