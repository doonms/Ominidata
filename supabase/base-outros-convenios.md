# Base Outros Convênios

A página usa `js/api/baseOutrosConveniosApi.js` para ler e publicar exclusivamente
na tabela `public.base_outros_convenios`, do projeto configurado em
`js/supa/supabaseClient.js`.

Colunas esperadas: `banco_id text primary key`, `nome text`,
`suspenso boolean` e `dados jsonb`. As políticas do Supabase precisam permitir
SELECT para usuários autenticados e INSERT/UPDATE para o administrador.
Não use chave service_role no navegador nem desative RLS.

## Leitura e rascunhos

- Ao abrir a página, lê todas as páginas da tabela, inclusive bancos suspensos.
- Nome, suspensão e identidade vêm das colunas da linha. O JSON `dados` contém
  convênios, Padrão banco, operações, perfis, faixas, observações e contatos.
- O cache local limpo recebe as versões remotas. Rascunhos locais diferentes
  e bancos locais ainda não publicados são preservados; a mensagem da página
  informa quando isso acontece. Na primeira conexão, os dados locais antigos
  são tratados como rascunhos para não perder trabalho anterior.
- Leitura vazia, inválida, sem permissão ou com falha não apaga dados locais.
  Uma consulta iniciada antes de uma edição não pode sobrescrever essa edição.
- `Atualizar do Supabase` repete essa consulta segura, sem descartar rascunhos.

## Publicação

- `Enviar edição ao Supabase`: publica o cadastro exibido, após confirmação.
- `Enviar JSON`: seleciona e publica um arquivo. Aceita o array exportado pela
  página e o objeto antigo indexado por nome de banco.
- Valida o arquivo inteiro antes da primeira escrita, inclusive nomes,
  identificações repetidas, convênios e listas de faixas.
- Faz um único upsert em lote por `banco_id`, retornando os registros gravados
  para confirmar o envio. Não envia a coluna `id` e não executa DELETE.
- Uma publicação substitui o JSON completo dos bancos enviados, incluindo
  remoções de convênios e faixas dentro deles. Bancos ausentes do envio continuam
  no Supabase. Excluir um banco apenas do cadastro local não o exclui do servidor.
- O banco mantém seu `banco_id` ao ser renomeado. Arquivos antigos sem ID reutilizam
  a identidade remota pelo nome; bancos novos recebem uma identidade baseada no
  nome completo, sem a antiga abreviação de três letras.
- Se não houver confirmação do servidor, não informa sucesso nem troca o cache.
  Uma perda de conexão pode ocorrer após a gravação: confira a base antes de reenviar.
- Edições feitas durante um envio ficam locais e precisam de um novo envio.

## Armazenamento neste navegador

- Cadastro: `ominidata_base_outros_convenios_v1` (mantém o espelho antigo).
- Última versão remota: `ominidata_base_outros_convenios_v1_publicada`.
- Backup anterior à leitura, importação ou envio:
  `ominidata_base_outros_convenios_v1_backup`, com data e lista de bancos.

O backup é local, de uma versão, e não substitui exportar um JSON de segurança.
Atualizar o código do site não executa SQL nem publica os dados automaticamente.

## Verificação sem acessar o projeto real

```text
python tests/base-outros-sync.py
python tests/base-outros-convenios.py
python tests/base-outros-padrao.py
python tests/layout-operacional.py
python tests/navegacao-paginas.py
```

Os testes usam cliente Supabase simulado e bloqueiam chamadas HTTPS externas.
