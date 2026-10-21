# Base Outros Convênios

A página usa `js/api/baseOutrosConveniosApi.js` para ler e publicar exclusivamente
na tabela `public.base_outros_convenios`, do projeto configurado em
`js/supa/supabaseClient.js`.

Colunas esperadas: `banco_id text primary key`, `nome text`,
`suspenso boolean` e `dados jsonb`. As políticas do Supabase precisam permitir
SELECT para usuários autenticados e INSERT/UPDATE para o administrador.
Não use chave service_role no navegador nem desative RLS.

Para o envio com substituição completa, execute
`migrations/20261021_base_outros_substituicao.sql` no SQL Editor.
Instalar a migração não apaga dados. Ela cria uma função restrita ao administrador
e a tabela privada de backups `base_outros_convenios_backups`.

## Leitura e rascunhos

- Ao abrir a página, lê todas as páginas da tabela, inclusive bancos suspensos.
- Nome, suspensão e identidade vêm das colunas da linha. O JSON `dados` contém
  convênios, Padrão banco, operações, perfis, faixas, observações e contatos.
- O cache local limpo recebe as versões remotas. Rascunhos locais diferentes
  e bancos locais ainda não publicados são preservados; a mensagem da página
  informa quando isso acontece. Na primeira conexão, os dados locais antigos
  são tratados como rascunhos para não perder trabalho anterior.
- Uma leitura confirmada retira do cache versões publicadas já excluídas no
  servidor, inclusive quando a base remota foi esvaziada. Rascunhos e bancos
  locais inéditos são preservados. Exclusões locais pendentes não reaparecem.
  Leitura inválida, sem permissão ou com falha não altera o cadastro.
  Uma consulta iniciada antes de uma edição não pode sobrescrever essa edição.
- `Atualizar do Supabase` repete essa consulta segura, sem descartar rascunhos.

## Publicação

- `Enviar edição ao Supabase`: publica o cadastro exibido, após confirmação.
- `Enviar JSON`: seleciona e publica um arquivo. Aceita o array exportado pela
  página e o objeto antigo indexado por nome de banco.
- Valida o arquivo inteiro antes da primeira escrita, inclusive nomes,
  identificações repetidas, convênios e listas de faixas.
- Os dois botões fazem uma SUBSTITUIÇÃO COMPLETA. Um arquivo parcial também
  exclui os bancos ausentes. O aviso de confirmação informa esse comportamento.
- A RPC `substituir_base_outros_convenios` valida, confere a versão remota,
  guarda um backup, atualiza/insere bancos e exclui os ausentes em uma transação.
  Erros durante a operação revertem tudo, incluindo o backup.
- A função serializa a publicação e cancela se a base tiver mudado desde a
  consulta anterior ao envio. Não há fallback para exclusões fora da transação.
- Uma lista explicitamente vazia (`[]`) só pode esvaziar o Supabase após digitar
  `APAGAR TODOS`. Um objeto vazio ou JSON inválido não é uma ordem de exclusão.
- A resposta confirma o conjunto final, a quantidade excluída e o ID do backup.
  A página substitui também seu cache e a referência publicada, sem reintroduzir
  bancos apagados. Não envia a coluna identity `id`.
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

## Recuperar a versão anterior

Os backups remotos ficam privados, disponíveis pelo SQL Editor do administrador.
Para consultar as cópias e obter um JSON no formato aceito pelo site:

```sql
select id, criado_em, criado_por, jsonb_array_length(dados) as bancos
from public.base_outros_convenios_backups
order by id desc;

-- Troque 123 pelo ID desejado. Esta consulta apenas lê, não restaura.
select coalesce(jsonb_agg(b.value->'dados'), '[]'::jsonb) as json_para_enviar
from public.base_outros_convenios_backups as copia
cross join lateral jsonb_array_elements(copia.dados) as b
where copia.id = 123;
```

Revise o JSON recuperado antes de publicar: restaurar também substitui toda a base.

## Consulta no simulador

O seletor `Base da consulta` oferece INSS (padrão, com a pesquisa original intacta)
e Outros Convênios (consulta separada). A nova pesquisa lê apenas a versão
publicada de `base_outros_convenios`; não usa os rascunhos locais do editor.
Em falhas de conexão pode usar o último cache publicado, com aviso na tela.

- Convênio: Prefeitura, Governo ou SIAPE; Padrão banco não é uma oferta.
- Idade, busca por banco/convênio e os mesmos cinco produtos da pesquisa INSS.
- Contrato Normal usa as condições gerais. Celetista/Temporário exigem o
  respectivo perfil aceito e combinam suas faixas/prazos com os da operação.
- Todos os produtos precisam ser atendidos no mesmo convênio; não combina
  operações de convênios distintos nem mostra bancos/convênios suspensos.
- Cada resultado mantém produto, prazo e observações correspondentes.
  Documentos e margens podem ser consultados em Observações e condições.
- A simulação usa fator manual, conforme escolhido. Nunca reaproveita tabelas,
  fatores automáticos ou seguros INSS. Ao trocar a consulta, os dados anteriores
  de cada origem são preservados separadamente.

## Verificação sem acessar o projeto real

```text
python tests/base-outros-sync.py
python tests/base-outros-sql.py
python tests/base-outros-convenios.py
python tests/base-outros-padrao.py
python tests/layout-operacional.py
python tests/navegacao-paginas.py
python tests/simulador-outros.py
```

Os testes usam cliente Supabase simulado e bloqueiam chamadas HTTPS externas.
O teste SQL usa PostgreSQL em memória via PGlite, com os recursos locais indicados
no cabeçalho do teste. Não executa SQL no projeto real.
