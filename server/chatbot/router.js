const express = require('express');
const { parseMessage, normalizeText } = require('./parser');

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
  const propertyLocationsStmt = db.prepare(
    `SELECT name, location FROM properties ORDER BY name LIMIT 6`
  );

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

  function buildAmenityReply(normalizedText) {
    if (/animal|cao|pet|gato/.test(normalizedText)) {
      return 'Aceitamos animais de estimação mediante pedido e disponibilidade. Basta indicar-nos no momento da reserva.';
    }
    if (/piscina|spa/.test(normalizedText)) {
      return 'Dispomos de unidades com piscina exterior aquecida sazonalmente. Posso verificar quais estão livres nas suas datas?';
    }
    if (/estacionamento|parking|carro|garagem/.test(normalizedText)) {
      return 'Temos estacionamento privativo gratuito em todas as propriedades. Quando me indicar as datas reservo uma vaga.';
    }
    if (/wifi|wi-fi|internet/.test(normalizedText)) {
      return 'Todas as unidades contam com Wi-Fi de alta velocidade ilimitado, ideal para teletrabalho.';
    }
    if (/limpeza|toalh|roupa|servico/i.test(normalizedText)) {
      return 'A limpeza intermédia e a troca de roupa de cama estão incluídas em estadias superiores a 5 noites. Precisa de algum reforço específico?';
    }
    if (/crianca|bebe|berco/.test(normalizedText)) {
      return 'Podemos disponibilizar berço e cadeira alta sem custo adicional, sujeitos a disponibilidade. Quer que reserve?';
    }
    return 'As nossas unidades incluem cozinha equipada, Wi-Fi rápido e amenities de hotel. Partilhe as datas para sugerir o melhor alojamento.';
  }

  function buildPolicyReply(normalizedText) {
    if (/cancel/.test(normalizedText)) {
      return 'As reservas diretas podem ser canceladas gratuitamente até 7 dias antes da chegada. Após esse prazo aplicamos a retenção do sinal.';
    }
    if (/early|antecipad/.test(normalizedText)) {
      return 'Podemos organizar check-in antecipado mediante disponibilidade por um suplemento de 20€. Confirme as suas horas estimadas.';
    }
    if (/late|tarde|noite/.test(normalizedText)) {
      return 'Check-in tardio após as 21h é possível com chave segura e instruções digitais. Envio-lhe tudo assim que confirmar a reserva.';
    }
    if (/check.?out|saida/.test(normalizedText)) {
      return 'O check-out decorre até às 11h para garantirmos a limpeza. Necessita de late check-out? Posso verificar disponibilidade.';
    }
    return 'O check-in inicia às 15h e o check-out termina às 11h. Cancelamentos diretos são flexíveis até 7 dias antes da chegada.';
  }

  function buildContactReply() {
    return 'Pode falar connosco através do formulário de contacto no rodapé ou deixar aqui o seu telefone/email que a nossa equipa responde rapidamente (9h–20h).';
  }

  function buildPaymentsReply() {
    return 'Aceitamos cartões Visa/Mastercard, MB Way e transferência bancária. Em reservas diretas solicitamos um sinal para garantir a estadia e o restante é pago no check-in.';
  }

  function describeLocations() {
    const rows = propertyLocationsStmt.all();
    if (!rows.length) {
      return 'Estamos sediados em várias cidades de Portugal continental. Diga-me as datas e recomendo a propriedade ideal.';
    }
    const segments = rows.map(row => `${row.name} (${row.location || 'localização central'})`);
    return `Temos disponibilidade em ${segments.join(', ')}. Indique datas e nº de hóspedes para lhe sugerir a melhor opção.`;
  }

  function stripHtml(raw = '') {
    return String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

    const replies = [];
    const normalized = normalizeText(text);

    const pushBotReply = (message, extra = '', logMessage) => {
      const sanitizedMessage = esc(message);
      replies.push(renderMessage('bot', sanitizedMessage, extra));
      const stored = stripHtml(logMessage != null ? logMessage : message);
      if (stored) {
        chatbotService.recordMessage(session.id, 'assistant', stored);
      }
    };

    switch (state.intent) {
      case 'availability':
        if (!state.checkin || !state.checkout) {
          pushBotReply('Diga-me as datas de chegada e saída para procurar a melhor opção.');
        } else if (!state.guests) {
          pushBotReply('Quantos hóspedes vão viajar?');
        } else {
          const cards = renderAvailabilityCards({
            checkin: state.checkin,
            checkout: state.checkout,
            guests: state.guests,
          });
          pushBotReply(
            `Encontrei algumas sugestões para ${dayjs(state.checkin).format('DD/MM')} – ${dayjs(state.checkout).format('DD/MM')}.`,
            cards,
            `Sugestões enviadas para ${state.checkin} a ${state.checkout}`
          );
        }
        break;
      case 'book':
        if (!state.checkin || !state.checkout) {
          pushBotReply('Vamos a isso! Diga-me as datas pretendidas para fechar a reserva.');
        } else if (!state.guests) {
          pushBotReply('Quantos hóspedes devo considerar para concluir a reserva?');
        } else {
          const cards = renderAvailabilityCards({
            checkin: state.checkin,
            checkout: state.checkout,
            guests: state.guests,
          });
          pushBotReply(
            'Aqui estão as unidades prontas a reservar. Clique em “Reservar agora” para finalizar o pedido.',
            cards,
            'Sugestões apresentadas para fechar reserva'
          );
        }
        state.intent = 'availability';
        break;
      case 'amenities': {
        const amenityReply = buildAmenityReply(normalized);
        pushBotReply(amenityReply);
        pushBotReply('Posso verificar disponibilidade se me indicar datas e nº de hóspedes.');
        state.intent = 'availability';
        break;
      }
      case 'policy': {
        const policyReply = buildPolicyReply(normalized);
        pushBotReply(policyReply);
        pushBotReply('Se quiser posso confirmar as unidades disponíveis nas suas datas.');
        state.intent = 'availability';
        break;
      }
      case 'promo':
        pushBotReply('Esta semana temos 5% de desconto em reservas diretas e upgrades gratuitos para estadias superiores a 4 noites.');
        pushBotReply('Indique o intervalo pretendido para aplicar a campanha na sua reserva.');
        state.intent = 'availability';
        break;
      case 'location':
        pushBotReply(describeLocations());
        state.intent = 'availability';
        break;
      case 'contact':
        pushBotReply(buildContactReply());
        state.intent = 'availability';
        break;
      case 'payments':
        pushBotReply(buildPaymentsReply());
        pushBotReply('Assim que confirmar as datas posso enviar o link de pagamento seguro.');
        state.intent = 'availability';
        break;
      case 'support':
        pushBotReply('Estou aqui para ajudar com disponibilidade, dúvidas e reservas. Diga-me o que precisa e trato do resto.');
        state.intent = 'availability';
        break;
      case 'greeting':
        pushBotReply('Olá! Pronto para ajudar. Tem datas ou número de hóspedes em mente?');
        state.intent = 'availability';
        break;
      case 'gratitude':
        pushBotReply('De nada! Sempre que precisar posso voltar a procurar datas ou responder a mais questões.');
        state.intent = 'availability';
        break;
      case 'smalltalk':
        pushBotReply('Fico contente por falar consigo. Quando estiver pronto diga-me as datas para encontrar o alojamento ideal.');
        state.intent = 'availability';
        break;
      default:
        pushBotReply('Estou aqui para ajudar com disponibilidade e reservas. Quer indicar datas e número de hóspedes?');
        state.intent = 'availability';
        break;
    }

    chatbotService.saveSessionState(session.id, state);

    if (!replies.length) {
      pushBotReply('Pode reformular a pergunta? Quero garantir que respondo corretamente.');
    }

    res.send(renderMessage('user', esc(text)) + replies.join(''));
  });

  return router;
}

module.exports = { createChatbotRouter };
