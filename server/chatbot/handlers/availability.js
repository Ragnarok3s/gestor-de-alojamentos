'use strict';

function createAvailabilityHandler({ db, dayjs, html, esc, unitAvailable, rateQuote }) {
  if (!db || !dayjs || !unitAvailable || !rateQuote) {
    throw new Error('createAvailabilityHandler requer db, dayjs, unitAvailable e rateQuote.');
  }

  const selectUnits = db.prepare(
    `SELECT u.id, u.name, u.capacity, u.base_price_cents, p.name AS property_name, p.id AS property_id
       FROM units u
       JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.name`
  );

  function renderCards({ checkin, checkout, guests, propertyId }) {
    const rows = selectUnits.all();
    const checkinDate = dayjs(checkin);
    const checkoutDate = dayjs(checkout);

    const available = rows.filter(unit => {
      if (propertyId && String(unit.property_id) !== String(propertyId)) return false;
      if (!checkinDate.isValid() || !checkoutDate.isValid()) return false;
      if (!checkoutDate.isAfter(checkinDate)) return false;
      if (guests && Number(unit.capacity || 0) < guests) return false;
      return unitAvailable(unit.id, checkin, checkout);
    });

    if (!available.length) {
      return {
        html: '<p class="chatbot-hint">Não encontrei unidades livres para essas datas. Quer tentar um intervalo alternativo?</p>',
        count: 0,
      };
    }

    const cards = available.slice(0, 4).map(unit => {
      const quote = rateQuote(unit.id, checkin, checkout, unit.base_price_cents);
      const total = (quote.total_cents || 0) / 100;
      const nights = quote.nights || 0;
      const propertyName = esc(unit.property_name || '');
      const unitName = esc(unit.name || '');
      return html`
        <article class="chatbot-card">
          <div class="chatbot-card__header">
            <h4>${unitName}</h4>
            <span>${propertyName}</span>
          </div>
          <div class="chatbot-card__meta">
            <span>${nights} noite(s)</span>
            <span>${guests || '—'} hóspede(s)</span>
          </div>
          <div class="chatbot-card__price">€ ${total.toFixed(2)}</div>
          <div class="chatbot-card__actions">
            <a class="chatbot-card__cta" href="/?unit=${unit.id}&checkin=${encodeURIComponent(checkin)}&checkout=${encodeURIComponent(checkout)}&adults=${encodeURIComponent(guests || 1)}">
              Reservar agora
            </a>
          </div>
        </article>`;
    }).join('');

    return {
      html: `<div class="chatbot-cards">${cards}</div>`,
      count: available.length,
    };
  }

  function handle({ checkin, checkout, guests, propertyId }) {
    if (!checkin || !checkout) {
      return {
        html: '<p class="chatbot-hint">Para verificar disponibilidade preciso que indique as datas de entrada e saída.</p>',
        confidence: 0.4,
      };
    }

    const { html: cardsHtml, count } = renderCards({ checkin, checkout, guests, propertyId });
    return {
      html: count
        ? `<p>Encontrei estas opções para ${dayjs(checkin).format('DD/MM')} – ${dayjs(checkout).format('DD/MM')}.</p>${cardsHtml}`
        : cardsHtml,
      confidence: count ? 0.85 : 0.5,
      meta: { matches: count },
    };
  }

  return { handle };
}

module.exports = { createAvailabilityHandler };
