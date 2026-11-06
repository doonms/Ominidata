# Base de Fatores

## Preparação do banco

A base é organizada por tabela nomeada e seus prazos. O formato do cadastro/JSON é:

```json
{
  "Banco": {
    "tabelas": {
      "margem": [{
        "nome": "210436 Tkt > 20k -Plus-ML",
        "prazos": [
          {"prazo": 12, "fator": 0.1, "taxa": 1.7},
          {"prazo": 24, "fator": 0.05, "taxa": 1.8}
        ]
      }],
      "cartao": []
    },
    "seguros": []
  }
}
```

Use **Adicionar tabela**, informe o nome e selecione os prazos padrão
12, 24, 36, 48, 60, 72, 84, 96, 108 e 120 meses. Também existe prazo personalizado
inteiro positivo e **Adicionar todos os padrões**. Prazos repetidos não são adicionados.
Os botões de prazos padrão alternam entre adicionar e remover. Ao remover um
prazo com fator ou taxa preenchidos, é solicitada confirmação.
Cada prazo tem seu fator e sua taxa; taxa vazia não aparece na simulação.
Cada tabela pode ser recolhida ou expandida pelo botão no cabeçalho.
Tabelas cadastradas iniciam recolhidas; ao adicionar uma nova tabela, ela abre
expandida para preencher os dados. Reabrir a página volta ao padrão recolhido.
O nome, a contagem de prazos e a seleção em lote continuam visíveis quando
recolhida. Abrir ou fechar não altera os fatores, taxas ou público cadastrado.
O cadastro não tem divisão por datas.

Rascunhos de tabelas sem prazos podem ser salvos e exportados localmente.
Uma linha antiga com prazo vazio é exibida como **Prazo pendente**, sem bloquear
a abertura da base. Informe um prazo válido nessa linha ou remova o rascunho.
Fator e taxa são preservados; linhas pendentes não entram no cálculo do simulador
e impedem a publicação do arquivo até serem corrigidas. Antes da conversão, o
original fica em `localStorage.ominidata_base_fatores_antes_editor_tabelas_v1`.
Para publicar no Supabase, todas as tabelas devem ter nome distinto na modalidade
e pelo menos um prazo com fator válido. A camada de leitura projeta cada prazo
com o nome de sua tabela para o simulador individual, comparação e envio à API.

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

## Público das tabelas

Cada tabela tem interruptores **Assina / Não assina** e **Invalidez / Sem invalidez**.
As opções de um mesmo grupo são exclusivas; clicar novamente desmarca a opção.
Sem nenhuma marcação, a tabela é normal e aparece para todos os clientes.
Com uma marcação em cada grupo, o cliente precisa atender às duas condições.
O público vale para todos os prazos dessa tabela e não é alterado pelo vínculo de fatores.

O JSON guarda, por exemplo, `"publico": {"assinatura": "nao", "invalidez": "sim"}`
junto de `nome` e `prazos`. Os valores aceitos em cada campo são `todos`, `sim` e `nao`.
No Supabase, cada prazo recebe as colunas `publico_assinatura` e `publico_invalidez`.
Para publicar essas marcações, execute uma vez no SQL Editor
`migrations/20261020_base_fatores_publico.sql`. A migração é aditiva e não altera
IDs, dados de fatores, vínculos ou permissões.

O simulador lê **Cliente assina?** e **Espécie** da pesquisa, mesmo quando o banco
é escolhido manualmente. A lista individual e a comparação usam o mesmo filtro.
Alterar o perfil atualiza as tabelas e invalida os resultados anteriores.
Com assinatura **Não informado**, tabelas exclusivas de quem assina/não assina
ficam ocultas até informar o perfil. Espécie **Invalidez** seleciona esse público;
Geral, LOAS e Pensão são considerados sem invalidez. Tabelas normais continuam
visíveis e o cálculo com fator manual permanece livre.

## Grupos de fatores

Em cada banco/modalidade, marque as tabelas (ou use **Selecionar todas**), escolha
a **Tabela de referência** e use **Salvar e sincronizar grupo**. O grupo salvo é o
próprio vínculo dos fatores: prazos iguais recebem o fator e a taxa da referência
e passam a ser atualizados juntos. Prazos exclusivos continuam na tabela e entram
automaticamente no vínculo se o mesmo prazo for adicionado a outro membro.

Depois, escolha o grupo e clique em **Selecionar grupo** para marcar todos os seus
membros, inclusive quando os cartões estiverem recolhidos. A calculadora exige o
grupo completo para aplicar uma alteração em várias tabelas. **Desfazer grupo**
mantém fatores e taxas atuais, mas encerra a sincronização entre as tabelas.

O nome aceita até 80 caracteres. Não existe um grupo separado apenas para edição:
o nome é gravado no próprio `grupo_fator`, com uma chave diferente para cada prazo.
Por isso, somente prazos iguais são sincronizados: 12x com 12x, 84x com 84x etc.
Para publicar os grupos, basta a migração já existente
`migrations/20261020_base_fatores_vinculos.sql`; nenhuma coluna adicional é usada.

Os botões **Adicionar tabela** estão no começo e no fim das listas, com atalhos
também no fim da página. Os prazos são adicionados dentro de cada tabela.
O vínculo individual antigo foi removido; existe apenas o grupo em lote.

- Editar o fator de um prazo atualiza esse mesmo prazo nos outros membros do grupo.
- Nome, público e prazos exclusivos permanecem independentes. Fator e taxa de
  prazos iguais ficam sincronizados. Outro banco ou modalidade não é alterado.
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
python tests/base-fatores-tabelas.py
python tests/base-fatores-rascunhos.py
python tests/base-fatores-publico.py
python tests/simulador-fluxo.py
python tests/navegacao-paginas.py
```

Os testes usam um Supabase simulado. Não gravam no projeto real.
