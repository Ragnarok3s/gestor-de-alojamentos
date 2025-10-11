# Microcópia Consolidada (pt-PT)

| Contexto | Texto | Notas |
| --- | --- | --- |
| Toast sucesso preços | "Preços atualizados para {n} noites em {m} unidades." | Variáveis `{n}` noites, `{m}` unidades selecionadas. |
| Toast erro preços | "Não foi possível atualizar os preços. Tenta novamente." | Usar quando API devolve erro genérico. |
| Undo preços | "Anular" | Botão dentro do toast, devolve foco após ação. |
| Validação preços | "Seleciona pelo menos uma unidade e um intervalo válido." | Inline abaixo do date-range picker. |
| Toast sucesso bloqueio | "Bloqueio criado para {n} noites." | Mostrar badge imediatamente. |
| Erro conflito bloqueio | "Já existem reservas neste intervalo. Ajusta as datas." | Estado `aria-live="assertive"`. |
| Modal bloqueio label | "Motivo do bloqueio" | `aria-label` e `placeholder` "Manutenção, uso interno, etc." |
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
| Erro noites fim-de-semana | "Intervalo sem noites para aplicar." | Validar quando filtro fim-de-semana remove todas as datas. |
