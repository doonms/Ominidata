import { supabase } from "./supa/supabaseClient.js";

const email = document.querySelector("#email");
const senha = document.querySelector("#senha");
const loginBtn = document.querySelector("#loginBtn");
const msg = document.querySelector("#msg");

// Email do administrador
const ADMIN_EMAIL = "dominicplf@gmail.com";

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? "Entrando..." : "Entrar";
}

async function autenticar() {
  const emailVal = email.value.trim();
  const senhaVal = senha.value.trim();

  if (!emailVal || !senhaVal) {
    msg.textContent = "Informe email e senha.";
    return;
  }

  setLoading(true);
  msg.textContent = "Autenticando...";

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailVal,
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

    sessionStorage.setItem("ominidata_user", JSON.stringify(data.user));
    localStorage.setItem("ominidata_user", JSON.stringify(data.user));

    const role = data.user.email === ADMIN_EMAIL ? "admin" : "user";
    sessionStorage.setItem("ominidata_role", role);
    localStorage.setItem("ominidata_role", role);

    msg.textContent = "Ok. Login realizado! Redirecionando...";
    setTimeout(() => {
      window.location.href = "../index.html";
    }, 800);
  } catch (err) {
    console.error("Erro inesperado ao autenticar:", err);
    msg.textContent = "Erro inesperado ao autenticar. Verifique a conexao.";
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
