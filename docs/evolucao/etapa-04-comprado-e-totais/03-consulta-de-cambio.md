# E4.3 — Escolha e consulta de câmbio

**Estado.** Proposta em revisão. A escolha do provedor antecede a implementação do cliente de câmbio.

O Listed precisa de uma taxa de referência para estimar o total em BRL, USD ou EUR. Os preços dos produtos continuam em centavos na moeda original. A cotação guarda a direção do par e a data da referência, porque essas informações determinam como interpretar o número.

Se 1 USD equivale a 5 BRL, a origem é USD, o destino é BRL e a taxa é 5. Nesse exemplo hipotético, 1.000 centavos de USD correspondem a 5.000 centavos de BRL. Uma consulta de USD para USD já tem fator 1 e pode ser resolvida localmente.

## Comparação de provedores

| Provedor | Dados e atualização | Acesso e condições | Efeito no backend |
| --- | --- | --- | --- |
| Frankfurter v2 | Taxas de referência agregadas. Cada par traz sua própria data. | Acesso público gratuito, sem chave. As taxas agregadas permitem uso comercial e cache. Há limitação contra abuso, sem cota diária ou mensal publicada. [Documentação do Frankfurter](https://frankfurter.dev/#faq) | Uma consulta para cada moeda de origem pode trazer as duas moedas de destino. |
| PTAX do Banco Central | Boletins com dados de compra, venda e paridade. O conjunto inclui USD e EUR com referências em BRL. | Dados públicos. O catálogo identifica a licença ODbL e indica atualizações algumas vezes ao dia. A documentação consultada não publicou uma cota numérica. [Catálogo do BCB](https://dadosabertos.bcb.gov.br/dataset/taxas-de-cambio-todos-os-boletins-diarios) | Precisaríamos definir qual boletim e coluna usar e como calcular as direções inversas. |
| ExchangeRate-API Open | Tabela por moeda de origem com atualização diária e horário previsto da próxima publicação. | Gratuito, sem chave e com limite de requisições. Permite cache e uso comercial na conversão, exige atribuição e restringe redistribuição da tabela. [Documentação do plano Open](https://www.exchangerate-api.com/docs/free) | A resposta inclui a tabela toda. O backend aproveitaria somente BRL, USD e EUR. |

**Recomendação.** Frankfurter v2 com as taxas agregadas. A consulta filtrada cobre os seis pares e traz a data de cada taxa. Para estimativas de wishlist, isso permite mostrar a origem e a data sem escolher entre cotações de compra e venda.

## Consulta real

Fiz três requisições ao Frankfurter, uma com cada moeda de origem, e uma ao ExchangeRate-API com USD como origem. O catálogo da PTAX foi analisado pela documentação.

| Consulta | Resultado |
| --- | --- |
| Frankfurter com BRL na origem | HTTP 200, com EUR e USD. |
| Frankfurter com USD na origem | HTTP 200, com BRL e EUR. |
| Frankfurter com EUR na origem | HTTP 200, com BRL e USD. |
| ExchangeRate-API com USD na origem | HTTP 200, com BRL e EUR e a próxima atualização indicada pelo serviço. |

Na mesma resposta com BRL na origem, EUR veio com data de referência `2026-11-19` e USD com `2026-11-18`. São datas reportadas pelo provedor. Essa diferença é a razão para guardar a data por par.

Para repetir uma das consultas:

```powershell
curl.exe --fail --max-time 8 "https://api.frankfurter.dev/v2/rates?base=USD&quotes=BRL,EUR"
```

## Política proposta para o backend

1. Consultar apenas as origens que precisam de conversão, num endereço fixo do provedor. Cada requisição envia apenas os códigos das moedas. O prazo proposto para resposta é de 3 segundos.
2. Validar o JSON com Zod. Cada linha deve trazer o par solicitado, uma data válida e uma taxa finita e positiva. Guardar o provedor, a data da cotação por par e o instante em que a consulta terminou.
3. Manter em memória as respostas por moeda de origem por 6 horas. Pedidos simultâneos para a mesma origem compartilham uma consulta. Depois de uma falha, esperar 5 minutos antes de tentar novamente e respeitar um `Retry-After` maior quando informado.
4. Durante uma falha, reutilizar a última taxa válida se a data de referência tiver até 7 dias e sinalizar que veio do cache em contingência. Se não houver taxa utilizável, indicar indisponibilidade. Na etapa de conversão, isso permitirá somar os valores na própria moeda e contar os itens que ficaram fora por falta de taxa.

O relógio do cache e a data da cotação respondem a perguntas diferentes. O primeiro indica quando podemos consultar de novo. A segunda indica de quando é o valor, inclusive nos fins de semana. O cache vale por processo e começa vazio quando o servidor reinicia.

## Implementação após a escolha

- Consultar e validar as cotações em um módulo do backend. Manter a origem e a data disponíveis para o cálculo.
- Exercitar a validação, os limites de tempo, o cache, as falhas e os pares iguais com respostas de teste separadas da consulta real. A suíte local deve rodar sem depender do provedor.
- E4.4 fica responsável pela conversão e pelo arredondamento dos centavos antes de apresentar os totais estimados.
