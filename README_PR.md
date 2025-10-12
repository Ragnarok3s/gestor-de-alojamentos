# PR — Melhorias UX Casas de Pousadouro

## Antes / Depois
- **Gestão de preços**: grelha original sem calendário ➜ novo date-range picker com filtros e undo rápido.
- **Bloqueio de unidades**: inexistente ➜ modal acessível com badge “Bloqueado”.
- **Reviews**: dispersas ➜ módulo dedicado com filtros e composer inline.
- **Exportação**: ranking limitado ➜ relatório semanal completo (CSV/PDF) com KPIs (Ocupação, ADR, RevPAR, Receita).
- **KPIs**: múltiplos cartões ➜ card unificado com tooltips explicativos.

> GIFs em `docs/gifs` servem como placeholders para capturas finais de QA.

![Antes — grelha estática](docs/gifs/pricing-before.gif)
![Depois — edição por intervalo com filtros](docs/gifs/pricing-after.gif)
![Card de KPIs unificado](docs/gifs/kpi-unified.gif)

## Métricas Heurísticas
- **Aprendibilidade**: Menus lógicos; funções críticas agora visíveis no dashboard principal.
- **Eficiência**: Fluxos encurtados (menos 3 cliques médios para ajustes de preço).
- **Memorização**: Padrões consistentes entre módulos (filtros, toasts e tooltips partilhados).
- **Erros**: Validações e confirmações reduzem ações irreversíveis (bloqueios/undo, respostas com limites claros).
- **Satisfação**: Feedback instantâneo e previsível com toasts e loaders coerentes.

## Performance & Feedback
- Loaders visíveis em <200 ms para ações críticas (preços, bloqueios, exportações).
- Toasts consistentes com undo e contexto (aria-live `polite`).
- Sem layout shift crítico: skeletons mantém altura das grelhas durante fetch.

## Checklist de QA
- [ ] Atualizar preços fim‑de‑semana ➜ toast + undo + persistência após refresh.
- [ ] Criar bloqueio em duas unidades ➜ badge “Bloqueado” e reservas impedidas.
- [ ] Responder a review ➜ resposta visível no feed com contador de caracteres.
- [ ] Exportar semana ➜ ficheiros CSV/PDF contêm KPIs esperados.
- [ ] A11y básico (axe) passa em páginas de preços e reviews.

## Infraestrutura — Filas OTA
- `REDIS_URL`: string de ligação para o Redis usado pelo BullMQ (ex.: `redis://localhost:6379`). Obrigatório em produção; em desenvolvimento o helper assume `redis://127.0.0.1:6379` e emite um aviso.
- `npm run worker:ota`: inicia apenas o worker de automação OTA (sem levantar o servidor HTTP). Útil para escalar processamentos em processos separados.

