'use strict';

const { ValidationError } = require('./errors');

const PORTUGUESE_COUNTRIES = new Set(['PT', 'BR', 'AO', 'MZ', 'CV', 'TL', 'GW', 'ST']);
const SUBJECT_TEMPLATES = {
  pt: 'Como foi a estadia em {{property_name}}?',
  en: 'How was your stay at {{property_name}}?'
};
const DEFAULT_SUBJECT_LANGUAGE = 'en';
const MAX_REQUEST_ATTEMPTS = 3;
const MIN_HOURS_BETWEEN_REQUESTS = 72;

function sanitizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function firstNameFromGuest(value) {
  if (!value) return '';
  const parts = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  return parts[0];
}

function buildReviewLink(bookingId) {
  const base = process.env.REVIEW_FEEDBACK_URL || process.env.PUBLIC_BASE_URL || '';
  if (!base) return '';
  const normalized = base.replace(/\/$/, '');
  return `${normalized}/guest/${bookingId}/review`;
}

function formatSubject(language, variables = {}) {
  const template = SUBJECT_TEMPLATES[language] || SUBJECT_TEMPLATES[DEFAULT_SUBJECT_LANGUAGE];
  return String(template).replace(/{{\s*([a-zA-Z0-9_\.]+)\s*}}/g, (_, token) => {
    const replacement = variables[token];
    return replacement == null ? '' : String(replacement);
  });
}

function guessLanguage(booking, i18n) {
  if (!booking) return null;
  const preferred = booking.guest_language || booking.preferred_language;
  if (preferred && i18n) {
    const normalized = i18n.normalizeLanguage ? i18n.normalizeLanguage(preferred) : null;
    if (normalized) return normalized;
  }
  const nationality = String(booking.guest_nationality || '')
    .trim()
    .toUpperCase();
  if (PORTUGUESE_COUNTRIES.has(nationality)) {
    return 'pt';
  }
  return null;
}

function createReviewRequestService({ db, dayjs, messageTemplates, mailer, getBranding, i18n }) {
  if (!db) {
    throw new Error('createReviewRequestService requer acesso à base de dados.');
  }
  if (!dayjs) {
    throw new Error('createReviewRequestService requer dayjs para manipular datas.');
  }
  if (!messageTemplates || typeof messageTemplates.renderTemplate !== 'function') {
    throw new Error('createReviewRequestService requer serviço de templates.');
  }
  if (!mailer || typeof mailer.sendMail !== 'function') {
    throw new Error('createReviewRequestService requer serviço de email.');
  }

  const findBookingStmt = db.prepare(`
    SELECT
      b.id,
      b.unit_id,
      b.guest_name,
      b.guest_email,
      b.guest_nationality,
      b.checkin,
      b.checkout,
      b.status,
      b.confirmation_token,
      b.total_cents,
      u.property_id,
      u.name AS unit_name,
      p.name AS property_name
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    WHERE b.id = ?
    LIMIT 1
  `);

  const selectRequestStmt = db.prepare(
    'SELECT * FROM review_requests WHERE booking_id = ? LIMIT 1'
  );

  const insertRequestStmt = db.prepare(`
    INSERT INTO review_requests (
      booking_id,
      property_id,
      unit_id,
      guest_email,
      guest_name,
      guest_language,
      status,
      request_count,
      first_requested_at,
      last_requested_at,
      last_requested_by,
      last_error
    ) VALUES (@booking_id, @property_id, @unit_id, @guest_email, @guest_name, @guest_language, @status, @request_count, @first_requested_at, @last_requested_at, @last_requested_by, @last_error)
  `);

  const updateOnRequestStmt = db.prepare(`
    UPDATE review_requests
       SET status = @status,
           guest_email = @guest_email,
           guest_name = @guest_name,
           guest_language = COALESCE(@guest_language, guest_language),
           request_count = request_count + 1,
           last_requested_at = @last_requested_at,
           last_requested_by = @last_requested_by,
           last_error = @last_error,
           updated_at = datetime('now')
     WHERE booking_id = @booking_id
  `);

  const updateErrorOnlyStmt = db.prepare(`
    UPDATE review_requests
       SET last_error = @last_error,
           updated_at = datetime('now')
     WHERE booking_id = @booking_id
  `);

  const markReceivedStmt = db.prepare(`
    UPDATE review_requests
       SET status = 'received',
           review_id = @review_id,
           received_at = @received_at,
           updated_at = datetime('now'),
           last_error = NULL
     WHERE booking_id = @booking_id
  `);

  const listDailyCandidatesStmt = db.prepare(`
    SELECT
      b.id
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN review_requests rr ON rr.booking_id = b.id
    WHERE b.checkout = @checkout
      AND b.status = 'CONFIRMED'
      AND b.guest_email IS NOT NULL
      AND TRIM(b.guest_email) <> ''
      AND (rr.booking_id IS NULL OR rr.request_count = 0)
  `);

  function ensureCheckoutEligible(booking) {
    if (!booking) {
      throw new ValidationError('Reserva não encontrada.');
    }
    if (!booking.guest_email || !sanitizeEmail(booking.guest_email)) {
      throw new ValidationError('Reserva sem email de hóspede válido.');
    }
    if (booking.status && booking.status !== 'CONFIRMED') {
      throw new ValidationError('Apenas reservas confirmadas podem receber pedidos de review.');
    }
    if (!booking.checkout) {
      throw new ValidationError('Reserva sem data de check-out.');
    }
    const checkoutDate = dayjs(booking.checkout);
    if (!checkoutDate.isValid()) {
      throw new ValidationError('Data de check-out inválida.');
    }
    const now = dayjs();
    if (checkoutDate.isAfter(now, 'day')) {
      throw new ValidationError('Ainda não é possível pedir avaliação para esta reserva.');
    }
  }

  async function deliverEmail({ booking, language, variables, from }) {
    const template = messageTemplates.renderTemplate('review_request_post_checkout', {
      language,
      guestLanguage: language,
      variables
    });
    if (!template) {
      throw new Error('Template de review não encontrado.');
    }
    const subject = formatSubject(template.language, variables);
    const textBody = template.body || '';
    const htmlBody = textBody.replace(/\r?\n/g, '<br/>');
    await mailer.sendMail({
      to: booking.guest_email,
      subject,
      text: textBody,
      html: htmlBody,
      from
    });
    return { subject, body: textBody, language: template.language };
  }

  function buildTemplateVariables({ booking, language }) {
    const checkoutLabel = booking.checkout && dayjs(booking.checkout).isValid()
      ? dayjs(booking.checkout).format('DD/MM/YYYY')
      : booking.checkout || '';
    const brand = typeof getBranding === 'function'
      ? getBranding({ propertyId: booking.property_id, propertyName: booking.property_name })
      : null;
    const brandName = brand && brand.brandName ? brand.brandName : (booking.property_name || 'A nossa equipa');
    const reviewLink = buildReviewLink(booking.id);

    return {
      guest_first_name: firstNameFromGuest(booking.guest_name),
      property_name: booking.property_name || '',
      checkout: checkoutLabel,
      brand_name: brandName,
      review_link: reviewLink
    };
  }

  function recordSuccess({ booking, guestLanguage, requestedBy, request }) {
    const nowIso = dayjs().toISOString();
    if (!request) {
      insertRequestStmt.run({
        booking_id: booking.id,
        property_id: booking.property_id || null,
        unit_id: booking.unit_id || null,
        guest_email: booking.guest_email,
        guest_name: booking.guest_name || null,
        guest_language: guestLanguage || null,
        status: 'requested',
        request_count: 1,
        first_requested_at: nowIso,
        last_requested_at: nowIso,
        last_requested_by: requestedBy || null,
        last_error: null
      });
      return;
    }
    updateOnRequestStmt.run({
      booking_id: booking.id,
      guest_email: booking.guest_email,
      guest_name: booking.guest_name || null,
      guest_language: guestLanguage || null,
      status: 'requested',
      last_requested_at: nowIso,
      last_requested_by: requestedBy || null,
      last_error: null
    });
  }

  function recordFailure({ booking, request, error }) {
    const message = error && error.message ? String(error.message).slice(0, 500) : 'Erro desconhecido';
    if (!request) {
      insertRequestStmt.run({
        booking_id: booking.id,
        property_id: booking.property_id || null,
        unit_id: booking.unit_id || null,
        guest_email: booking.guest_email,
        guest_name: booking.guest_name || null,
        guest_language: guessLanguage(booking, i18n),
        status: 'pending',
        request_count: 0,
        first_requested_at: null,
        last_requested_at: null,
        last_requested_by: null,
        last_error: message
      });
      return;
    }
    updateErrorOnlyStmt.run({ booking_id: booking.id, last_error: message });
  }

  function assertCanRequest({ request, allowRetry, minHoursBetween }) {
    if (!request) return;
    if (request.status === 'received') {
      throw new ValidationError('Esta reserva já tem uma review recebida.');
    }
    if (request.request_count >= MAX_REQUEST_ATTEMPTS) {
      throw new ValidationError('Limite de pedidos atingido para esta reserva.');
    }
    if (!allowRetry && request.request_count > 0) {
      throw new ValidationError('Já existe um pedido de review para esta reserva.');
    }
    if (request.last_requested_at) {
      const last = dayjs(request.last_requested_at);
      if (last.isValid()) {
        const hours = dayjs().diff(last, 'hour');
        if (hours < minHoursBetween) {
          throw new ValidationError('Aguarda mais algum tempo antes de reenviar o pedido.');
        }
      }
    }
  }

  async function requestReviewForBooking({
    bookingId,
    requestedBy = null,
    allowRetry = false,
    minHoursBetween = MIN_HOURS_BETWEEN_REQUESTS
  } = {}) {
    const booking = findBookingStmt.get(bookingId);
    ensureCheckoutEligible(booking);
    const request = selectRequestStmt.get(bookingId);
    assertCanRequest({ request, allowRetry, minHoursBetween });

    const guestLanguage = guessLanguage(booking, i18n) || 'en';
    const variables = buildTemplateVariables({ booking, language: guestLanguage });
    const from = typeof mailer.getDefaultFrom === 'function' ? mailer.getDefaultFrom() : undefined;

    try {
      const result = await deliverEmail({ booking, language: guestLanguage, variables, from });
      const tx = db.transaction(() => {
        recordSuccess({ booking, guestLanguage: result.language, requestedBy, request });
      });
      tx();
      return {
        ok: true,
        bookingId: booking.id,
        language: result.language,
        subject: result.subject,
        status: 'requested'
      };
    } catch (err) {
      const tx = db.transaction(() => {
        recordFailure({ booking, request, error: err });
      });
      tx();
      throw err;
    }
  }

  function markRequestReceived({ bookingId, reviewId = null, receivedAt = null } = {}) {
    // A coluna review_id referencia reviews(id); fornecer um ID inexistente originará uma
    // violação de chave estrangeira, por isso os chamadores devem garantir que a avaliação
    // já existe antes de marcar o pedido como recebido.
    if (!bookingId) return false;
    const timestamp = receivedAt && dayjs(receivedAt).isValid()
      ? dayjs(receivedAt).toISOString()
      : dayjs().toISOString();
    const result = markReceivedStmt.run({
      booking_id: bookingId,
      review_id: reviewId || null,
      received_at: timestamp
    });
    return result.changes > 0;
  }

  async function processDailyRequests({ targetDate, requestedBy = null } = {}) {
    if (!targetDate) {
      throw new Error('processDailyRequests requer data alvo.');
    }
    const rows = listDailyCandidatesStmt.all({ checkout: targetDate });
    const successes = [];
    for (const row of rows) {
      try {
        const result = await requestReviewForBooking({
          bookingId: row.id,
          requestedBy,
          allowRetry: false
        });
        successes.push(result);
      } catch (err) {
        // Falha individual não deve parar o lote
        if (console && typeof console.warn === 'function') {
          console.warn('Falha ao pedir review para reserva', row.id, err.message);
        }
      }
    }
    return successes;
  }

  function getRequestForBooking(bookingId) {
    return selectRequestStmt.get(bookingId) || null;
  }

  return {
    requestReviewForBooking,
    processDailyRequests,
    markRequestReceived,
    getRequestForBooking,
    constants: {
      MAX_REQUEST_ATTEMPTS,
      MIN_HOURS_BETWEEN_REQUESTS
    }
  };
}

module.exports = {
  createReviewRequestService
};
