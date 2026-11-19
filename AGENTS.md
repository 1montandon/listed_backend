# Instruções para o Codex no Listed Backend

- Comece pela seção **Onde retomar** do [PLAN.md](PLAN.md). Confira `git status --short --branch` e `git log -5 --oneline` para conferir o estado real do checkout. Leia a revisão indicada para o checkpoint atual.
- Trabalhe neste repositório de backend. O frontend tem repositório e revisão próprios. O [README](README.md) orienta a preparação do ambiente e os comandos de verificação.
- Siga o ciclo do plano. Implemente a etapa autorizada, execute as verificações, escreva a revisão, atualize o plano e apresente a entrega. Aguarde aprovação explícita antes do commit e do avanço. Faça commits seletivos e peça autorização específica para push ou deploy.
- Mantenha o código legível para quem está aprendendo. Use nomes descritivos, etapas explícitas e comentários que expliquem decisões, sintaxes menos comuns e o papel das bibliotecas. Preserve o padrão router → controller → service → repository, validando a entrada no controller e inferindo os tipos a partir dos schemas Zod.
- Preços e totais do backend usam centavos inteiros. A API usa `priceCents` e `amountCents` como números JSON. `null` representa preço ausente e `0` representa preço zero. Preserve os filtros de propriedade nas operações privadas.
- Para mudanças de código, execute `npm run typecheck`, `npm run build` e `npm test` com o PostgreSQL local e o Chromium preparados. Registre o resultado real, a ordem sugerida de leitura e como verificar a etapa na revisão correspondente.
