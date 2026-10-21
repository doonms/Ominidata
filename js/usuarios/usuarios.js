import { supabase } from '../supa/supabaseClient.js';
import { getCurrentUser, isMaster } from '../auth/accessControl.js';
import { nomeDeAcesso, normalizarUsuario, usuarioValido } from '../auth/identificador.js';

const NOMES = { master: 'Master', admin: 'Administrador', consulta: 'Consulta' };

function mensagemSql(error) {
  if (['PGRST202', '42883'].includes(error?.code)) {
    return 'Falta instalar o SQL da etapa 3: supabase/migrations/20261021_usuarios_master.sql.';
  }
  if (error?.code === '42501') return 'Acesso negado. Somente o Master pode gerenciar usuários.';
  return 'Não foi possível confirmar a operação. Confira a conexão e atualize a lista antes de reenviar.';
}

function informar(element, text, tipo = '') {
  if (!element?.isConnected) return;
  element.textContent = text;
  element.dataset.tipo = tipo;
}

function dataPt(value) {
  if (!value) return 'Ainda não entrou';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR');
}

export async function initUsuarios() {
  const root = document.querySelector('.usuarios-grid');
  if (!root) return;
  const list = root.querySelector('#usuarios-lista');
  const status = root.querySelector('#usuarios-list-status');
  const formStatus = root.querySelector('#usuarios-form-status');
  const createForm = root.querySelector('#usuarios-criar-form');
  const createBtn = root.querySelector('#usuario-criar');
  const searchForm = root.querySelector('#usuarios-busca-form');
  const search = root.querySelector('#usuarios-busca');
  const prev = root.querySelector('#usuarios-anterior');
  const next = root.querySelector('#usuarios-proxima');
  const pageText = root.querySelector('#usuarios-pagina');
  let user;
  try { user = await getCurrentUser(); }
  catch {
    informar(status, 'Não foi possível confirmar seu perfil. Atualize a página para tentar novamente.', 'erro');
    return;
  }
  if (!isMaster(user)) {
    informar(status, 'Somente o Master pode gerenciar usuários.', 'erro');
    return;
  }
  let offset = 0;
  let request = 0;
  let creating = false;
  let ready = false;
  const limit = 50;

  function adicionarTrocaSenha(account, card) {
    const propriaConta = account.id === user.id;
    if (account.perfil === 'master' && !propriaConta) return;
    const details = document.createElement('details');
    details.className = 'usuario-senha-details';
    const summary = document.createElement('summary');
    summary.textContent = propriaConta ? 'Alterar minha senha' : 'Alterar senha';
    const form = document.createElement('form');
    form.className = 'usuario-senha-form';
    form.autocomplete = 'off';
    const hint = document.createElement('p');
    hint.textContent = propriaConta ? 'Confirme sua senha atual para proteger sua conta Master.' : 'Defina uma nova senha. A senha anterior não é exibida nem necessária.';
    form.append(hint);
    function campo(text, atual = false) {
      const label = document.createElement('label');
      label.textContent = text;
      const input = document.createElement('input');
      input.type = 'password';
      input.required = true;
      input.minLength = atual ? 1 : 12;
      input.maxLength = 128;
      input.autocomplete = atual ? 'current-password' : 'new-password';
      input.dataset.senha = atual ? 'atual' : 'nova';
      label.append(input);
      form.append(label);
      return input;
    }
    const atual = propriaConta ? campo('Senha atual', true) : null;
    const nova = campo('Nova senha (mínimo 12 caracteres)');
    const confirmar = campo('Confirmar nova senha');
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'od-secondary';
    save.textContent = 'Salvar nova senha';
    const feedback = document.createElement('p');
    feedback.className = 'usuarios-status';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    form.append(save, feedback);
    const inputs = [atual, nova, confirmar].filter(Boolean);
    const limpar = () => { inputs.forEach(input => { input.value = ''; }); confirmar.setCustomValidity(''); };
    details.addEventListener('toggle', () => { if (!details.open) limpar(); });
    nova.oninput = confirmar.oninput = () => confirmar.setCustomValidity('');
    form.onsubmit = async event => {
      event.preventDefault();
      if (save.disabled) return;
      confirmar.setCustomValidity(nova.value === confirmar.value ? '' : 'As duas senhas precisam ser iguais.');
      if (!form.reportValidity()) return;
      if (!window.confirm(`Alterar a senha de ${nomeDeAcesso(account.email)}? A senha anterior deixará de servir para novos logins.`)) return;
      const body = { acao: 'alterar_senha', usuario_id: account.id, senha: nova.value };
      if (atual) body.senha_atual = atual.value;
      save.disabled = true;
      inputs.forEach(input => { input.disabled = true; });
      informar(feedback, 'Alterando a senha…');
      try {
        const { data, error } = await supabase.functions.invoke('criar-usuario', { body });
        if (error) {
          let detail;
          try { detail = await error.context?.json(); } catch { /* erro sem corpo JSON */ }
          throw new Error(detail?.message || 'Não foi possível confirmar a troca. Confira se a função criar-usuario foi atualizada no Supabase e teste a nova senha antes de reenviar.');
        }
        if (!data?.ok || !data.senha_alterada || data.usuario_id !== account.id) {
          throw new Error(data?.message || 'A troca de senha não foi confirmada. Confira o acesso antes de reenviar.');
        }
        informar(feedback, 'Senha alterada. Compartilhe a nova senha em canal privado. Se for sua conta, use a nova senha no próximo login.', 'sucesso');
      } catch (error) {
        informar(feedback, error.message || 'Não foi possível confirmar a troca de senha.', 'erro');
      } finally {
        limpar();
        save.disabled = false;
        inputs.forEach(input => { input.disabled = false; });
      }
    };
    details.append(summary, form);
    card.append(details);
  }

  function render(rows) {
    list.replaceChildren();
    for (const account of rows) {
      const card = document.createElement('article');
      card.className = 'usuario-card';
      card.dataset.usuarioId = account.id;
      const title = document.createElement('h3');
      const nomeAcesso = nomeDeAcesso(account.email) || 'Conta sem identificação';
      title.textContent = nomeAcesso;
      const badge = document.createElement('span');
      badge.className = 'usuario-badge';
      badge.dataset.perfil = account.perfil || 'pendente';
      badge.textContent = NOMES[account.perfil] || 'Sem perfil — acesso bloqueado';
      const info = document.createElement('p');
      info.textContent = `Criado em ${account.criado_em ? dataPt(account.criado_em) : 'não informado'} · Último acesso: ${dataPt(account.ultimo_acesso)}`;
      card.append(title, badge, info);
      if (account.perfil === 'master' || account.id === user.id) {
        const protectedNote = document.createElement('p');
        protectedNote.textContent = account.id === user.id ? 'Seu perfil Master está protegido. Para trocar sua senha, confirme a senha atual abaixo.' : 'Conta Master protegida.';
        card.append(protectedNote);
      } else {
        const edit = document.createElement('form');
        edit.className = 'usuario-editar';
        const label = document.createElement('label');
        label.textContent = 'Perfil de acesso';
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Perfil de ${nomeAcesso}`);
        for (const value of ['consulta', 'admin']) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = NOMES[value];
          select.append(option);
        }
        select.value = account.perfil || 'consulta';
        label.append(select);
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'od-secondary';
        save.textContent = account.perfil ? 'Salvar perfil' : 'Liberar acesso';
        edit.append(label, save);
        edit.onsubmit = async event => {
          event.preventDefault();
          if (save.disabled) return;
          const perfil = select.value;
          if (perfil === account.perfil) {
            informar(status, 'Este usuário já possui o perfil escolhido.');
            return;
          }
          if (!window.confirm(`Definir ${nomeAcesso} como ${NOMES[perfil]}?${perfil === 'admin' ? ' Esse perfil pode editar e publicar as bases.' : ' Esse perfil não poderá editar as bases.'}`)) return;
          save.disabled = select.disabled = true;
          try {
            const { data, error } = await supabase.rpc('definir_perfil_usuario', {
              p_usuario_id: account.id, p_perfil: perfil
            });
            if (error) throw error;
            if (data?.id !== account.id || data?.perfil !== perfil) throw new Error('Resposta não confirmada');
            account.perfil = perfil;
            badge.dataset.perfil = perfil;
            badge.textContent = NOMES[perfil];
            save.textContent = 'Salvar perfil';
            informar(status, `Perfil de ${nomeAcesso} salvo como ${NOMES[perfil]}.`, 'sucesso');
          } catch (error) {
            informar(status, mensagemSql(error), 'erro');
          } finally {
            save.disabled = select.disabled = false;
          }
        };
        card.append(edit);
      }
      adicionarTrocaSenha(account, card);
      list.append(card);
    }
  }

  async function carregar() {
    const currentRequest = ++request;
    prev.disabled = next.disabled = true;
    informar(status, 'Consultando usuários…');
    try {
      const { data, error } = await supabase.rpc('listar_usuarios', {
        p_busca: search.value.trim(), p_limite: limit, p_offset: offset
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Lista não confirmada');
      if (!root.isConnected || currentRequest !== request) return;
      const total = Number(data[0]?.total || 0);
      // Uma exclusão externa pode ter esvaziado a página atual.
      if (!data.length && offset > 0) { offset = 0; return carregar(); }
      render(data);
      ready = true;
      createBtn.disabled = creating;
      prev.disabled = offset === 0;
      next.disabled = offset + limit >= total;
      pageText.textContent = total ? `${offset + 1}–${offset + data.length} de ${total}` : 'Nenhuma conta';
      informar(status, data.length ? `${total} conta(s) encontrada(s).` : 'Nenhuma conta corresponde à pesquisa.');
    } catch (error) {
      if (currentRequest !== request) return;
      ready = false;
      createBtn.disabled = true;
      informar(status, mensagemSql(error), 'erro');
    }
  }

  searchForm.onsubmit = event => { event.preventDefault(); offset = 0; carregar(); };
  prev.onclick = () => { offset = Math.max(0, offset - limit); carregar(); };
  next.onclick = () => { offset += limit; carregar(); };
  createForm.onsubmit = async event => {
    event.preventDefault();
    if (creating || !ready || !createForm.reportValidity()) return;
    const loginField = root.querySelector('#usuario-login');
    const passwordField = root.querySelector('#usuario-senha');
    const perfilField = root.querySelector('#usuario-perfil');
    const usuario = normalizarUsuario(loginField.value);
    if (!usuarioValido(usuario)) {
      informar(formStatus, 'Use um usuário de 3 a 32 caracteres, sem espaços ou acentos, com letras, números e separadores ponto, hífen ou _.', 'erro');
      return;
    }
    const perfil = perfilField.value;
    creating = true;
    createBtn.disabled = true;
    loginField.disabled = passwordField.disabled = perfilField.disabled = true;
    informar(formStatus, 'Criando a conta e conferindo o perfil…');
    try {
      const { data, error } = await supabase.functions.invoke('criar-usuario', {
        body: { usuario, senha: passwordField.value, perfil }
      });
      if (error) {
        let detail;
        try { detail = await error.context?.json(); } catch { /* resposta sem JSON */ }
        if (detail?.message) {
          if (['PERFIL_PENDENTE', 'EMAIL_EXISTENTE'].includes(detail.code)) {
            offset = 0;
            search.value = '';
            await carregar();
          }
          throw new Error(detail.message);
        }
        throw new Error('Não foi possível confirmar o cadastro. Confira se a Edge Function criar-usuario foi publicada. Atualize a lista antes de tentar novamente.');
      }
      if (!data?.ok || !data.usuario?.id || data.usuario?.perfil !== perfil) {
        throw new Error(data?.message || 'O cadastro não foi confirmado. Atualize a lista antes de reenviar.');
      }
      createForm.reset();
      informar(formStatus, `Conta ${usuario} criada como ${NOMES[perfil]}. Compartilhe o usuário e a senha inicial por um canal privado.`, 'sucesso');
      offset = 0;
      search.value = '';
      await carregar();
    } catch (error) {
      informar(formStatus, error.message || 'Não foi possível confirmar o cadastro. Atualize a lista antes de reenviar.', 'erro');
    } finally {
      passwordField.value = '';
      loginField.disabled = passwordField.disabled = perfilField.disabled = false;
      creating = false;
      if (root.isConnected) createBtn.disabled = !ready;
    }
  };
  carregar();
}
