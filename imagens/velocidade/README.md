# Símbolos de velocidade dos bancos

Coloque nesta pasta quatro imagens PNG com os nomes exatos:

| Arquivo | Classificação | Cor do card |
| --- | --- | --- |
| `esteira-manual.png` | Esteira manual (processo mais lento) | Roxo discreto |
| `paga-rapido.png` | Paga rápido | Verde discreto |
| `paga-medio.png` | Paga em tempo médio | Amarelo discreto |
| `paga-lento.png` | Paga lento | Laranja discreto |

Recomendado: imagens quadradas, com fundo transparente e pelo menos 64 × 64 px.
O símbolo e o texto da classificação aparecem junto das observações no resultado do simulador
(rápido e avançado), abaixo da idade/prazo.
Passe o mouse sobre ele para consultar a descrição; leitores de tela também têm a descrição.
Se a imagem não existir ou falhar, o sistema mostra um símbolo de texto provisório.

A classificação é escolhida em **Base INSS → Nome do banco → Velocidade do banco**.
**Não informado** não exibe símbolo nem altera a cor padrão.
O dado é salvo no campo `velocidadePagamento` do JSON `dados` da tabela `base_inss`:
`manual`, `rapido`, `medio`, `lento` ou vazio. Não exige coluna ou SQL novo.
Editar salva neste navegador; publique pela opção de envio já existente na Base INSS
para disponibilizar a classificação aos outros usuários.
