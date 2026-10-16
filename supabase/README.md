# Base de Fatores

## Preparação do banco

No projeto Supabase configurado em `js/supa/supabaseClient.js`, abra **SQL Editor**
e execute `migrations/20261016_base_fatores_plano.sql` uma vez. O script adiciona
somente a coluna `plano`, para distinguir tabelas com o mesmo prazo; pode ser
executado novamente e não remove dados nem altera RLS.

Sem essa coluna, arquivos antigos sem nomes de tabela continuam sendo aceitos.
Arquivos com nomes são mantidos no navegador, mas o envio é bloqueado com uma
mensagem explicativa para não perder a identificação das tabelas.

## Envio e leitura

- **Importar JSON / Salvar neste navegador**: armazenamento local da mesma origem
  (protocolo, domínio e porta), não publica para outros usuários.
- **Enviar base ao Supabase**: valida todo o arquivo e exige sessão autenticada.
  Localiza registros de mesmo banco/data/tipo/prazo/plano e atualiza somente
  fator/taxa com `UPDATE` filtrado por ID. Registros iguais não são regravados;
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
python tests/simulador-fluxo.py
python tests/navegacao-paginas.py
```

Os testes usam um Supabase simulado. Não gravam no projeto real.
