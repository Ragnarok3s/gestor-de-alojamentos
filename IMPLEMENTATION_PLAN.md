# Plano de Implementação — Melhorias UX

## 1. Backend
1.1 **Modelos & DB**
- Criar tabelas `unit_blocks` e `reviews` com índices (migração leve em `src/infra/database.js`).
- Garantir colunas `responded_at`, `response_text`, `response_author_id` na tabela de reviews.
- Adicionar helpers de validação/erros reutilizáveis (`src/services/errors.js`).

1.2 **Endpoints & Serviços**
- Criar serviço `createRateManagementService` (`src/services/rate-management.js`) com validações, transações e undo.
- Expôr `PUT /admin/api/rates/bulk` e `POST /admin/api/rates/bulk/undo` no novo router `src/modules/backoffice/ux-api.js`.
- Criar `createUnitBlockService` (`src/services/unit-blocks.js`) com deteção de conflitos vs bookings/blocks.
- Endpoint `POST /admin/api/units/:unitId/blocks` devolve badge info e telemetry `unit_block_created`.
- Serviço `createReviewService` (`src/services/review-center.js`) com listagem, filtros e resposta (`POST /admin/api/reviews/:id/respond`).
- Serviço `createReportingService` (`src/services/reporting.js`) para KPIs unificados (`GET /admin/api/kpis/summary`) e exportação semanal (`GET /admin/api/reports/weekly`).
- Gerar CSV e PDF (pdfkit) e emitir `weekly_report_exported`.
- Todas as rotas: validação, códigos de erro sem ambiguidades e logs via `logActivity`.

## 2. Frontend
2.1 **Views & Estados**
- Atualizar painel de preços com date-range picker, filtros por unidade/tipologia/fim-de-semana e grelha diária.
- Adicionar modal “Bloquear unidade” com validação inline, highlight `aria-live` para erros.
- Dashboard de KPIs combina Ocupação + ADR + RevPAR com tooltips (`aria-describedby`).
- Módulo de reviews com filtros (tabs + badges), composer auto-expand com contador e estados vazios.
- Botão “Exportar semana” no painel Estatísticas com escolha CSV/PDF.

2.2 **Feedback Visual & A11y**
- Toasts centralizados (`aria-live="polite"`) com undo (focus trap no toast).
- Skeletons/spinners com `aria-busy` durante fetch.
- Badges “Bloqueado” com contraste AAA.
- Tooltips e legendas descrevendo cálculos de KPIs.

2.3 **Navegação**
- Remover duplicação “Revenue” do menu e garantir foco regressa ao cabeçalho após ações (e.g., toast undo).

## 3. Telemetria / Analytics
- Emitir eventos descritos no RFC via `logActivity` + camada `telemetry` (payload mínimo no router).
- Guardar contexto de filtros usados (unidade, tipologia, formato exportação) para análise posterior.

## 4. Testes
- **Unitários**: validar `normalizeBulkPayload`, conflitos de bloqueios, resposta a reviews e agregação de KPIs.
- **E2E (Playwright)**:
  - Fluxo de atualização de preços fim‑de‑semana (ver toast + persistência).
  - Bloquear duas unidades e garantir badge + impossibilidade de reserva.
  - Responder a review e confirmar estado “respondida”.
  - Exportar relatório semanal e validar conteúdo CSV.
  - Verificação básica de acessibilidade (axe) nas páginas novas.

## Critérios de Aceitação (por tarefa)
1. **PUT /rates/bulk**
   - Given intervalo válido e unidades selecionadas, When confirmo atualização, Then vejo toast “Preços atualizados…” e valores persistem após refresh.
   - Given payload inválido, When envio, Then recebo `400` com mensagem clara.

2. **POST /units/:id/blocks**
   - Given intervalo sem conflitos, When guardo bloqueio, Then badge “Bloqueado” aparece e reservas futuras ficam impedidas.
   - Given conflito com reserva, When tento bloquear, Then recebo `409` com erro “Já existem reservas neste intervalo. Ajusta as datas.”

3. **Reviews**
   - Given review sem resposta, When escrevo e confirmo, Then aparece imediatamente com etiqueta “Respondida”.
   - Given resposta >1000 caracteres, Then recebo validação inline.

4. **Exportação Semanal**
   - Given datas válidas, When exporto CSV/PDF, Then download inclui Ocupação, ADR, RevPAR e receita.
   - Given intervalo >31 dias, Then recebo `400`.

5. **Dashboard KPIs**
   - Given dados agregados, When acedo ao painel, Then Ocupação e ADR surgem no mesmo card com tooltip e legenda.
   - Given ausência de dados, Then vejo estado vazio com orientação.

