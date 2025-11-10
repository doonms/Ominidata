import { supabase } from "./supa/supabaseClient.js";

const email = document.querySelector("#email");
const senha = document.querySelector("#senha");
const loginBtn = document.querySelector("#loginBtn");
const msg = document.querySelector("#msg");

// Email do administrador
const ADMIN_EMAIL = "dominicplf@gmail.com";

loginBtn.addEventListener("click", async () => {
  msg.textContent = "Autenticando...";

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.value.trim(),
    password: senha.value.trim()
  });

  if (error) {
    msg.textContent = "❌ " + error.message;
    return;
  }

  // Salva o usuário logado
  sessionStorage.setItem("ominidata_user", JSON.stringify(data.user));

  // Define o papel (admin ou user)
  if (data.user.email === ADMIN_EMAIL) {
    sessionStorage.setItem("ominidata_role", "admin");
  } else {
    sessionStorage.setItem("ominidata_role", "user");
  }

  msg.textContent = "✅ Login realizado! Redirecionando...";
  setTimeout(() => {
    window.location.href = "../index.html";
  }, 800);
});
