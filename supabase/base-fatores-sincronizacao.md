# Base de Fatores — sincronização e envio direto

## Ativar no Supabase

1. No mesmo projeto configurado em `js/supa/supabaseClient.js`, abra **SQL Editor → New query**.
2. Cole todo o conteúdo de `supabase/migrations/20261026_base_fatores_sincronizacao.sql` e execute.
3. Abra novamente **Base de Fatores** no site atualizado.

Não é uma Edge Function. Não precisa alterar `criar-usuario` nem os acessos existentes.
A instalação adiciona colunas ausentes e a RPC `substituir_base_fatores`, sem publicar/excluir fatores.
A publicação continua restrita a **Master/Admin**, pela função já existente `pode_editar_bases()`.

## Botões e direção dos dados

- **Salvar neste navegador**: guarda somente a edição local.
- **Enviar base atual**: publica diretamente o cadastro completo de fatores INSS deste navegador.
  Tabelas/prazos ausentes são excluídos do servidor, depois da confirmação.
  Cada envio faz backup remoto e ocorre em uma única transação. Outros convênios não são excluídos.
- **Sincronizar do Supabase**: carrega a versão publicada e substitui tabelas/prazos locais, após confirmação.
  Descarta da edição os rascunhos e exclusões não publicados, mas guarda um backup local antes.
  Seguros, logos e outros metadados locais são mantidos. Não publica nada.
- **Enviar arquivo JSON**: mantém o modo aditivo anterior (adiciona/atualiza sem excluir o que falta no arquivo).
- **Importar JSON / Exportar JSON**: continuam disponíveis.

Para publicar as exclusões feitas no editor, use **Enviar base atual**, não o envio aditivo por arquivo.
Não sincronize do servidor antes de enviar se quiser preservar suas exclusões locais.
Antes do primeiro envio, confira o cadastro: versões antigas que já foram reintroduzidas no navegador
não podem ser distinguidas automaticamente de tabelas que ainda são desejadas.

## Campos vazios

Taxa é opcional. Tabelas sem nome/sem prazo e prazos sem prazo ou fator são rascunhos:
permanecem neste navegador e não são publicados. A confirmação mostra quantos serão deixados de fora.
O nome da tabela, prazo e fator precisam estar preenchidos para publicar uma linha do editor.
Valores inválidos preenchidos (zero/negativo, taxa não numérica, duplicação, vínculo inconsistente)
continuam bloqueando o envio. Se só houver rascunhos incompletos, nada será enviado ou apagado.
Uma base realmente vazia pode ser publicada somente com confirmação explícita.

## Carregamento e falhas

O editor não mistura automaticamente o servidor com uma edição local pendente; cadastros antigos
sem marca de sincronização também são preservados por segurança. O botão de sincronizar é explícito.
Alterações feitas enquanto uma consulta/envio está em andamento não são sobrescritas pela resposta.
O simulador usa somente os fatores retornados pelo servidor quando a consulta funciona, inclusive
quando a resposta é vazia. Seu cache remoto fica separado dos rascunhos do editor.
Sem conexão, usa o último cache remoto disponível; na ausência dele, tenta a base local.

Se outro operador alterar o servidor desde a consulta, a RPC cancela o envio para revisão.
Se a confirmação falhar por conexão, confira o servidor antes de tentar novamente.
Não existe fallback para apagar/inserir em chamadas separadas se o SQL estiver ausente.

## Backups

- Local, antes de sincronizar/enviar: `ominidata_base_fatores_backup_v1` no armazenamento deste navegador.
  O backup é rotativo (o mais recente); use **Exportar JSON** para guardar cópias permanentes.
- Remoto: `public.base_fatores_backups`, com data, usuário e registros anteriores.
  Os backups são privados e só ficam disponíveis por acesso administrativo ao banco/SQL Editor.
  Não apague esses backups se precisar recuperar uma publicação anterior.

Os testes automatizados usam navegador isolado e PostgreSQL em memória; não alteram o projeto real.
