'use strict';

function createPricingHandler({ availabilityHandler }) {
  if (!availabilityHandler) {
    throw new Error('createPricingHandler requer availabilityHandler.');
  }

  function handle(payload) {
    const base = availabilityHandler.handle(payload);
    if (!payload.checkin || !payload.checkout) {
      return {
        html: '<p class="chatbot-hint">Indique as datas de entrada e saída para estimar os preços com as campanhas em vigor.</p>',
        confidence: 0.4,
      };
    }

    return {
      html: `<p class="chatbot-hint">Aqui está o preço estimado para as unidades disponíveis.</p>${base.html}`,
      confidence: base.confidence,
      meta: base.meta,
    };
  }

  return { handle };
}

module.exports = { createPricingHandler };
