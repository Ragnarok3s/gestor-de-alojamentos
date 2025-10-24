# Calendar Module Analysis and Refactor Plan

## Visão geral

O módulo `src/modules/backoffice/calendar.js` centraliza todas as rotas e helpers do calendário do backoffice. O ficheiro faz a configuração de dependências do contexto (base de dados, formatação, permissões) e regista o endpoint `GET /calendar`, que produz a página HTML completa com filtros, resumos e grelha de reservas. Também contém handlers para reagendamento, cancelamento e bloqueio de reservas, além de helpers para normalizar dados e construir cartões de unidades utilizados tanto na vista desktop como mobile.

## Responsabilidades atualmente misturadas

| Camada | Exemplos dentro do módulo |
| --- | --- |
| **Acesso a dados** | Queries SQL diretamente embutidas nas rotas (`rescheduleBookingUpdateStmt`, `insertBlockStmt`, etc.) e nos helpers de UI para carregar reservas, unidades e bloqueios. |
| **Lógica de negócio** | Validação de datas, prevenção de conflitos e regras de permanência mínima executadas dentro dos handlers HTTP, bem como integrações com `overbookingGuard`, `otaDispatcher` e `rateQuote`. |
| **Autorização e routing** | Aplicação de `requireLogin`, `requirePermission` e verificações condicionais com `userCan` diretamente na camada que prepara a resposta HTML. |
| **Renderização server-side** | Construção de grandes blocos HTML com `html\`...\`` e `layout()` dentro da mesma função que trata das queries e permissões. |
| **JavaScript client-side** | Injeção de scripts inline via `inlineScript` para drag & drop, fetch de APIs e manipulação do DOM, misturando lógica cliente com o render server. |

Esta mistura torna o ficheiro difícil de testar isoladamente e de manter, porque cada alteração numa camada exige navegar num módulo monolítico que conhece pormenores de todas as outras.

## Arquitetura modular proposta

1. **Camada de dados (`src/db/calendar/`)**
   * Repositórios responsáveis por encapsular `SELECT`/`UPDATE` usados pelas rotas de calendário (ex.: `booking-repository.js`, `block-repository.js`).
   * APIs expressivas como `findBookingsByRange(filters)` e `updateBookingDates(payload)` para reutilização e teste unitário.
2. **Camada de serviços (`src/services/calendar/`)**
   * Orquestração das regras de negócio: validar intervalos, evitar conflitos, aplicar `rateQuote` e interagir com `overbookingGuard`, `otaDispatcher` e `logChange`.
   * Interface de alto nível como `rescheduleBooking({ bookingId, checkin, checkout, actor })` e `createBlock({ unitId, from, to, reason })`.
3. **Controladores (`src/controllers/backoffice/`)**
   * Rotas Express finas que convertem `req` em chamadas a serviços, tratam erros e devolvem JSON ou redirecionamentos.
   * Mantêm apenas a lógica de autorização (`requireLogin`, `requirePermission`) e o formatação de resposta.
4. **View-models / presenters (`src/views/calendar/`)**
   * Transformação de dados de domínio em estruturas prontas para os templates (filtros, contagens, cartões de unidade, slots de calendário).
5. **Templates (`src/templates/backoffice/calendar/`)**
   * HTML organizado em partials (`calendar-page.njk`, `calendar-board.partial.njk`, `calendar-summary.partial.njk`) para separar markup da lógica.
6. **Assets front-end (`public/js/calendar/`)**
   * Scripts modulares (`drag-and-drop.js`, `api-client.js`) e CSS que são servidos como ficheiros estáticos, eliminando dependência de `inlineScript`.

## Plano de refatoração incremental

1. **Criar repositório de dados**: Extrair as queries usadas em `GET /calendar` e `POST /calendar/booking/:id/reschedule` para `calendar-repository`. Cobrir com testes que usam fixtures SQL.
2. **Mover lógica de negócio**: Implementar `calendar-service` com validação de datas, detecção de conflitos e chamadas a `overbookingGuard`/`rateQuote`. Os handlers passam a delegar para este serviço.
3. **Introduzir controlador dedicado**: Criar `calendar-controller.js` em `src/controllers/backoffice` que expõe `registerCalendarController(app, context)` e utiliza o serviço/repositório. Atualizar `registerCalendar` para apenas delegar.
4. **Criar view-model**: Extrair helpers como `normalizeCalendarBookings` para `buildCalendarViewModel`, facilitando testes da composição da página sem HTML.
5. **Migrar templates**: Mover o markup gerado por `layout()` para templates Nunjucks (ou motor equivalente) com partials reutilizáveis. O controlador passa a renderizar usando estes templates.
6. **Extrair scripts cliente**: Reescrever o bloco de drag & drop inline como `public/js/calendar/drag-and-drop.js` importado via `<script src="...">`. Permite linting e testes de front-end.
7. **Refatorar endpoints auxiliares**: Repetir o padrão repo+serviço+controlador para cancelamentos e bloqueios, garantindo reutilização das validações.
8. **Limpeza final**: Remover helpers obsoletos do módulo original, adicionar testes de integração das rotas e atualizar documentação interna.

## Exemplo de refatoração

```js
// controllers/backoffice/calendar-controller.js
router.post('/calendar/booking/:id/reschedule',
  requireLogin,
  requirePermission('calendar.reschedule'),
  async (req, res, next) => {
    try {
      const result = await calendarService.rescheduleBooking({
        bookingId: Number(req.params.id),
        checkin: req.body.checkin,
        checkout: req.body.checkout,
        actorId: req.user.id,
      });
      res.json({ ok: true, message: 'Reserva reagendada.', unit_id: result.unitId });
    } catch (error) {
      if (error instanceof CalendarConflictError) {
        return res.status(409).json({ ok: false, message: error.message });
      }
      if (error instanceof ValidationError) {
        return res.status(400).json({ ok: false, message: error.message });
      }
      next(error);
    }
  }
);
```

```js
// services/calendar/calendar-service.js
async function rescheduleBooking({ bookingId, checkin, checkout, actorId }) {
  validateRange({ checkin, checkout });
  const booking = await calendarRepository.findBookingWithUnit(bookingId);
  ensureBookingExists(booking);
  await ensureNoConflicts({ booking, checkin, checkout });
  const quote = await rateQuote(booking.unit_id, checkin, checkout, booking.base_price_cents);
  await overbookingGuard.reserveSlot({ unitId: booking.unit_id, from: checkin, to: checkout, bookingId, actorId });
  await calendarRepository.updateBookingDates({ bookingId, checkin, checkout, total: quote.total_cents });
  await otaDispatcher?.pushUpdate(booking, { checkin, checkout, quote });
  await logChange(actorId, 'booking', bookingId, 'reschedule', { checkin, checkout });
  return { unitId: booking.unit_id };
}
```

O controlador fica fino e focado na resposta HTTP, enquanto o serviço agrega regras de negócio e integrações, permitindo testes direcionados.

## Estrutura de pastas sugerida

```
src/
  controllers/
    backoffice/
      calendar-controller.js
      calendar-block-controller.js
  db/
    calendar/
      booking-repository.js
      block-repository.js
      unit-repository.js
  services/
    calendar/
      calendar-service.js
      calendar-block-service.js
  views/
    calendar/
      build-calendar-view-model.js
      presenters/
        calendar-entry-presenter.js
  templates/
    backoffice/
      calendar/
        calendar-page.njk
        calendar-summary.partial.njk
        calendar-board.partial.njk
        calendar-mobile.partial.njk
public/
  js/calendar/
    drag-and-drop.js
    api-client.js
    filters.js
```

Esta organização separa responsabilidades, facilita a criação de testes unitários para cada camada e reduz o acoplamento entre regras de negócio, acesso a dados e apresentação.
