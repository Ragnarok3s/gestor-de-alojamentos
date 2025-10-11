# RFC — Melhorias UX "Casas de Pousadouro"

## Sumário dos Problemas e Evidências
1. **Gestão de preços limitada** — Img 7 / Propriedades: campo “Preço base” isolado, sem calendário nem edição rápida para intervalos, obrigando a ajustes diários manuais.
2. **Sem filtros contextuais nos preços** — Img 7 / Propriedades: grelha não permite filtrar por tipologia, unidade ou fins-de-semana, aumentando o tempo de decisão.
3. **Bloqueios manuais opacos** — Img 7 / Propriedades: ausência de fluxo para bloquear unidades com motivo e feedback visual imediato.
4. **Reviews dispersas** — Img 10 / Revenue & Img 14 / Estatísticas: avaliações não estão acessíveis no mesmo espaço de KPIs nem oferecem resposta inline.
5. **Falta de exportação semanal completa** — Img 14 / Estatísticas: apenas ranking disponível, impedindo relatório com Ocupação, ADR, RevPAR e receita.
6. **KPIs fragmentados** — Img 10 / Revenue: ADR visível apenas no módulo de receita, enquanto ocupação aparece noutro painel.
7. **Feedback frágil nas ações críticas** — fluxos atuais não confirmam alterações de preços, bloqueios ou respostas, deixando o diretor sem confiança.
8. **Tooltips e legendas ausentes** — indicadores não explicam cálculos, dificultando leitura rápida pelo diretor.
9. **Menu redundante** — entrada “Revenue” duplicada cria ruído cognitivo.
10. **Estados vazios pouco orientativos** — páginas como reviews não informam próximos passos quando não há dados.

## Propostas de Solução
- **Gestão de preços por período**: introduzir date-range picker com grelha diária e filtros (unidade, tipologia, fim‑de‑semana). Backend recebe `PUT /admin/api/rates/bulk` com transação e validação, permitindo edição rápida de múltiplas datas. Melhora eficiência ao reduzir ajustes manuais repetitivos.
- **Contexto filtrável**: filtros persistentes alimentam telemetria para aferir padrões de uso e ajudam o diretor a comparar rapidamente tipologias, acelerando decisões de yield.
- **Bloqueio manual com motivo**: ação “Bloquear unidade” abre modal com intervalo e motivo; backend guarda em `unit_blocks`. Badge “Bloqueado” aplica-se na grelha/calendário, prevenindo reservas conflitantes e reduzindo overbookings.
- **Módulo de reviews unificado**: lista com filtros (negativas, recentes), composer com contagem de caracteres e resposta persistida em `reviews`. Diretores respondem sem sair do dashboard, reforçando reputação.
- **Exportação semanal (CSV/PDF)**: endpoint `GET /admin/api/reports/weekly` agrega Ocupação, ADR, RevPAR e receita, devolvendo CSV ou PDF leve (pdfkit). Possibilita partilha com equipa financeira.
- **Dashboard de KPIs**: card único junta Ocupação + ADR com legenda, tooltips e link para detalhe. Garante visão holística imediata.
- **Feedback consistente**: toasts padrões (“Preços atualizados…”, “Bloqueio criado…”) com opção de undo a 5s (API `/admin/api/rates/bulk/undo`). Estados `aria-busy` e skeletons garantem feedback em <200 ms percebidos.
- **Tooltips/legendas**: textos curtos explicam fórmulas de ADR, Ocupação e RevPAR, reduzindo erros de interpretação.
- **Menu limpo**: remover duplicação “Revenue”, mantendo navegação lógica — aumenta aprendibilidade.
- **Estados vazios orientativos**: mensagens como “Sem novas avaliações esta semana” sugerem ações futuras, evitando frustração.

## Impacto Esperado
- Redução de ~60% no tempo para ajustar preços sazonais (fluxo passa de 10+ cliques para 3).
- Menos risco de overbooking com validação automática de bloqueios.
- Maior taxa de resposta a reviews (>90%) ao centralizar fluxo.
- Relatórios semanais consistentes reforçam alinhamento entre diretor e stakeholders.

## Riscos
- **Concorrência**: operações de preços em massa exigem bloqueio transacional para evitar dados divergentes.
- **Carga no PDF**: geração síncrona precisa ser optimizada; salvaguarda com intervalos máximos (≤31 dias).
- **Adopção UI**: nova grelha deve respeitar padrões existentes para não confundir equipas habituadas.

## Feature Flags
- `ux.bulkRates`, `ux.unitBlocks`, `ux.reviews`, `ux.weeklyExport`, `ux.kpiDashboard`. Flags controlam rollout independente e permitem fallback se necessário.

## Migração de Dados
- Migração leve cria tabelas `unit_blocks` e `reviews`; dados existentes permanecem intactos. Não há migração destrutiva. Exportação usa bookings históricos existentes.

## Telemetria Planeada
- `rates_bulk_updated` `{ unitIds, nights, totalNights, priceCents }`
- `unit_block_created` `{ blockId, unitId, nights, reasonLength }`
- `weekly_report_exported` `{ from, to, format }`
- `review_replied` `{ reviewId, responseLength }`

## Insights Estratégicos
- **Dashboard unificado de KPIs** consolida visão operacional, reduzindo decisões baseadas em dados fragmentados.
- **Reputação integrada** (reviews + resposta rápida) melhora ranking em OTAs e impacto no ADR.
- **Preços sazonais ágeis** sustentam estratégia de revenue management num destino com forte sazonalidade (Douro).
- **Exportação semanal completa** fortalece reporting transversal entre direção, revenue e equipas externas.

