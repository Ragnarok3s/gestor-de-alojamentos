const express = require('express');
const { parseMessage } = require('./parser');

function createChatbotRouter(context) {
  const {
    chatbotService,
    dayjs,
    db,
    esc,
    html,
    rateQuote,
    unitAvailable,
  } = context;

  if (!chatbotService) {
    throw new Error('Chatbot service não inicializado.');
  }

  const router = express.Router();

  function ensureSession(req, res) {
    chatbotService.expireOldSessions();
    const cookieId = req.cookies && req.cookies.cb_sid ? String(req.cookies.cb_sid) : '';
    let session = cookieId ? chatbotService.getSession(cookieId) : null;
    if (!session) {
      session = chatbotService.createSession({ intent: null, messages: [] }, null);
      res.cookie('cb_sid', session.id, { httpOnly: false, sameSite: 'Lax', maxAge: 1000 * 60 * 60 * 48 });
    }
    return session;
  }

  function renderMessage(role, text, extra = '') {
    const bubbleClass = role === 'user' ? 'chatbot-bubble is-user' : 'chatbot-bubble is-bot';
    return html`
      <div class="chatbot-message ${bubbleClass}">
        <div class="chatbot-message__body">${text}</div>
        ${extra}
      </div>`;
  }

  function renderAvailabilityCards(options = {}) {
    const { checkin, checkout, guests } = options;
    if (!checkin || !checkout) {
      return '<p class="chatbot-hint">Preciso de datas válidas para verificar a disponibilidade.</p>';
    }

    const units = db
      .prepare(
        `SELECT u.id, u.name, u.capacity, u.base_price_cents, p.name AS property_name, p.id AS property_id
           FROM units u
           JOIN properties p ON p.id = u.property_id
          ORDER BY p.name, u.name`
      )
      .all();

    const available = units.filter(unit => {
      if (guests && unit.capacity < guests) return false;
      return unitAvailable(unit.id, checkin, checkout);
    });

    if (!available.length) {
      return '<p class="chatbot-hint">Não encontrei unidades disponíveis para esse intervalo. Podemos ajustar as datas?</p>';
    }

    const cards = available
      .slice(0, 4)
      .map(unit => {
        const quote = rateQuote(unit.id, checkin, checkout, unit.base_price_cents);
        const nights = quote.nights;
        const total = quote.total_cents / 100;
        const unitTitle = esc(unit.name);
        const propertyName = esc(unit.property_name);
        return html`
          <article class="chatbot-card">
            <div class="chatbot-card__header">
              <h4>${unitTitle}</h4>
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
      })
      .join('');

    return `<div class="chatbot-cards">${cards}</div>`;
  }

  router.post('/message', (req, res) => {
    const session = ensureSession(req, res);
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.send(renderMessage('bot', 'Pode reformular a pergunta? Preciso de mais detalhes.'));
    }

    chatbotService.recordMessage(session.id, 'user', text);
    const parsed = parseMessage(dayjs, text);
    const state = { ...session.state };

    if (parsed.guests) state.guests = parsed.guests;
    if (parsed.checkin) state.checkin = parsed.checkin.format('YYYY-MM-DD');
    if (parsed.checkout) state.checkout = parsed.checkout.format('YYYY-MM-DD');
    state.intent = parsed.intent || state.intent || 'availability';
    chatbotService.saveSessionState(session.id, state);

    let reply = '';
    if (state.intent === 'availability') {
      if (!state.checkin || !state.checkout) {
        reply = renderMessage('bot', 'Diga-me as datas de chegada e saída para procurar a melhor opção.');
      } else if (!state.guests) {
        reply = renderMessage('bot', 'Quantos hóspedes vão viajar?');
      } else {
        const cards = renderAvailabilityCards({
          checkin: state.checkin,
          checkout: state.checkout,
          guests: state.guests,
        });
        reply = renderMessage(
          'bot',
          `Encontrei algumas sugestões para ${dayjs(state.checkin).format('DD/MM')} – ${dayjs(state.checkout).format('DD/MM')}.`,
          cards
        );
      }
    } else if (state.intent === 'amenities') {
      reply = renderMessage('bot', 'Aceitamos animais de estimação mediante pedido e disponibilidade. Pretende que verifique datas?');
      state.intent = 'availability';
      chatbotService.saveSessionState(session.id, state);
    } else if (state.intent === 'policy') {
      reply = renderMessage('bot', 'Check-in a partir das 15h e check-out até às 11h. Pode indicar datas para verificar disponibilidade?');
      state.intent = 'availability';
      chatbotService.saveSessionState(session.id, state);
    } else if (state.intent === 'promo') {
      reply = renderMessage('bot', 'Temos 5% de desconto para reservas diretas esta semana. Vamos procurar datas específicas?');
      state.intent = 'availability';
      chatbotService.saveSessionState(session.id, state);
    } else {
      reply = renderMessage('bot', 'Estou aqui para ajudar com disponibilidade e reservas. Quer indicar datas e número de hóspedes?');
      state.intent = 'availability';
      chatbotService.saveSessionState(session.id, state);
    }

    res.send(renderMessage('user', esc(text)) + reply);
  });

  return router;
}

module.exports = { createChatbotRouter };
