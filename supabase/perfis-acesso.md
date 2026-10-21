# Perfis de acesso — implantação em etapas

## Etapa 1: já executada no projeto real

O SQL de `migrations/20261021_perfis_inicial.sql` registra o que foi enviado
na conversa: conta proprietária como Master, demais contas como Consulta,
leitura do próprio perfil e RLS ativo na Base Fatores.

Não é necessário repetir a etapa 1. Ela não deve ser usada para restaurar
permissões depois que a administração de usuários estiver implantada.

## Etapa 2: já executada no projeto real

1. Abra `supabase/migrations/20261021_perfis_permissoes.sql` no editor.
2. Copie **todo** o conteúdo, de `begin;` até a consulta final (os comentários
   também podem ser copiados).
3. No Supabase do site, abra **SQL Editor → New query**, cole e clique **Run**.
4. Confira que `base_fatores`, `base_inss` e `base_outros_convenios` mostram
   `protecao_rls_ativa = true`.
5. Abra o site local, atualize com **Ctrl+F5** e entre com sua conta Master.
6. Confira o menu e a abertura das bases. Em uma conta Consulta, confira
   Pesquisa, Simulador, Bancos e Contatos e a ausência das bases de edição.
7. As alterações do código ainda precisam ser publicadas no Netlify para
   valer no endereço público. Não há publicação automática nesta etapa.

O SQL troca somente as políticas das três bases auditadas e a autorização
da função de substituição completa de Outros Convênios. Não publica nem
altera os registros das bases, os backups ou a tabela `ominidata`.
O SQL é transacional: um erro antes do commit reverte a instalação.

| Ação | Master | Admin | Consulta |
| --- | --- | --- | --- |
| Pesquisa, Simulador, Bancos e Contatos | Sim | Sim | Sim |
| Edição/publicação das bases | Sim | Sim | Não |
| Cadastro de usuários pelo site | Sim, após ativar a etapa 3 | Não | Não |

O login e a navegação leem `perfis_usuarios` pelo ID autenticado. O navegador
não autoriza por e-mail, `user_metadata` ou cópias no localStorage. A proteção
efetiva das gravações fica nas políticas RLS e na função SQL, mesmo se alguém
modificar o navegador. Falhas na leitura do perfil não liberam acesso.

## Etapa 3: ativar o cadastro exclusivo do Master

A tela `pages/usuarios.html` e o menu **Usuários** estão preparados no código.
Somente Master pode abrir a tela, listar contas e definir perfis. Admin e
Consulta não têm acesso, mesmo por endereço direto. Ainda é necessário
instalar as funções abaixo no projeto Supabase usado pelo site.

### 3.1. Desabilitar cadastro público

No painel do Supabase, abra **Authentication → Sign In / Providers** e
desative **Allow new users to sign up**. Salve. Não desative o provedor de
e-mail nem altere o campo `role` interno do Supabase Auth. As contas que já
existem continuam podendo entrar. A criação administrativa pela função de
servidor não usa o endpoint público de signup.

Mesmo se o cadastro público ainda estiver ligado, esta implementação não
atribui perfis automaticamente a quem se cadastrar por fora: uma conta sem
linha em `perfis_usuarios` não consegue entrar no site nem ler as bases.

### 3.2. Instalar o SQL de gestão

1. Abra `supabase/migrations/20261021_usuarios_master.sql` no editor.
2. Copie todo o conteúdo.
3. Abra **SQL Editor → New query** no Supabase, cole e clique **Run**.
4. Espere a mensagem **Etapa 3 instalada. Agora publique a Edge Function
   criar-usuario.** Não precisa repetir os SQLs das etapas 1 e 2.

Esse SQL cria `listar_usuarios` e `definir_perfil_usuario`. Não cria contas,
não altera perfis existentes nem registros das bases. Somente Master pode
chamar essas funções. Elas não expõem senhas, hashes ou tokens. Não permitem
criar outro Master, alterar seu próprio Master ou rebaixar outro Master.

### 3.3. Publicar a Edge Function (não é código SQL)

1. No menu lateral do Supabase, abra **Edge Functions**.
2. Clique **Deploy a new function → Via Editor**.
3. Escolha **Hello World** ou o modelo vazio, caso apareça essa escolha.
4. Use exatamente o nome **criar-usuario**.
5. No editor do arquivo `index.ts`, apague o exemplo e cole **todo** o conteúdo
   de `supabase/functions/criar-usuario/index.ts` do projeto.
6. Clique **Deploy function** e aguarde a confirmação.
7. Mantenha **Verify JWT** / verificação de autenticação **ativada** nas
   configurações da função. Não use uma anon key no lugar da sessão de usuário.

Não cole a função no SQL Editor. Não coloque chaves no código e não envie
chaves no chat. Ela lê `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY` do ambiente do próprio Supabase. Esses valores
legados normalmente já são disponibilizados no projeto hospedado que o site
utiliza. Se aparecer **Ambiente da função incompleto**, confira os nomes em
**Edge Functions → Secrets**; não substitua a chave pública do site por uma
chave administrativa.

O CORS aceita `https://ominidata.netlify.app` e Live Server em localhost ou
127.0.0.1. Caso publique em um domínio diferente, adicione a variável de
ambiente `OMINIDATA_ALLOWED_ORIGINS` na função com as origens completas
separadas por vírgula, por exemplo `https://painel.seudominio.com.br`, e
republique. Não é necessário configurar isso para os endereços atuais.

### 3.4. Usar a tela

1. Abra o site local, pressione **Ctrl+F5** e entre com sua conta Master.
2. Abra **Usuários** no menu. Também pode abrir
   `http://127.0.0.1:5500/Ominidata/pages/usuarios.html`.
3. Confira sua conta como Master, sem controles para alterar seu perfil.
4. Para uma conta existente, escolha **Consulta** ou **Administrador** e
   clique **Salvar perfil**. Leia e confirme a mudança.
5. Para uma conta nova, preencha o nome de usuário (por exemplo `maria.silva`),
   senha inicial de 12 a 128 caracteres e perfil. Clique **Criar usuário** apenas
   uma vez. Não precisa de caixa de e-mail.
6. Confira a confirmação e a conta na lista. Compartilhe a senha inicial
   apenas com a pessoa, em canal privado. Ela não fica salva pela tela.
7. Em outro perfil do navegador ou janela anônima, entre com a nova conta e
   confira seus acessos, mantendo sua sessão Master aberta separadamente.

O cadastro novo usa um endereço técnico interno no Supabase Auth, confirmado
pelo servidor. Não é enviado convite nem e-mail automático. A senha inicial
funciona imediatamente, não possui troca obrigatória implementada e não é
exibida na lista. O Master pode substituí-la pela tela, conforme a etapa 4.

### Falhas sem perda ou duplicação

- **SQL ausente:** a tela informa o arquivo necessário e bloqueia criar.
- **Função não publicada:** a tela avisa; o código não anuncia sucesso.
- **E-mail já cadastrado:** localize a conta e altere o perfil, sem recriar.
- **Conta criada, mas perfil não confirmado:** atualize a lista e use
  **Liberar acesso** (se estiver sem perfil) ou **Salvar perfil**. A função
  não apaga contas nem tenta criá-las novamente. Uma resposta perdida pode
  ocorrer depois de o perfil ter sido salvo: confira o perfil atual na lista.
- **Rede falhando:** confira a lista antes de reenviar; não há retry
  automático de criação. Os dados das bases não são alterados.

Após confirmar o funcionamento local, é necessário publicar os arquivos do
site no Netlify para aparecer no endereço público. Publicar a Edge Function
no Supabase não publica os arquivos HTML/JS/CSS do site.

Referências oficiais: [criação de usuários no servidor](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[publicação pelo editor do Supabase](https://supabase.com/docs/guides/functions/quickstart-dashboard),
[variáveis de ambiente](https://supabase.com/docs/guides/functions/secrets).

## Etapa 4: usuário sem e-mail e troca de senhas

### Ativar a atualização

Não há SQL novo nesta etapa: os perfis, IDs e políticas permanecem os mesmos.

1. No Supabase, abra **Edge Functions → criar-usuario → Code / Edit code**.
2. Substitua o conteúdo de `index.ts` pelo arquivo **atualizado**
   `supabase/functions/criar-usuario/index.ts` deste projeto.
3. Clique **Deploy updates** e mantenha **Verify JWT** ativado.
4. No site local, pressione **Ctrl+F5** e abra **Usuários** com seu Master.

Se a função ainda estiver na versão anterior, o cadastro por usuário e a
troca de senha serão recusados. A tela não anuncia sucesso sem confirmação.
O nome da função continua `criar-usuario`; ela agora atende também à ação
`alterar_senha`. Não crie uma segunda função e não cole esse código no SQL Editor.

### Como funciona o novo login

- Novas contas usam nomes como `maria.silva`, `joao_01` e `equipe-2`.
- Use de 3 a 32 caracteres, com letras sem acentos e números. Ponto, hífen
  e sublinhado podem separar letras/números; não são permitidos no início,
  no fim ou em sequência. Maiúsculas e minúsculas representam o mesmo login.
- O nome precisa ser único; uma tentativa repetida não recria a conta nem
  redefine seu perfil ou senha.
- A tela de entrada aceita **Usuário ou e-mail**. As contas que já existiam,
  inclusive seu Master, continuam com o mesmo e-mail e senha. Não são migradas
  nem renomeadas automaticamente. Não crie outra conta para substituir seu Master.
- Internamente `maria.silva` corresponde a
  `maria.silva@usuarios.ominidata.invalid`. Esse endereço é apenas um identificador
  técnico, não é caixa postal e não recebe mensagens. A tela mostra o usuário.
- As senhas e sessões continuam no **Supabase Auth**, não em tabelas públicas.
  Não há busca pública que exponha o e-mail das contas antigas.
- A tradução é idêntica no login e na função. Não altere o domínio técnico
  depois de criar contas sem planejar uma migração, pois o identificador do
  Auth precisa corresponder ao que o login usa.

### Trocar uma senha pela tela

1. Abra **Usuários**, localize a conta e clique em **Alterar senha**.
2. Digite e confirme a nova senha (12 a 128 caracteres).
3. Clique **Salvar nova senha** e confirme a conta indicada na mensagem.
4. Aguarde **Senha alterada**. Compartilhe a nova senha em canal privado.

Você não precisa saber a senha anterior de um usuário comum. A operação
substitui a senha no Auth sem recriar a conta, trocar o login, alterar o perfil
ou mudar dados das bases. As senhas anteriores não são exibidas. Os campos
são limpos após o envio ou ao recolher o formulário; não são persistidos pela tela.

Para mudar **sua própria senha Master**, abra **Alterar minha senha** na sua
conta. É obrigatório informar a senha atual, conferida em uma sessão temporária
isolada no servidor. Essa sessão temporária é encerrada apenas com escopo local;
não se usa o token do navegador para deslogar outras contas. Outro Master não
pode redefinir sua senha por esta função. Admin e Consulta não podem trocar
senhas pela administração, mesmo chamando o endpoint diretamente.

O site não implementa expulsão imediata de todas as sessões do usuário-alvo.
A senha antiga deixa de autenticar novos logins; não trate isso como garantia
de que uma aba já aberta foi encerrada instantaneamente. Se sua própria sessão
pedir login depois da troca, use a nova senha.

Se uma falha de conexão impedir confirmar a operação, teste a nova senha em
janela anônima antes de reenviar; não há reenvio automático. Como os novos
logins não têm e-mail real, a recuperação fica a cargo do Master por esta tela.
Se o próprio Master esquecer a senha, será necessário usar os mecanismos
administrativos oficiais do Supabase; não remova a verificação da senha atual
nem edite hashes de senha manualmente.

Referência: [alterar senha no servidor com updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## Verificação local automatizada (sem Supabase real)

- `tests/login-sessao.py`: regressão de retorno indevido ao login durante
  recuperação/reconfirmação da sessão; reload, foco, troca de conta e logout.
  Aceita `OMINIDATA_LOGIN_URL` para conferir o JavaScript servido no Live Server.
- `tests/perfis-acesso.py`: login, menus, endereços diretos, navegação SPA,
  perfis alterados, falhas de rede e tentativas de falsificar o armazenamento.
- `tests/perfis-sql.py`: migração em PostgreSQL isolado, RLS nas três bases,
  gravação por Master/Admin, bloqueio de Consulta e visitante, proteção dos
  perfis, autorização da substituição completa de Outros Convênios e das
  funções exclusivas de gestão do Master.
- `tests/usuarios-funcao.py`: lógica da Edge Function com clientes injetados,
  CORS, autenticação, cadastro por usuário/e-mail, troca de senha, reautenticação
  do próprio Master e falhas parciais, sem Deno/Supabase real.
- `tests/usuarios-tela.py`: formulários, menus, mudanças de perfil, pendências,
  troca de senha, senha não persistida, busca/paginação, layout responsivo e SPA.
