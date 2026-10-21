import { supabase } from "./supa/supabaseClient.js";
import { getCurrentUser, limparIdentidadeLocal } from "./auth/accessControl.js";
import { emailParaLogin } from "./auth/identificador.js";

const email = document.querySelector("#email");
const senha = document.querySelector("#senha");
const loginBtn = document.querySelector("#loginBtn");
const msg = document.querySelector("#msg");

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? "Entrando..." : "Entrar";
}

async function autenticar() {
  const emailVal = email.value.trim();
  const senhaVal = senha.value;

  if (!emailVal || !senhaVal) {
    msg.textContent = "Informe usuário ou e-mail e senha.";
    return;
  }

  setLoading(true);
  limparIdentidadeLocal();
  msg.textContent = "Autenticando...";

  try {
    const emailAuth = emailParaLogin(emailVal);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailAuth,
      password: senhaVal
    });

    if (error) {
      console.error("Erro no login Supabase:", error);
      msg.textContent = "Erro: " + (error?.message || "Falha ao autenticar.");
      return;
    }

    if (!data?.user) {
      msg.textContent = "Erro: resposta invalida da autenticacao.";
      return;
    }

    const user = await getCurrentUser();
    if (!user) throw new Error("Sua sessão não foi confirmada. Tente entrar novamente.");

    msg.textContent = "Ok. Login realizado! Redirecionando...";
    setTimeout(() => {
      window.location.href = "../index.html";
    }, 800);
  } catch (err) {
    console.error("Erro inesperado ao autenticar:", err);
    msg.textContent = err.message || "Erro inesperado ao autenticar. Verifique a conexão.";
  } finally {
    setLoading(false);
  }
}

loginBtn.addEventListener("click", autenticar);

// Permite submit via Enter nas inputs
[email, senha].forEach(input => {
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      autenticar();
    }
  });
});
