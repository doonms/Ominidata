# Base CLT — instalação e uso

1. Abra `supabase/migrations/20261103_base_clt.sql` e copie o conteúdo inteiro.
2. No projeto Supabase usado pelo site, abra **SQL Editor → New query**, cole e clique em **Run**.
3. Atualize o site. Na Base CLT, use **Enviar base ao Supabase** para publicar o cadastro que já está no seu navegador. Não precisa exportar antes.
4. No simulador, escolha **CLT** e informe o tempo no emprego atual em meses.

A instalação cria `public.base_clt`, backups privados e a função `substituir_base_clt`. Não modifica INSS, Outros Convênios, fatores, usuários ou dados já cadastrados no navegador. Requer os perfis de acesso do Ominidata já instalados; não precisa de Edge Function nem chave administrativa no navegador.

## Sincronizar e enviar são ações diferentes

- **Editar/importar JSON:** altera somente o rascunho deste navegador.
- **Enviar base:** publica o cadastro completo em uma transação, inclusive retirando os bancos excluídos. Exige confirmação, faz backup no servidor e recusa sobrescrever uma publicação que mudou desde a leitura. Enviar uma lista vazia exige confirmar a exclusão de todos os bancos CLT.
- **Sincronizar:** carrega a base publicada, substituindo o rascunho somente após confirmação quando há diferenças. Antes da substituição guarda uma cópia em `ominidata_base_clt_antes_importacao_v1`.
- **Ao abrir a Base CLT:** consulta o servidor e atualiza cadastros sem alterações locais; rascunhos diferentes, inclusive exclusões ainda não publicadas, são preservados.
- **Exportar/importar JSON:** continua disponível, incluindo documentos, seguro e todas as faixas de idade.

Após falha de conexão durante o envio, não presuma que o servidor não recebeu: confira a versão publicada antes de reenviar. A conferência de versão protege contra reenvio sobre uma base já modificada. Exporte o rascunho antes de sincronizar se quiser mantê-lo também em arquivo.

## Como a pesquisa CLT filtra

- Tempo de empresa é obrigatório. Um cliente com **5 meses** pode encontrar bancos com mínimo de 0, 3 ou 5 meses, mas não os que exigem 6 ou 12. Com **12 meses**, os mínimos de até 12 são atendidos.
- Tempo mínimo vazio na Base CLT significa **não informado**, não zero: esse banco não é apresentado como compatível pelo tempo. Cadastre `0` se o banco não exigir tempo mínimo.
- Idade deve atender a **pelo menos uma** faixa cadastrada. Não é necessário atender a todas simultaneamente.
- Funcionários e tempo de CNPJ são filtros adicionais. Quando preenchidos, devem atingir o mínimo do banco. Campos ausentes ou requisitos desconhecidos ficam sinalizados como pendências; não são apresentados como aprovação garantida.
- Bancos suspensos não aparecem. Os resultados mostram documentos, seguro e observações do cadastro.
- O simulador lê apenas o Supabase ou o último cache **publicado**, nunca rascunhos. Uma resposta remota vazia remove resultados antigos; uma falha usa o cache com aviso de possível desatualização.
- A Base CLT ainda não contém fatores, prazos ou preços de seguro: o cálculo usa fator manual, sem tabelas/seguros INSS. O seguro textual do banco é informativo, sem desconto automático.

Master/Admin podem publicar. Consulta pode pesquisar, mas não editar/publicar. As permissões são verificadas também no banco, com RLS e autorização da função SQL.
