# Base de Fatores

## Preparação do banco

A aplicação não divide mais fatores por datas. O formato atual é
`Banco.fatores = { margem: [...], cartao: [...] }`. O editor não tem calendário
nem remoção automática por antiguidade; as simulações usam essas mesmas listas.

JSONs e caches antigos continuam aceitos. As versões são unificadas por
modalidade, prazo e nome da tabela: para a mesma tabela vence a versão da data
mais recente; tabelas distintas presentes apenas em datas antigas também são
preservadas. Antes de converter o cache, o original fica em
`localStorage.ominidata_base_fatores_antes_unificar_datas_v1` (`criadoEm`, `bancos`).
Essa cópia não é sobrescrita nas próximas aberturas.

Datas antigas no Supabase servem apenas para escolher a versão anterior mais
recente de uma tabela. A identidade de leitura/envio agora é banco, modalidade,
prazo e nome. O app atualiza o ID da versão escolhida e não apaga registros antigos.
Projetos cuja coluna `data` ainda existe recebem `1970-01-01` apenas nos
novos INSERTs, como compatibilidade técnica com NOT NULL; a data não é usada
para dividir, editar ou exportar a base. Projetos sem essa coluna também são
aceitos. Não é necessário apagar a coluna ou executar uma migração destrutiva.

No projeto Supabase configurado em `js/supa/supabaseClient.js`, abra **SQL Editor**
e execute `migrations/20261016_base_fatores_plano.sql` uma vez. O script adiciona
somente a coluna `plano`, para distinguir tabelas com o mesmo prazo; pode ser
executado novamente e não remove dados nem altera RLS.

Sem essa coluna, arquivos antigos sem nomes de tabela continuam sendo aceitos.
Arquivos com nomes são mantidos no navegador, mas o envio é bloqueado com uma
mensagem explicativa para não perder a identificação das tabelas.

Para publicar vínculos de fator, execute também
`migrations/20261020_base_fatores_vinculos.sql`. Adiciona somente a coluna
`grupo_fator`, sem alterar IDs, registros ou políticas. Sem essa coluna, bases
sem vínculos continuam funcionando; arquivos com vínculos não são enviados
parcialmente nem têm seus vínculos descartados.

## Vincular fatores de tabelas

Em **Vincular fator**, escolha outra tabela do mesmo banco e modalidade
e confirme. A tabela passa a usar o fator da escolhida; se os fatores forem
diferentes, uma confirmação avisa antes de substituir o valor. Outras tabelas
podem entrar no mesmo grupo. Não há vínculos automáticos por igualdade de fator.

- Editar o fator de qualquer membro atualiza os outros membros do grupo.
- Nome, taxa e prazo permanecem independentes. Outro banco ou modalidade
  não é alterado.
- **Desvincular esta tabela** conserva o fator atual, que pode ser editado sozinho.
- Vínculos ficam no navegador e no JSON exportado. Exporte e envie o JSON para
  publicar fatores e vínculos para os demais usuários no Supabase.
- Arquivos antigos sem a propriedade `grupo_fator` não desfazem vínculos
  remotos; `grupo_fator: null` é a remoção explícita do vínculo.
- Um arquivo que deixe fatores diferentes no mesmo grupo é rejeitado antes da
  primeira gravação. Envie as tabelas vinculadas juntas.

## Envio e leitura

- **Importar JSON / Salvar neste navegador**: armazenamento local da mesma origem
  (protocolo, domínio e porta), não publica para outros usuários.
- **Enviar base ao Supabase**: valida todo o arquivo e exige sessão autenticada.
  Localiza registros de mesmo banco/tipo/prazo/plano e atualiza somente
  fator/taxa e o vínculo explícito com `UPDATE` filtrado por ID. Registros iguais não são regravados;
  os novos são enviados em um lote de `INSERT`, **sem o campo ID**, para respeitar
  colunas `GENERATED ALWAYS AS IDENTITY`. Não apaga fatores ausentes nem outros
  convênios. Renomear uma tabela importa um novo registro, sem excluir a antiga.
- As atualizações e a inserção são requisições separadas, não uma transação do
  arquivo inteiro. Se houver falha após alguma gravação confirmada, o sistema
  informa envio parcial e a quantidade confirmada. Preserve o JSON e confira a
  base; ao reenviar, os registros já iguais são mantidos sem duplicar ou trocar IDs.
- As permissões de leitura, inserção e atualização continuam sendo controladas
  pelas políticas existentes do Supabase. Não use uma chave `service_role` no
  frontend nem libere escrita pública para contornar erros de acesso.
- Base de Fatores e Simulador usam `js/api/baseFatoresApi.js`, com leitura paginada.
  Respostas vazias/erros não limpam o cache; registros locais, seguros e logos são
  preservados. Seguros e logos **não** são enviados para `base_fatores` neste fluxo.
- Antes de mesclar dados na Base de Fatores, a versão anterior fica em
  `localStorage.ominidata_base_fatores_backup_v1` (objeto com `data` e `bancos`).
  É uma cópia local de segurança, não substitui guardar o JSON original.

Se o upload anterior falhou após uma exclusão, estas correções não recuperam os
registros apagados. Depois de preparar o banco, reenvie o JSON original ou uma
exportação local que ainda contenha os fatores.

## Verificação local sem gravações reais

Com Playwright e Chrome disponíveis:

```text
python tests/base-fatores-sync.py
python tests/base-fatores-sem-datas.py
python tests/base-fatores-vinculos.py
python tests/simulador-fluxo.py
python tests/navegacao-paginas.py
```

Os testes usam um Supabase simulado. Não gravam no projeto real.
