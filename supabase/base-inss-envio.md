# Envio da Base INSS

O envio aceita a lista exportada pela página e o formato antigo por nome do banco.
Velocidade, observações e demais regras continuam dentro de `base_inss.dados`.
Esta correção não exige novas colunas, SQL ou Edge Functions.

## Identificações

O editor preserva `row.banco_id` ao carregar/exportar. Arquivos antigos sem esse campo
reutilizam a identificação remota quando o nome corresponde. Novos bancos usam o nome
completo normalizado (`inss-banco-pan`), não as três primeiras letras da primeira palavra.
Nomes/identificações duplicados são rejeitados com mensagem que identifica os bancos.
Renomear um banco com `banco_id` explícito mantém sua identificação.

## Segurança do envio

1. Valida o arquivo, verifica a sessão e consulta todos os bancos remotos (leitura paginada).
2. Resolve identificações e pede confirmação, informando a quantidade de bancos ausentes no arquivo.
3. Guarda um backup rotativo em `ominidata_base_inss_antes_envio_v1`, contendo o arquivo,
   o cadastro local e a base remota anterior. Se o backup falhar, não inicia gravações.
4. Grava/confirma os bancos enviados primeiro, sem incluir o ID automático da tabela no conteúdo.
5. Só depois remove, por identificações explícitas, os bancos da consulta anterior que faltam no arquivo.
6. Consulta o servidor novamente e compara o conteúdo antes de anunciar sucesso.

Este fluxo **não é uma transação única no banco**: se a remoção/conferência falhar depois da
gravação, pode haver envio parcial. O aviso informa quantos bancos/exclusões foram confirmados
e orienta conferir o servidor antes de reenviar. Não há tentativa automática nem exclusão ampla
antes do INSERT/UPDATE. Publicações simultâneas não possuem trava/controle de versão; evite
dois operadores enviando ao mesmo tempo. Para atomicidade/concorrência estrita seria necessária
uma RPC transacional específica para INSS, como já existe nas outras bases.

## Diagnóstico

O alerta agora inclui o motivo/código retornado, distinguindo erro de JSON, identificação,
permissão RLS, limite de campo, ausência de UNIQUE em banco_id e confirmação parcial.
Não apague/recrie a tabela nem desative RLS para contornar um erro de envio.
Em caso de dúvida, guarde o JSON e consulte a resposta detalhada antes de repetir o envio.

Testes: `tests/base-inss-envio.py` e `tests/bancos-velocidade.py`, com Supabase simulado.
Os testes não modificam dados reais.
