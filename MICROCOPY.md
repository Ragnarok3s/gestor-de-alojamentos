# Microcópia Consolidada (pt-PT)

| Contexto | Texto | Notas |
| --- | --- | --- |
| Toast sucesso preços | "Preços atualizados para {n} noites em {m} unidades." | Variáveis `{n}` noites, `{m}` unidades selecionadas. |
| Toast erro preços | "Não foi possível atualizar os preços. Tenta novamente." | Usar quando API devolve erro genérico. |
| Undo preços | "Anular" | Botão dentro do toast, devolve foco após ação. |
| Validação preços | "Seleciona pelo menos uma unidade e um intervalo válido." | Inline abaixo do date-range picker. |
| Toast sucesso bloqueio | "Bloqueio criado para {alvo} durante {n} noite(s)." | `{alvo}` pode ser nome da unidade ou "{m} unidades". Mostrar badge imediatamente. |
| Erro conflito bloqueio | "Já existem reservas neste intervalo. Ajusta as datas." | Estado `aria-live="assertive"`. |
| Erro bloqueio duplicado | "Intervalo já se encontra bloqueado." | Mesma mensagem para blocos legados. |
| Modal bloqueio label | "Motivo do bloqueio" | `aria-label` e `placeholder` "Manutenção, uso interno, etc." |
| Modal bloqueio hint | "Bloqueio aplicado a {count} unidade(s)." | `count` = 1 mostra singular; plural caso contrário. |
| Toolbar bloqueio vazio | "Seleciona unidades para bloquear." | `data-block-summary`, `aria-live="polite"`. |
| Toolbar bloqueio singular | "1 unidade selecionada." | Atualizado ao marcar a primeira unidade. |
| Toolbar bloqueio plural | "{n} unidades selecionadas." | `{n}` >= 2. |
| Toast info bloqueio | "Seleciona pelo menos uma unidade válida." | Surge ao tentar abrir modal sem seleção. |
| Badge bloqueado | "Bloqueado" | Contraste AAA (#7C2D12 em fundo #FED7AA). |
| Reviews estado vazio | "Sem novas avaliações esta semana." | Complementar com link "Ver histórico". |
| CTA responder review | "Responder" | Botão principal em cada review. |
| Placeholder resposta | "Obrigado pela partilha — responde de forma cordial." | Textarea auto-expand, máximo 1000 caracteres. |
| Toast sucesso review | "Resposta registada." | Colocar nome no cartão, toast genérico. |
| Toast erro review | "Não foi possível enviar a resposta. Tenta novamente." | |
| Exportação semanal CTA | "Exportar semana" | Menu com opções CSV / PDF. |
| Toast exportação sucesso | "Relatório semanal exportado ({format})." | `{format}` = CSV/PDF. |
| Toast exportação erro | "Exportação indisponível para o intervalo selecionado." | |
| KPI tooltip ocupação | "% de noites ocupadas / noites disponíveis no período." | Tooltip `aria-describedby`. |
| KPI tooltip ADR | "Receita média por noite vendida (ADR)." | |
| KPI tooltip RevPAR | "Receita por quarto disponível (RevPAR)." | |
| Estado vazio KPIs | "Ainda não temos dados suficientes para este período." | Mostrar contexto adicional com filtros. |
| Toast undo sucesso | "Alteração anulada." | Enviado após `/rates/bulk/undo`. |
| KPI info toast | "Monitoriza variações: queda de ocupação com ADR alto indica oportunidade de promoções rápidas." | Botão info no card combinado. |
| Alerta ocupação baixa | "Ocupação abaixo do recomendado" / "Ativa campanhas ou ajusta o ADR para estimular reservas rápidas." | Mostrar quando taxa <30%. |
| Alerta ocupação alta | "Ocupação em níveis máximos" / "Revê disponibilidade futura e considera aumentar o ADR para maximizar receita." | Mostrar quando taxa >90%. |
| Erro noites fim-de-semana | "Intervalo sem noites para aplicar." | Validar quando filtro fim-de-semana remove todas as datas. |
| Toast DnD bloqueado | "As novas datas estão bloqueadas." | Quando o drop coincide com bloqueios existentes. |
| Toast DnD passado | "Data no passado." | Ao tentar reagendar para datas anteriores a hoje. |
