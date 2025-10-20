const { ConflictError, ValidationError } = require('../../services/errors');
const { setNoIndex, verifySignedQuery, rateLimitByUserRoute } = require('../../middlewares/security');
const { serverRender } = require('../../middlewares/telemetry');
const { aggregatePaymentData, computeOutstandingCents } = require('../../services/payments/summary');
const { describePaymentStatus } = require('../../services/payments/status');

module.exports = function registerFrontoffice(app, context) {
  const {
    db,
    html,
    layout,
    esc,
    crypto,
    fs,
    path,
    dayjs,
    eur,
    getSession,
    buildUserContext,
    resolveBrandingForRequest,
    parsePropertyId,
    formatMonthYear,
    rememberActiveBrandingProperty,
    userCan,
    selectPropertyById,
    unitAvailable,
    rateQuote,
    csrfProtection,
    parseFeaturesStored,
    featureChipsHtml,
    dateRangeNights,
    requireLogin,
    requirePermission,
    logActivity,
    logChange,
    overlaps,
    ExcelJS,
    rescheduleBookingUpdateStmt,
    rescheduleBlockUpdateStmt,
    bookingEmailer,
    guestPortalService,
    overbookingGuard,
    otaDispatcher,
    featureFlags,
    isFeatureEnabled,
    ratePlanService,
    slugify
  } = context;

  function summarizePaymentDetailsForBooking(booking, summary, extrasSummary = null) {
    if (!summary) {
      return ['Sem pagamentos registados'];
    }

    const totalRecorded =
      (summary.capturedCents || 0) +
      (summary.pendingCents || 0) +
      (summary.actionRequiredCents || 0) +
      (summary.failedCents || 0) +
      (summary.cancelledCents || 0) +
      (summary.refundedCents || 0);

    if (totalRecorded === 0) {
      return ['Sem pagamentos registados'];
    }

    const bookingTotalCents = Number(booking.total_cents || 0);
    const extrasOutstandingCents = extrasSummary ? Number(extrasSummary.outstandingCents || 0) : 0;
    const combinedTotal = bookingTotalCents + extrasOutstandingCents;
    const outstandingCents = computeOutstandingCents(summary, combinedTotal);

    let statusLabel = null;
    if (combinedTotal > 0 && summary.netCapturedCents >= combinedTotal) {
      statusLabel = describePaymentStatus('captured').label;
    } else if ((summary.actionRequiredCents || 0) > 0) {
      statusLabel = describePaymentStatus('requires_action').label;
    } else if ((summary.pendingCents || 0) > 0) {
      statusLabel = describePaymentStatus('pending').label;
    } else if ((summary.failedCents || 0) > 0) {
      statusLabel = describePaymentStatus('failed').label;
    } else if ((summary.cancelledCents || 0) > 0) {
      statusLabel = describePaymentStatus('cancelled').label;
    } else if ((summary.netCapturedCents || 0) > 0) {
      statusLabel = 'Pago parcial';
    }

    const lines = [];
    if (statusLabel) {
      lines.push(`Estado: ${statusLabel}`);
    }
    const netCaptured = Number(summary.netCapturedCents || 0);
    if (netCaptured > 0) {
      lines.push(`Pago: € ${eur(netCaptured)}`);
    }
    if ((summary.refundedCents || 0) > 0) {
      lines.push(`Reembolsado: € ${eur(summary.refundedCents)}`);
    }
    if ((summary.pendingCents || 0) > 0) {
      lines.push(`Pendente: € ${eur(summary.pendingCents)}`);
    }
    if ((summary.actionRequiredCents || 0) > 0) {
      lines.push(`Ação necessária: € ${eur(summary.actionRequiredCents)}`);
    }
    if ((summary.failedCents || 0) > 0) {
      lines.push(`Falhou: € ${eur(summary.failedCents)}`);
    }
    if ((summary.cancelledCents || 0) > 0) {
      lines.push(`Cancelado: € ${eur(summary.cancelledCents)}`);
    }
    if (extrasSummary && extrasSummary.totalCents > 0) {
      lines.push(`Extras: € ${eur(extrasSummary.totalCents)}`);
      if (extrasSummary.refundedCents > 0) {
        lines.push(`Extras reembolsados: € ${eur(extrasSummary.refundedCents)}`);
      }
      if (extrasSummary.outstandingCents > 0) {
        lines.push(`Extras por cobrar: € ${eur(extrasSummary.outstandingCents)}`);
      }
    }

    if (outstandingCents > 0) {
      lines.push(`Por cobrar: € ${eur(outstandingCents)}`);
    } else if (combinedTotal > 0 && summary.netCapturedCents >= combinedTotal) {
      lines.push('Saldo liquidado');
    }

    return lines.length ? lines : ['Sem movimentos registados'];
  }

  function normalizeGuestToken(token) {
    return typeof token === 'string' ? token.trim() : '';
  }

  function safeParseJson(value, fallback = null) {
    if (!value || typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value);
    } catch (err) {
      return fallback;
    }
  }

  function parsePolicyExtras(rawExtras) {
    const parsed = safeParseJson(rawExtras, []);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => {
        if (!item) return null;
        const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Extra ${index + 1}`;
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        const codeSource = item.code || item.id || name;
        const code = slugify ? slugify(String(codeSource)) : String(codeSource || `extra-${index + 1}`).toLowerCase();
        if (!code) return null;

        let priceCents = null;
        if (item.price_cents != null && Number.isFinite(Number(item.price_cents))) {
          priceCents = Math.round(Number(item.price_cents));
        } else if (item.price != null && Number.isFinite(Number(item.price))) {
          priceCents = Math.round(Number(item.price) * 100);
        }

        const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : code;
        const pricingRule = normalizePricingRule(item.pricing_rule);
        const pricingConfig = parsePricingConfig(item.pricing_config);
        const availability = parseExtraAvailability(item);

        return {
          id,
          code,
          name,
          description,
          priceCents: priceCents != null ? priceCents : null,
          priceFormatted: priceCents != null ? `€ ${eur(priceCents)}` : null,
          pricingRule,
          pricingConfig,
          pricingRuleDescription: describePricingRule(pricingRule, pricingConfig),
          availability,
          availabilityDescription: describeAvailability(availability)
        };
      })
      .filter(Boolean);
  }

  function normalizePricingRule(value) {
    if (typeof value !== 'string') return 'standard';
    const normalized = value.trim().toLowerCase();
    return normalized || 'standard';
  }

  function parsePricingConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const config = {};
    if (raw.min_nights != null && Number.isFinite(Number(raw.min_nights))) {
      config.minNights = Math.max(1, Math.round(Number(raw.min_nights)));
    }
    if (raw.discount_percent != null && Number.isFinite(Number(raw.discount_percent))) {
      const discount = Math.round(Number(raw.discount_percent));
      config.discountPercent = Math.max(0, Math.min(100, discount));
    }
    return Object.keys(config).length ? config : null;
  }

  function parseExtraAvailability(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const from = typeof raw.available_from === 'string' ? raw.available_from.trim() : raw.availableFrom;
    const to = typeof raw.available_until === 'string' ? raw.available_until.trim() : raw.availableUntil;
    const availabilityField = raw.availability && typeof raw.availability === 'object' ? raw.availability : null;
    const altFrom = availabilityField && typeof availabilityField.from === 'string' ? availabilityField.from.trim() : null;
    const altTo = availabilityField && typeof availabilityField.to === 'string' ? availabilityField.to.trim() : null;
    const start = (from || altFrom || '').trim();
    const end = (to || altTo || '').trim();
    if (!start && !end) return null;
    return { from: start || null, to: end || null };
  }

  function describePricingRule(rule, config) {
    if (rule === 'long_stay') {
      const minNights = config && config.minNights ? config.minNights : 7;
      const discount = config && config.discountPercent ? config.discountPercent : null;
      if (discount) {
        return `Desconto de ${discount}% para estadias de ${minNights} noite(s) ou mais.`;
      }
      return `Disponível para estadias de ${minNights} noite(s) ou mais.`;
    }
    return null;
  }

  function describeAvailability(availability) {
    if (!availability) return null;
    const parts = [];
    if (availability.from) parts.push(`a partir das ${availability.from}`);
    if (availability.to) parts.push(`até às ${availability.to}`);
    if (!parts.length) return null;
    return `Disponível ${parts.join(' ')}`.trim();
  }

  function parseTimeToMinutes(value) {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    const formats = ['HH:mm', 'H:mm'];
    for (const fmt of formats) {
      const parsed = dayjs(normalized, fmt, true);
      if (parsed.isValid()) {
        return parsed.hour() * 60 + parsed.minute();
      }
    }
    return null;
  }

  function isExtraAvailableNow(extra, referenceTime = dayjs()) {
    if (!extra || !extra.availability) return true;
    const minutesNow = referenceTime.diff(referenceTime.startOf('day'), 'minute');
    const fromMinutes = parseTimeToMinutes(extra.availability.from);
    const toMinutes = parseTimeToMinutes(extra.availability.to);
    if (fromMinutes != null && minutesNow < fromMinutes) return false;
    if (toMinutes != null && minutesNow > toMinutes) return false;
    return true;
  }

  function validateExtraEligibility(extra, bookingRow, referenceTime = dayjs()) {
    if (!extra) {
      return { ok: false, reason: 'invalid' };
    }
    if (!isExtraAvailableNow(extra, referenceTime)) {
      return { ok: false, reason: 'schedule' };
    }
    if (extra.pricingRule === 'long_stay') {
      const nights = dateRangeNights(bookingRow.checkin, bookingRow.checkout).length;
      const minNights = extra.pricingConfig && extra.pricingConfig.minNights ? extra.pricingConfig.minNights : 7;
      if (nights < minNights) {
        return { ok: false, reason: 'long_stay' };
      }
    }
    return { ok: true };
  }

  function computeExtraPricing(extra, bookingRow, quantity) {
    const safeQuantity = Math.max(1, Math.round(Number(quantity) || 0));
    const baseUnitPrice = Number(extra.priceCents || 0);
    const payload = {
      pricingRule: extra.pricingRule || 'standard',
      quantity: safeQuantity,
      baseUnitPriceCents: baseUnitPrice
    };

    let unitPrice = baseUnitPrice;
    if (extra.pricingRule === 'long_stay') {
      const nights = dateRangeNights(bookingRow.checkin, bookingRow.checkout).length;
      const minNights = extra.pricingConfig && extra.pricingConfig.minNights ? extra.pricingConfig.minNights : 7;
      const discountPercent = extra.pricingConfig && extra.pricingConfig.discountPercent ? extra.pricingConfig.discountPercent : 0;
      payload.minNights = minNights;
      payload.nights = nights;
      payload.discountPercent = discountPercent;
      if (discountPercent > 0 && nights >= minNights) {
        const effective = Math.max(0, Math.min(100, discountPercent));
        unitPrice = Math.round(baseUnitPrice * (1 - effective / 100));
        payload.discountApplied = true;
      } else {
        payload.discountApplied = false;
      }
    }

    const unitPriceCents = Math.max(0, Math.round(unitPrice));
    const totalCents = Math.max(0, unitPriceCents * safeQuantity);
    return { unitPriceCents, totalCents, pricingPayload: payload };
  }

  function listBookingExtras(bookingId) {
    const rows = db
      .prepare(
        `SELECT id, extra_id, extra_name, pricing_rule, pricing_payload_json, quantity, unit_price_cents,
                total_cents, refunded_cents, status, created_at, updated_at
           FROM booking_extras
          WHERE booking_id = ?
          ORDER BY created_at ASC, id ASC`
      )
      .all(bookingId);

    return rows.map(row => {
      const pricingPayload = safeParseJson(row.pricing_payload_json, null);
      const totalCents = Number(row.total_cents) || 0;
      const refundedCents = Number(row.refunded_cents) || 0;
      const outstandingCents = Math.max(0, totalCents - refundedCents);
      return {
        id: row.id,
        extraId: row.extra_id,
        name: row.extra_name,
        pricingRule: row.pricing_rule || null,
        pricingPayload,
        quantity: Number(row.quantity) || 0,
        unitPriceCents: Number(row.unit_price_cents) || 0,
        unitPriceFormatted: `€ ${eur(row.unit_price_cents || 0)}`,
        totalCents,
        totalFormatted: `€ ${eur(totalCents)}`,
        refundedCents,
        refundedFormatted: refundedCents > 0 ? `€ ${eur(refundedCents)}` : null,
        outstandingCents,
        outstandingFormatted: `€ ${eur(outstandingCents)}`,
        status: row.status || 'confirmed',
        createdAt: row.created_at || null,
        createdAtLabel:
          row.created_at && dayjs(row.created_at).isValid() ? dayjs(row.created_at).format('DD/MM/YYYY HH:mm') : null,
        updatedAt: row.updated_at || null
      };
    });
  }

  function summarizeBookingExtras(entries) {
    return entries.reduce(
      (acc, entry) => {
        if (entry.status && entry.status.toLowerCase() === 'cancelled') {
          return acc;
        }
        acc.totalCents += Number(entry.totalCents) || 0;
        acc.refundedCents += Number(entry.refundedCents) || 0;
        acc.outstandingCents += Number(entry.outstandingCents) || 0;
        return acc;
      },
      { totalCents: 0, refundedCents: 0, outstandingCents: 0 }
    );
  }

  function loadGuestBookingRow(bookingId) {
    return db
      .prepare(
        `SELECT b.*, u.name AS unit_name, u.property_id, p.name AS property_name, p.address AS property_address,
                p.locality AS property_locality, p.district AS property_district,
                pol.checkin_from, pol.checkout_until, pol.pets_allowed, pol.pets_fee,
                pol.cancellation_policy, pol.parking_info, pol.children_policy,
                pol.payment_methods, pol.quiet_hours, pol.extras AS policy_extras
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
      LEFT JOIN property_policies pol ON pol.property_id = p.id
          WHERE b.id = ?`
      )
      .get(bookingId);
  }

  function buildGuestPortalPayload(bookingRow) {
    if (!bookingRow) return null;

    const nights = dateRangeNights(bookingRow.checkin, bookingRow.checkout).length;
    const checkinDate = bookingRow.checkin && dayjs(bookingRow.checkin).isValid()
      ? dayjs(bookingRow.checkin)
      : null;
    const checkoutDate = bookingRow.checkout && dayjs(bookingRow.checkout).isValid()
      ? dayjs(bookingRow.checkout)
      : null;
    const checkinLabel = checkinDate ? checkinDate.format('DD/MM/YYYY') : bookingRow.checkin;
    const checkoutLabel = checkoutDate ? checkoutDate.format('DD/MM/YYYY') : bookingRow.checkout;
    const statusRaw = (bookingRow.status || '').toUpperCase();
    const statusLabel =
      statusRaw === 'CONFIRMED'
        ? 'Confirmada'
        : statusRaw === 'PENDING'
          ? 'Pendente'
          : statusRaw === 'CANCELLED'
            ? 'Cancelada'
            : statusRaw || 'Reserva';

    const payments = db
      .prepare(
        `SELECT id, status, amount_cents, currency, created_at
           FROM payments
          WHERE booking_id = ?
          ORDER BY created_at ASC`
      )
      .all(bookingRow.id);

    const paymentIds = payments.map(p => p.id).filter(Boolean);
    const refunds = paymentIds.length
      ? db
          .prepare(
            `SELECT payment_id, amount_cents, status, created_at
               FROM refunds
              WHERE payment_id IN (${paymentIds.map(() => '?').join(',')})`
          )
          .all(...paymentIds)
      : [];

    const extrasAvailable = parsePolicyExtras(bookingRow.policy_extras);
    const bookedExtras = listBookingExtras(bookingRow.id);
    const extrasSummary = summarizeBookingExtras(bookedExtras);
    const combinedTotalCents = (Number(bookingRow.total_cents) || 0) + Number(extrasSummary.outstandingCents || 0);

    const { bookingSummaries } = aggregatePaymentData({ payments, refunds });
    const paymentSummary = bookingSummaries.get(bookingRow.id) || null;
    const outstandingCents = computeOutstandingCents(paymentSummary, combinedTotalCents);
    const paymentLines = summarizePaymentDetailsForBooking(
      { ...bookingRow, total_cents: combinedTotalCents },
      paymentSummary,
      extrasSummary
    );

    const paymentEntries = payments.map(payment => {
      const descriptor = describePaymentStatus(payment.status);
      const createdAtLabel = payment.created_at && dayjs(payment.created_at).isValid()
        ? dayjs(payment.created_at).format('DD/MM/YYYY HH:mm')
        : null;
      return {
        id: payment.id,
        status: payment.status,
        statusLabel: descriptor.label,
        statusTone: descriptor.tone,
        amountCents: payment.amount_cents,
        amountFormatted: `€ ${eur(payment.amount_cents || 0)}`,
        createdAt: payment.created_at || null,
        createdAtLabel
      };
    });

    const instructionsAddressParts = [bookingRow.property_address, bookingRow.property_locality, bookingRow.property_district]
      .map(part => (part || '').trim())
      .filter(Boolean);

    return {
      booking: {
        id: bookingRow.id,
        status: statusRaw,
        statusLabel,
        propertyName: bookingRow.property_name || '',
        unitName: bookingRow.unit_name || '',
        guestName: bookingRow.guest_name || '',
        guestEmail: bookingRow.guest_email || '',
        guestPhone: bookingRow.guest_phone || '',
        guestNationality: bookingRow.guest_nationality || '',
        guestCount: (Number(bookingRow.adults) || 0) + (Number(bookingRow.children) || 0),
        adults: Number(bookingRow.adults) || 0,
        children: Number(bookingRow.children) || 0,
        agency: bookingRow.agency || '',
        checkin: bookingRow.checkin,
        checkinLabel,
        checkout: bookingRow.checkout,
        checkoutLabel,
        nights,
        totalCents: Number(bookingRow.total_cents) || 0,
        totalFormatted: `€ ${eur(bookingRow.total_cents || 0)}`,
        propertyId: bookingRow.property_id,
        propertyAddress: instructionsAddressParts.join(' · ')
      },
      instructions: {
        address: instructionsAddressParts.join('\n'),
        checkinFrom: bookingRow.checkin_from || null,
        checkoutUntil: bookingRow.checkout_until || null,
        parkingInfo: bookingRow.parking_info || null,
        quietHours: bookingRow.quiet_hours || null,
        cancellationPolicy: bookingRow.cancellation_policy || null,
        paymentMethods: bookingRow.payment_methods || null,
        childrenPolicy: bookingRow.children_policy || null,
        petsAllowed:
          bookingRow.pets_allowed == null
            ? null
            : Number(bookingRow.pets_allowed) === 1,
        petsFee: bookingRow.pets_fee != null && Number.isFinite(Number(bookingRow.pets_fee))
          ? Number(bookingRow.pets_fee)
          : null
      },
      payments: {
        totalCents: combinedTotalCents,
        totalFormatted: `€ ${eur(combinedTotalCents)}`,
        outstandingCents,
        outstandingFormatted: `€ ${eur(outstandingCents || 0)}`,
        summaryLines: paymentLines,
        entries: paymentEntries
      },
      extras: {
        available: extrasAvailable,
        purchases: bookedExtras,
        summary: {
          totalCents: extrasSummary.totalCents,
          totalFormatted: `€ ${eur(extrasSummary.totalCents || 0)}`,
          refundedCents: extrasSummary.refundedCents,
          refundedFormatted:
            extrasSummary.refundedCents > 0 ? `€ ${eur(extrasSummary.refundedCents)}` : null,
          outstandingCents: extrasSummary.outstandingCents,
          outstandingFormatted: `€ ${eur(extrasSummary.outstandingCents || 0)}`
        }
      }
    };
  }

  function serializeGuestPortalState(value) {
    try {
      return JSON.stringify(value).replace(/</g, '\\u003c');
    } catch (err) {
      return '{}';
    }
  }

  function isFlagEnabled(flagName) {
    let enabled;

    if (typeof isFeatureEnabled === 'function') {
      enabled = isFeatureEnabled(flagName);
    } else if (featureFlags && Object.prototype.hasOwnProperty.call(featureFlags, flagName)) {
      enabled = !!featureFlags[flagName];
    } else {
      enabled = false;
    }

    if (enabled && flagName === 'FEATURE_SIGNED_EXPORT_DOWNLOAD' && !process.env.EXPORT_SIGNING_KEY) {
      return false;
    }

    return !!enabled;
  }

  function ensureNoIndexHeader(res) {
    if (isFlagEnabled('FEATURE_META_NOINDEX_BACKOFFICE')) {
      setNoIndex(res);
    }
  }

  function logExportActivity(user, action, metadata = {}) {
    if (typeof logActivity === 'function' && user && user.id) {
      try {
        logActivity(user.id, action, 'user', user.id, metadata);
        return;
      } catch (err) {
        // fallback to console
      }
    }
    console.info(`[${action}]`, {
      userId: user && user.id ? user.id : null,
      ...metadata
    });
  }

  const exportRateLimiter = rateLimitByUserRoute({
    featureFlag: 'FEATURE_EXPORT_RATE_LIMIT',
    isEnabled: isFlagEnabled,
    windowMs: 60_000,
    max: 5,
    message: () => 'Demasiados pedidos de exportação. Aguarde um minuto antes de tentar novamente.',
    onLimit: req => {
      logExportActivity(req.user, 'export:download_rate_limited', {
        ym: req.query.ym,
        months: req.query.months
      });
    }
  });

  const verifyExportSignature = verifySignedQuery({
    featureFlag: 'FEATURE_SIGNED_EXPORT_DOWNLOAD',
    isEnabled: isFlagEnabled,
    maxAgeMs: 60_000,
    getSecret: () => process.env.EXPORT_SIGNING_KEY,
    onFailure: (req, _res, reason) => {
      logExportActivity(req.user, 'export:download_denied', {
        reason,
        ym: req.query.ym,
        months: req.query.months
      });
    },
    assign: (req, payload) => {
      req.exportDownloadParams = payload;
    }
  });

  function logExportAttempt(req, _res, next) {
    logExportActivity(req.user, 'export:download_attempt', {
      ym: req.query.ym,
      months: req.query.months
    });
    next();
  }

  function sanitizeMonths(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    const integer = Math.floor(parsed);
    return Math.min(12, Math.max(1, integer));
  }

  function buildSignedExportLink(ym, months) {
    const safeYm = /^\d{4}-\d{2}$/.test(ym) ? ym : dayjs().format('YYYY-MM');
    const safeMonths = sanitizeMonths(months);
    if (isFlagEnabled('FEATURE_SIGNED_EXPORT_DOWNLOAD')) {
      const signingKey = process.env.EXPORT_SIGNING_KEY;
      if (!signingKey) {
        return { url: null, error: 'Chave de assinatura não configurada.' };
      }
      const ts = Date.now();
      const payload = `ym=${safeYm}&months=${safeMonths}&ts=${ts}`;
      const sig = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
      return {
        url: `/admin/export/download?${payload}&sig=${sig}`,
        error: null,
        ts
      };
    }
    return {
      url: `/admin/export/download?ym=${encodeURIComponent(safeYm)}&months=${safeMonths}`,
      error: null,
      ts: null
    };
  }


  function sanitizeBookingSubmission(payload, { requireAgency }) {
    const errors = [];

    const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const guestName = normalizeWhitespace(payload.guest_name);
    if (guestName.length < 2 || guestName.length > 120) {
      errors.push('Nome do hóspede deve ter entre 2 e 120 caracteres.');
    }

    const guestNationality = normalizeWhitespace(payload.guest_nationality);
    if (!guestNationality) {
      errors.push('Nacionalidade é obrigatória.');
    } else if (guestNationality.length > 80) {
      errors.push('Nacionalidade deve ter no máximo 80 caracteres.');
    }

    const rawEmail = String(payload.guest_email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail) || rawEmail.length > 160) {
      errors.push('Email do hóspede inválido.');
    }

    const rawPhone = String(payload.guest_phone || '').trim();
    const phoneNormalized = rawPhone.replace(/[^0-9+]/g, '');
    const numericDigits = phoneNormalized.replace(/\D/g, '');
    if (numericDigits.length < 6 || phoneNormalized.length > 32) {
      errors.push('Telefone do hóspede inválido.');
    }

    const checkin = String(payload.checkin || '').trim();
    const checkout = String(payload.checkout || '').trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(checkin) || !dayjs(checkin).isValid()) {
      errors.push('Data de check-in inválida.');
    }
    if (!datePattern.test(checkout) || !dayjs(checkout).isValid()) {
      errors.push('Data de check-out inválida.');
    } else if (!dayjs(checkout).isAfter(dayjs(checkin))) {
      errors.push('Check-out deve ser posterior ao check-in.');
    }

    const adults = Math.max(1, Math.min(12, Number.parseInt(payload.adults, 10) || 1));
    const children = Math.max(0, Math.min(12, Number.parseInt(payload.children, 10) || 0));

    const agencyRaw = normalizeWhitespace(payload.agency).toUpperCase();
    let agency = agencyRaw || null;
    if (requireAgency && !agency) {
      errors.push('Agência é obrigatória para reservas internas.');
    }
    if (agency && agency.length > 60) {
      agency = agency.slice(0, 60);
    }

    return {
      errors,
      data: {
        guest_name: guestName,
        guest_email: rawEmail,
        guest_nationality: guestNationality,
        guest_phone: phoneNormalized,
        checkin,
        checkout,
        adults,
        children,
        agency,
      },
    };
  }

  // ===================== Front Office =====================
  function renderSearchPage(req, res) {
    const sess = getSession(req.cookies.adm, req);
    const viewer = sess ? buildUserContext(sess) : undefined;
    const user = viewer;

    const rawQuery = req.query || {};
    const rawCheckin = typeof rawQuery.checkin === 'string' ? rawQuery.checkin.trim() : '';
    const rawCheckout = typeof rawQuery.checkout === 'string' ? rawQuery.checkout.trim() : '';
    const checkinValid = rawCheckin && dayjs(rawCheckin, 'YYYY-MM-DD', true).isValid();
    const checkoutValid = rawCheckout && dayjs(rawCheckout, 'YYYY-MM-DD', true).isValid();
    const searchActive = checkinValid && checkoutValid && dayjs(rawCheckout).isAfter(dayjs(rawCheckin));

    const adultsRaw = rawQuery.adults;
    const childrenRaw = rawQuery.children;
    const adults = Math.max(1, Number.parseInt(adultsRaw, 10) || 1);
    const children = Math.max(0, Number.parseInt(childrenRaw, 10) || 0);
    const totalGuests = adults + children;
    const guestFilterExplicit = Object.prototype.hasOwnProperty.call(rawQuery, 'adults') || Object.prototype.hasOwnProperty.call(rawQuery, 'children');
    const guestFilterActive = searchActive || guestFilterExplicit;

    const queryPropertyValue = rawQuery ? (rawQuery.propertyId ?? rawQuery.property_id ?? rawQuery.property ?? null) : null;
    const propertyId = parsePropertyId(queryPropertyValue);
    const propertyRow = propertyId ? selectPropertyById.get(propertyId) : null;

    const theme = resolveBrandingForRequest(req, { propertyId, propertyName: propertyRow ? propertyRow.name : null });
    if (propertyId) {
      rememberActiveBrandingProperty(res, propertyId);
    }

    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
    const hasPropertiesConfigured = properties.length > 0;

    let propertyNotFound = false;
    let propertyList = properties;
    if (propertyId) {
      propertyList = properties.filter(p => p.id === propertyId);
      if (propertyList.length === 0) {
        propertyNotFound = true;
      }
    }

    const propertyGroups = propertyList.map(p => ({
      id: p.id,
      name: p.name,
      safeName: esc(p.name),
      totalUnits: 0,
      units: [],
      availableUnits: 0
    }));
    const propertyGroupMap = new Map(propertyGroups.map(group => [group.id, group]));

    const units = propertyGroups.length
      ? db.prepare(
          `SELECT u.*, p.name AS property_name
             FROM units u
             JOIN properties p ON p.id = u.property_id
            WHERE (? IS NULL OR u.property_id = ?)
            ORDER BY p.name, u.name`
        ).all(propertyId || null, propertyId || null)
      : [];

    const primaryImageStmt = db.prepare(
      'SELECT file, alt FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 1'
    );

    units.forEach(u => {
      const group = propertyGroupMap.get(u.property_id);
      if (!group) return;
      group.totalUnits += 1;

      const meetsCapacity = !guestFilterActive || u.capacity >= totalGuests;
      const rawImage = primaryImageStmt.get(u.id);
      const image = rawImage
        ? {
            url: `/uploads/units/${u.id}/${rawImage.file}`,
            safeAlt: esc(rawImage.alt || `${u.property_name} - ${u.name}`)
          }
        : null;
      const features = parseFeaturesStored(u.features);

      if (searchActive) {
        if (!meetsCapacity) return;
        if (!unitAvailable(u.id, rawCheckin, rawCheckout)) return;
        const quote = rateQuote(u.id, rawCheckin, rawCheckout, u.base_price_cents);
        if (quote.nights < quote.minStayReq) return;
        group.units.push({
          id: u.id,
          name: u.name,
          safeName: esc(u.name),
          capacity: u.capacity,
          basePriceCents: u.base_price_cents,
          quote,
          image,
          features
        });
        group.availableUnits += 1;
      } else {
        group.units.push({
          id: u.id,
          name: u.name,
          safeName: esc(u.name),
          capacity: u.capacity,
          basePriceCents: u.base_price_cents,
          image,
          features
        });
      }
    });

    propertyGroups.forEach(group => {
      if (!searchActive) {
        group.availableUnits = group.units.length;
      }
      if (searchActive) {
        group.units.sort((a, b) => {
          if (!a.quote || !b.quote) return a.safeName.localeCompare(b.safeName);
          return a.quote.total_cents - b.quote.total_cents || a.safeName.localeCompare(b.safeName);
        });
      } else {
        group.units.sort((a, b) => a.safeName.localeCompare(b.safeName));
      }
    });

    const totalProperties = propertyGroups.length;
    const totalVisibleUnits = propertyGroups.reduce((sum, group) => sum + group.units.length, 0);
    const totalUnits = propertyGroups.reduce((sum, group) => sum + group.totalUnits, 0);

    const dateSummary = searchActive ? `${dayjs(rawCheckin).format('DD/MM/YYYY')} - ${dayjs(rawCheckout).format('DD/MM/YYYY')}` : '';
    const guestsSummary = `${adults} adulto${adults === 1 ? '' : 's'}${children ? ` · ${children} criança${children === 1 ? '' : 's'}` : ''}`;
    const propertySummary = propertyRow ? propertyRow.name : propertyId ? 'Propriedade desconhecida' : 'Todas as propriedades';

    const searchStyles = html`
      <style>
        .search-layout {
          display: grid;
          gap: 1.5rem;
        }
        @media (min-width: 1024px) {
          .search-layout {
            grid-template-columns: 320px 1fr;
            align-items: flex-start;
          }
        }
        .search-panel__form {
          display: grid;
          gap: 1rem;
        }
        .search-panel__actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          align-items: center;
        }
        .search-panel .inline-feedback {
          margin-top: 0.5rem;
        }
        .search-results {
          display: grid;
          gap: 1.5rem;
        }
        .search-banner {
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 0.9rem;
          padding: 1.15rem 1.35rem;
          background: #f8fafc;
          display: grid;
          gap: 0.75rem;
        }
        .search-banner__header {
          display: grid;
          gap: 0.35rem;
        }
        .search-banner__title {
          font-size: 1rem;
          font-weight: 600;
          color: #0f172a;
        }
        .search-banner__subtitle {
          font-size: 0.875rem;
          color: #475569;
        }
        .search-banner__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .search-banner__chip {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          background: #ffffff;
          border: 1px solid rgba(148, 163, 184, 0.45);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #1e293b;
        }
        .search-banner__chip i {
          width: 0.95rem;
          height: 0.95rem;
        }
        @media (max-width: 1024px) {
          .search-banner {
            padding: 1rem 1.1rem;
          }
          .search-banner__chips {
            justify-content: flex-start;
            gap: 0.4rem;
          }
          .search-panel__actions {
            justify-content: stretch;
          }
          .search-panel__actions .btn,
          .search-panel__actions .btn-light {
            flex: 1 1 160px;
            justify-content: center;
          }
        }
        @media (max-width: 900px) {
          .search-property__header {
            gap: 0.75rem;
          }
          .search-property__badge {
            width: 100%;
            justify-content: center;
          }
        }
        .search-guidance {
          margin: 0;
          padding-left: 1.25rem;
          display: grid;
          gap: 0.35rem;
          color: #475569;
        }
        .search-property-card {
          display: grid;
          gap: 1.25rem;
        }
        .search-property__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .search-property__summary {
          color: #475569;
          font-size: 0.875rem;
        }
        .search-property__badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: #ecfdf5;
          color: #047857;
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .search-units {
          display: grid;
          gap: 1rem;
        }
        @media (min-width: 768px) {
          .search-units {
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          }
        }
        .search-unit {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 0.9rem;
          padding: 1rem;
          background: #ffffff;
        }
        .search-unit__image {
          border-radius: 0.75rem;
          overflow: hidden;
          height: 180px;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #475569;
          font-size: 0.875rem;
        }
        .search-unit__image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .search-unit__header {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          align-items: baseline;
        }
        .search-unit__property {
          color: #475569;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .search-unit__name {
          font-size: 1rem;
          font-weight: 600;
          color: #0f172a;
        }
        .search-unit__capacity {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1e293b;
          background: #e2e8f0;
          border-radius: 999px;
          padding: 0.25rem 0.75rem;
        }
        .search-unit__features {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .search-unit__feature {
          background: rgba(16, 185, 129, 0.15);
          color: #047857;
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          font-size: 0.75rem;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-weight: 500;
        }
        .search-unit__feature-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .search-unit__price {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .search-unit__price-label {
          font-size: 0.75rem;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
        }
        .search-unit__price-value {
          font-size: 1.5rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .search-unit__price-note {
          font-size: 0.75rem;
          color: #475569;
        }
        .search-unit__cta {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .search-unit__cta-hint {
          font-size: 0.75rem;
          color: #475569;
        }
        .search-property__empty {
          padding: 1rem;
          border-radius: 0.75rem;
          background: #f8fafc;
          color: #475569;
          border: 1px dashed rgba(148, 163, 184, 0.5);
        }
      </style>
    `;

    const summaryBanner = searchActive
      ? html`
          <section class="search-banner">
            <div class="search-banner__header">
              <h2 class="search-banner__title">Filtros aplicados</h2>
              <p class="search-banner__subtitle">Mostramos apenas as unidades disponíveis para estes critérios.</p>
            </div>
            <div class="search-banner__chips">
              <span class="search-banner__chip"><i data-lucide="calendar"></i>${esc(dateSummary)}</span>
              <span class="search-banner__chip"><i data-lucide="users"></i>${esc(guestsSummary)}</span>
              <span class="search-banner__chip"><i data-lucide="map-pin"></i>${esc(propertySummary)}</span>
            </div>
          </section>
        `
      : html`
          <section class="search-banner">
            <div class="search-banner__header">
              <h2 class="search-banner__title">Prepare a pesquisa de reservas</h2>
              <p class="search-banner__subtitle">Selecione datas para ver apenas as unidades disponíveis por propriedade.</p>
            </div>
            <ul class="search-guidance">
              <li>Escolha check-in e check-out válidos para ativar o cálculo automático do valor total.</li>
              <li>Ajuste o número de hóspedes para garantir que a capacidade das unidades é respeitada.</li>
              <li>Use o filtro de propriedade para focar apenas numa localização específica.</li>
            </ul>
          </section>
        `;

    const propertyCards = propertyGroups.length
      ? propertyGroups
          .map(group => {
            const summaryLabel = searchActive
              ? `${group.availableUnits} unidade${group.availableUnits === 1 ? '' : 's'} disponível${group.availableUnits === 1 ? '' : 's'} · ${group.totalUnits} no total`
              : `${group.totalUnits} unidade${group.totalUnits === 1 ? '' : 's'} registada${group.totalUnits === 1 ? '' : 's'}`;
            const unitsHtml = group.units.length
              ? html`
                  <div class="search-units">
                    ${group.units
                      .map(unit => {
                        const featuresHtml = featureChipsHtml(unit.features, {
                          className: 'search-unit__features',
                          badgeClass: 'search-unit__feature',
                          iconWrapClass: 'search-unit__feature-icon'
                        });
                        const imageHtml = unit.image
                          ? html`<div class="search-unit__image"><img src="${esc(unit.image.url)}" alt="${unit.image.safeAlt}" loading="lazy"/></div>`
                          : '<div class="search-unit__image">Sem fotografia disponível</div>';
                        const priceLabel = searchActive
                          ? `${unit.quote.nights} noite${unit.quote.nights === 1 ? '' : 's'}`
                          : 'Tarifa base';
                        const priceNote = searchActive
                          ? `Estadia mínima: ${unit.quote.minStayReq} noite${unit.quote.minStayReq === 1 ? '' : 's'}`
                          : 'Indique datas para ver o total da estadia.';
                        const priceValue = searchActive ? eur(unit.quote.total_cents) : eur(unit.basePriceCents);
                        let actionHtml;
                        if (searchActive) {
                          const bookingLink = `/book/${unit.id}?checkin=${encodeURIComponent(rawCheckin)}&checkout=${encodeURIComponent(rawCheckout)}&adults=${encodeURIComponent(adults)}&children=${encodeURIComponent(children)}`;
                          actionHtml = html`<a class="btn btn-primary" href="${esc(bookingLink)}">Reservar</a>`;
                        } else {
                          actionHtml = '<span class="search-unit__cta-hint">Escolha datas para verificar disponibilidade.</span>';
                        }
                        return html`
                          <article class="search-unit">
                            ${imageHtml}
                            <div class="search-unit__header">
                              <div>
                                <div class="search-unit__property">${group.safeName}</div>
                                <div class="search-unit__name">${unit.safeName}</div>
                              </div>
                              <span class="search-unit__capacity">${unit.capacity} hóspede${unit.capacity === 1 ? '' : 's'}</span>
                            </div>
                            ${featuresHtml}
                            <div class="search-unit__price">
                              <span class="search-unit__price-label">${esc(priceLabel)}</span>
                              <span class="search-unit__price-value"><i data-lucide="euro" class="w-4 h-4"></i>${priceValue}</span>
                              <span class="search-unit__price-note">${esc(priceNote)}</span>
                            </div>
                            <div class="search-unit__cta">
                              ${actionHtml}
                            </div>
                          </article>
                        `;
                      })
                      .join('')}
                  </div>
                `
              : `<div class="search-property__empty">${searchActive ? 'Sem unidades disponíveis para os critérios selecionados.' : 'Sem unidades registadas nesta propriedade.'}</div>`;
            const badge = searchActive
              ? `<span class="search-property__badge">${group.availableUnits ? 'Disponível' : 'Sem disponibilidade'}</span>`
              : '';
            return html`
              <section class="bo-card search-property-card">
                <header class="search-property__header">
                  <div>
                    <h2>${group.safeName}</h2>
                    <p class="search-property__summary">${esc(summaryLabel)}</p>
                  </div>
                  ${badge}
                </header>
                ${unitsHtml}
              </section>
            `;
          })
          .join('')
      : '';

    const emptyState = searchActive && totalVisibleUnits === 0 && !propertyNotFound
      ? '<div class="bo-card"><p class="bo-empty">Não encontrámos unidades disponíveis para os critérios selecionados.</p></div>'
      : '';

    const propertyNotFoundCard = propertyNotFound
      ? '<div class="bo-card"><p class="bo-empty">Propriedade não encontrada. Ajuste o filtro e tente novamente.</p></div>'
      : '';

    const noPropertiesCard = !hasPropertiesConfigured
      ? '<div class="bo-card"><p class="bo-empty">Ainda não existem propriedades configuradas.</p></div>'
      : '';

    const formAction = req.path === '/search' ? '/search' : '/';
    const resetLink = formAction;
    res.send(layout({
      title: 'Pesquisar disponibilidade',
      user,
      activeNav: 'search',
      branding: theme,
      pageClass: 'page-backoffice page-search',
      body: html`
        <div class="bo-main search-main">
          <header class="bo-header">
            <h1>Pesquisar disponibilidade</h1>
          </header>
          ${searchStyles}
          <div class="search-layout">
            <section class="bo-card search-panel">
              <h2>Filtros de reserva</h2>
              <p class="bo-subtitle">Escolha datas, hóspedes e propriedade para consultar as unidades disponíveis.</p>
              <form action="${esc(formAction)}" method="get" class="search-panel__form" data-search-form>
                <div class="bo-field">
                  <label for="checkin">Check-in</label>
                  <input
                    type="date"
                    id="checkin"
                    name="checkin"
                    class="input"
                    value="${esc(rawCheckin)}"
                    onchange="syncCheckout(event)"
                    required
                  />
                </div>
                <div class="bo-field">
                  <label for="checkout">Check-out</label>
                  <input
                    type="date"
                    id="checkout"
                    name="checkout"
                    class="input"
                    value="${esc(rawCheckout)}"
                    ${checkinValid ? `min="${esc(rawCheckin)}"` : ''}
                    required
                  />
                </div>
                <div class="bo-field">
                  <label for="adults">Adultos</label>
                  <input type="number" min="1" id="adults" name="adults" value="${esc(String(adults))}" class="input" />
                </div>
                <div class="bo-field">
                  <label for="children">Crianças</label>
                  <input type="number" min="0" id="children" name="children" value="${esc(String(children))}" class="input" />
                </div>
                <div class="bo-field">
                  <label for="property_id">Propriedade</label>
                  <select id="property_id" name="property_id" class="input">
                    <option value="">Todas as propriedades</option>
                    ${properties
                      .map(p => `<option value="${p.id}" ${propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
                      .join('')}
                  </select>
                </div>
                <div class="search-panel__actions">
                  <button class="btn btn-primary" type="submit" data-submit>Pesquisar disponibilidade</button>
                  ${(searchActive || propertyId || guestFilterExplicit)
                    ? `<a class="btn btn-light" href="${esc(resetLink)}">Limpar filtros</a>`
                    : ''}
                </div>
                <div class="inline-feedback" data-feedback data-variant="info" aria-live="polite" role="status">
                  <span class="inline-feedback-icon">ℹ</span>
                  <div><strong>Indique as datas desejadas.</strong><br/>Apenas as unidades disponíveis serão listadas após a pesquisa.</div>
                </div>
              </form>
            </section>
            <div class="search-results">
              ${summaryBanner}
              ${propertyNotFoundCard}
              ${!propertyNotFound ? propertyCards : ''}
              ${!propertyNotFound ? noPropertiesCard : ''}
              ${emptyState}
            </div>
          </div>
        </div>
      `
    }));
  }

  app.get('/', (req, res) => {
    renderSearchPage(req, res);
  });

  app.get('/search', (req, res) => {
    renderSearchPage(req, res);
  });
app.get('/book/:unitId', (req, res) => {
  const sess = getSession(req.cookies.adm, req);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { unitId } = req.params;
  const { checkin, checkout } = req.query;
  const adults = Math.max(1, Number(req.query.adults ?? 2));
  const children = Math.max(0, Number(req.query.children ?? 0));
  const totalGuests = adults + children;
  const rawPlanId = typeof req.query.rate_plan_id === 'string' ? req.query.rate_plan_id.trim() : '';
  let ratePlanId = null;
  if (rawPlanId) {
    const parsedPlan = Number.parseInt(rawPlanId, 10);
    if (!Number.isInteger(parsedPlan) || parsedPlan <= 0) {
      return res.status(400).send('Plano tarifário inválido.');
    }
    ratePlanId = parsedPlan;
  }

  const u = db
    .prepare('SELECT u.*, p.name as property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?')
    .get(unitId);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (!checkin || !checkout) return res.redirect('/');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);
  if (!unitAvailable(u.id, checkin, checkout)) return res.status(409).send('Este alojamento já não tem disponibilidade.');

  if (ratePlanService) {
    try {
      ratePlanService.assertBookingAllowed({ ratePlanId, checkin, checkout });
    } catch (err) {
      if (err instanceof ConflictError || (err && err.status === 409)) {
        return res.status(409).send(err.message || 'Plano tarifário indisponível.');
      }
      if (err instanceof ValidationError || (err && err.status === 400)) {
        return res.status(400).send(err.message || 'Plano tarifário inválido.');
      }
      throw err;
    }
  }

  const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
  if (quote.nights < quote.minStayReq) return res.status(400).send('Estadia mínima: ' + quote.minStayReq + ' noites');
  const total = quote.total_cents;
  const unitFeaturesBooking = featureChipsHtml(parseFeaturesStored(u.features), {
    className: 'flex flex-wrap gap-2 text-xs text-slate-600 mt-3',
    badgeClass: 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full',
    iconWrapClass: 'inline-flex items-center justify-center text-emerald-700'
  });
  const checkinLabel = dayjs(checkin).isValid() ? dayjs(checkin).format('DD/MM/YYYY') : checkin;
  const checkoutLabel = dayjs(checkout).isValid() ? dayjs(checkout).format('DD/MM/YYYY') : checkout;
  const occupancyLabel = (() => {
    const adultLabel = `${adults} adulto${adults === 1 ? '' : 's'}`;
    if (children > 0) {
      return `${adultLabel} · ${children} criança${children === 1 ? '' : 's'}`;
    }
    return adultLabel;
  })();
  const propertyPolicy = db
    .prepare('SELECT cancellation_policy FROM property_policies WHERE property_id = ?')
    .get(u.property_id);
  const cancellationPolicyText = propertyPolicy && propertyPolicy.cancellation_policy
    ? propertyPolicy.cancellation_policy.trim()
    : 'Cancelamentos gratuitos até 48 horas antes da chegada. Após esse período poderá ser cobrada a primeira noite de estadia.';
  const theme = resolveBrandingForRequest(req, { propertyId: u.property_id, propertyName: u.property_name });
  rememberActiveBrandingProperty(res, u.property_id);

  const csrfToken = csrfProtection.ensureToken(req, res);
  serverRender('route:/book/:unitId');
  res.send(layout({
    title: 'Confirmar Reserva',
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Passo 3 de 3</span>
        <h1 class="text-2xl font-semibold">${u.property_name} – ${u.name}</h1>
        <p class="text-slate-600">Último passo antes de garantir a estadia.</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">3. Confirme e relaxe</li>
        </ul>
      </div>
      <div class="fo-booking-layout grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <form class="card p-6 fo-booking-form space-y-6" method="post" action="/book" data-booking-form>
          <input type="hidden" name="_csrf" value="${csrfToken}" />
          <input type="hidden" name="unit_id" value="${u.id}" />
          <input type="hidden" name="rate_plan_id" value="${ratePlanId ? ratePlanId : ''}" />
          <fieldset class="fo-form-section">
            <legend>Detalhes da estadia</legend>
            <p class="fo-section-helper">Revise as datas, o número de hóspedes e confirme a unidade antes de avançar.</p>
            <div class="grid gap-4 md:grid-cols-2">
              <div class="fo-field" data-field>
                <label for="booking-checkin">Check-in</label>
                <input
                  type="date"
                  id="booking-checkin"
                  name="checkin"
                  class="input"
                  value="${esc(checkin)}"
                  required
                  data-validate="checkin"
                />
                <p class="fo-field-error" data-error-for="checkin"></p>
              </div>
              <div class="fo-field" data-field>
                <label for="booking-checkout">Check-out</label>
                <input
                  type="date"
                  id="booking-checkout"
                  name="checkout"
                  class="input"
                  value="${esc(checkout)}"
                  min="${esc(checkin)}"
                  required
                  data-validate="checkout"
                />
                <p class="fo-field-error" data-error-for="checkout"></p>
              </div>
              <div class="fo-field" data-field>
                <label for="booking-adults">Adultos</label>
                <input
                  type="number"
                  min="1"
                  id="booking-adults"
                  name="adults"
                  class="input"
                  value="${esc(String(adults))}"
                  placeholder="Número de adultos"
                  required
                  data-validate="adults"
                />
                <p class="fo-field-error" data-error-for="adults"></p>
              </div>
              <div class="fo-field" data-field>
                <label for="booking-children">Crianças</label>
                <input
                  type="number"
                  min="0"
                  id="booking-children"
                  name="children"
                  class="input"
                  value="${esc(String(children))}"
                  placeholder="Número de crianças"
                  data-validate="children"
                />
                <p class="fo-field-error" data-error-for="children"></p>
              </div>
              <div class="fo-field fo-field--full" data-field>
                <label for="booking-unit">Unidade seleccionada</label>
                <input
                  type="text"
                  id="booking-unit"
                  class="input"
                  value="${esc(`${u.property_name} – ${u.name}`)}"
                  readonly
                  aria-readonly="true"
                />
              </div>
            </div>
          </fieldset>
          <fieldset class="fo-form-section">
            <legend>Dados pessoais</legend>
            <p class="fo-section-helper">Os contactos são usados para enviar a confirmação e comunicar qualquer alteração.</p>
            <div class="grid gap-4 md:grid-cols-2">
              <div class="fo-field fo-field--full" data-field>
                <label for="booking-guest-name">Nome completo</label>
                <input
                  id="booking-guest-name"
                  name="guest_name"
                  class="input"
                  placeholder="Ex.: Maria Silva"
                  required
                  data-required
                  data-validate="guest_name"
                />
                <p class="fo-field-error" data-error-for="guest_name"></p>
              </div>
              <div class="fo-field" data-field>
                <label for="booking-guest-email">Email</label>
                <input
                  id="booking-guest-email"
                  type="email"
                  name="guest_email"
                  class="input"
                  placeholder="nome@email.com"
                  required
                  data-required
                  data-validate="guest_email"
                />
                <p class="fo-field-error" data-error-for="guest_email"></p>
              </div>
              <div class="fo-field" data-field>
                <label for="booking-guest-phone">Telefone</label>
                <input
                  id="booking-guest-phone"
                  name="guest_phone"
                  class="input"
                  placeholder="Inclua o indicativo do país"
                  required
                  data-required
                  data-validate="guest_phone"
                />
                <p class="fo-field-error" data-error-for="guest_phone"></p>
              </div>
              <div class="fo-field" data-field>
                <label for="booking-guest-nationality">Nacionalidade</label>
                <input
                  id="booking-guest-nationality"
                  name="guest_nationality"
                  class="input"
                  placeholder="Ex.: Portuguesa"
                  required
                  data-required
                  data-validate="guest_nationality"
                />
                <p class="fo-field-error" data-error-for="guest_nationality"></p>
              </div>
              ${user
                ? `
                  <div class="fo-field" data-field>
                    <label for="booking-agency">Agência</label>
                    <input
                      id="booking-agency"
                      name="agency"
                      class="input"
                      placeholder="Ex.: BOOKING"
                      list="agency-options"
                      required
                      data-required
                      data-validate="agency"
                    />
                    <p class="fo-field-error" data-error-for="agency"></p>
                  </div>
                `
                : ''}
            </div>
          </fieldset>
          <fieldset class="fo-form-section">
            <legend>Pagamento</legend>
            <p class="fo-section-helper">Confirme o resumo financeiro e escolha o método preferido.</p>
            <div class="fo-payment-summary">
              <div class="fo-payment-row">
                <span>Entrada</span>
                <strong data-summary-checkin>${esc(checkinLabel)}</strong>
              </div>
              <div class="fo-payment-row">
                <span>Saída</span>
                <strong data-summary-checkout>${esc(checkoutLabel)}</strong>
              </div>
              <div class="fo-payment-row">
                <span>Noites</span>
                <strong data-summary-nights>${esc(String(quote.nights))}</strong>
              </div>
              <div class="fo-payment-row">
                <span>Hóspedes</span>
                <strong data-occupancy-summary>${esc(occupancyLabel)}</strong>
              </div>
              <div class="fo-payment-row fo-payment-total">
                <span>Total estimado</span>
                <strong class="inline-flex items-center gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${esc(eur(total))}</strong>
              </div>
            </div>
            <p class="fo-payment-note">O valor poderá ser ajustado caso altere as datas ou aplique extras. Receberá uma confirmação detalhada por email.</p>
            <div class="fo-field fo-field--full" data-field>
              <label for="booking-payment-method">Método de pagamento preferido</label>
              <select
                id="booking-payment-method"
                name="payment_method"
                class="input"
                required
                data-validate="payment_method"
              >
                <option value="">Selecione uma opção</option>
                <option value="card">Cartão de crédito</option>
                <option value="transfer">Transferência bancária</option>
                <option value="arrival">Pagamento no local</option>
              </select>
              <p class="fo-field-error" data-error-for="payment_method"></p>
            </div>
          </fieldset>
          <div class="inline-feedback" data-booking-feedback data-variant="info" aria-live="polite" role="status">
            <span class="inline-feedback-icon">ℹ</span>
            <div><strong>Preencha os campos obrigatórios.</strong><br/>Os avisos acima indicam qualquer informação em falta.</div>
          </div>
          ${user
            ? `
              <datalist id="agency-options">
                <option value="BOOKING"></option>
                <option value="EXPEDIA"></option>
                <option value="AIRBNB"></option>
                <option value="DIRECT"></option>
              </datalist>
            `
            : ''}
          <button type="submit" class="btn btn-primary btn-lg w-full fo-submit">Confirmar reserva</button>
          <p class="fo-cancellation-note">${esc(cancellationPolicyText).replace(/\n/g, '<br/>')}</p>
        </form>
        <aside class="card p-6 fo-booking-aside space-y-4">
          <div>
            <h2 class="font-semibold text-lg">Resumo da unidade</h2>
            <p class="text-sm text-slate-600">${esc(u.property_name)} · ${esc(u.name)}</p>
          </div>
          <div class="fo-summary-panel">
            <dl>
              <div class="fo-summary-row">
                <dt>Check-in</dt>
                <dd data-summary-checkin-secondary>${esc(checkinLabel)}</dd>
              </div>
              <div class="fo-summary-row">
                <dt>Check-out</dt>
                <dd data-summary-checkout-secondary>${esc(checkoutLabel)}</dd>
              </div>
              <div class="fo-summary-row">
                <dt>Noites</dt>
                <dd data-summary-nights-secondary>${esc(String(quote.nights))}</dd>
              </div>
              <div class="fo-summary-row">
                <dt>Hóspedes</dt>
                <dd data-occupancy-summary-secondary>${esc(occupancyLabel)}</dd>
              </div>
              <div class="fo-summary-row">
                <dt>Estadia mínima</dt>
                <dd>${esc(String(quote.minStayReq))} noite(s)</dd>
              </div>
              <div class="fo-summary-row">
                <dt>Total</dt>
                <dd class="font-semibold">€ ${esc(eur(total))}</dd>
              </div>
            </dl>
          </div>
          <div class="fo-summary-features">
            <h3 class="font-semibold text-base">Incluído na estadia</h3>
            ${unitFeaturesBooking}
          </div>
          <p class="text-sm text-slate-500">Após confirmar a reserva receberá instruções de check-in e poderá acrescentar extras no portal do hóspede.</p>
        </aside>
      </div>
    `
  }));
});

app.post('/book', (req, res) => {
  if (!csrfProtection.validateRequest(req)) {
    csrfProtection.rotateToken(req, res);
    return res.status(403).send('Pedido rejeitado: token CSRF inválido.');
  }
  const sess = getSession(req.cookies.adm, req);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { errors, data } = sanitizeBookingSubmission(req.body, { requireAgency: !!user });
  if (errors.length > 0) {
    return res.status(422).send(errors.join(' '));
  }

  const unitId = Number.parseInt(req.body.unit_id, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return res.status(400).send('Unidade inválida.');
  }

  const { guest_name, guest_email, guest_nationality, guest_phone, checkin, checkout, adults, children, agency } = data;
  const totalGuests = adults + children;
  const agencyValue = agency || 'DIRECT';
  const rawPlanBody =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'rate_plan_id') ? req.body.rate_plan_id : null;
  let ratePlanId = null;
  if (rawPlanBody != null && rawPlanBody !== '') {
    const parsedPlan = Number.parseInt(rawPlanBody, 10);
    if (!Number.isInteger(parsedPlan) || parsedPlan <= 0) {
      return res.status(400).send('Plano tarifário inválido.');
    }
    ratePlanId = parsedPlan;
  }

  const u = db
    .prepare(
      `SELECT u.*, p.name AS property_name, p.id AS property_id
         FROM units u
         JOIN properties p ON p.id = u.property_id
        WHERE u.id = ?`
    )
    .get(unitId);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);

  function ensurePlanAllowed() {
    if (!ratePlanService) return;
    ratePlanService.assertBookingAllowed({ ratePlanId, checkin, checkout });
  }

  try {
    ensurePlanAllowed();
  } catch (err) {
    if (err instanceof ConflictError || (err && err.status === 409)) {
      return res.status(409).send(err.message || 'Plano tarifário indisponível.');
    }
    if (err instanceof ValidationError || (err && err.status === 400)) {
      return res.status(400).send(err.message || 'Plano tarifário inválido.');
    }
    throw err;
  }

  const trx = db.transaction(() => {
    const confirmationToken = guestPortalService
      ? guestPortalService.generateToken({ length: 10 })
      : crypto.randomBytes(16).toString('hex');
    const conflicts = db.prepare(
      `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING') AND NOT (checkout <= ? OR checkin >= ?)
       UNION ALL
       SELECT 1 FROM blocks WHERE unit_id = ? AND NOT (end_date <= ? OR start_date >= ?)`
    ).all(unitId, checkin, checkout, unitId, checkin, checkout);
    if (conflicts.length > 0) throw new Error('conflict');

    ensurePlanAllowed();
    const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
    if (quote.nights < quote.minStayReq) throw new Error('minstay:'+quote.minStayReq);
    const total = quote.total_cents;
    const canAutoConfirm = user && userCan(user, 'bookings.edit');
    const bookingStatus = canAutoConfirm ? 'CONFIRMED' : 'PENDING';

    const stmt = db.prepare(
      `INSERT INTO bookings(unit_id, guest_name, guest_email, guest_nationality, guest_phone, agency, adults, children, checkin, checkout, total_cents, status, external_ref, confirmation_token, rate_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const r = stmt.run(
      unitId,
      guest_name,
      guest_email,
      guest_nationality || null,
      guest_phone || null,
      agencyValue,
      adults,
      children,
      checkin,
      checkout,
      total,
      bookingStatus,
      null,
      confirmationToken,
      ratePlanId || null
    );
    const bookingId = r.lastInsertRowid;
    overbookingGuard.reserveSlot({
      unitId,
      from: checkin,
      to: checkout,
      bookingId,
      actorId: user ? user.id : null
    });
    return { id: bookingId, confirmationToken, status: bookingStatus };
  });

  try {
    const { id, confirmationToken, status: finalStatus } = trx();

    logChange(user ? user.id : null, 'booking', id, 'create', null, {
      unit_id: unitId,
      checkin,
      checkout,
      status: finalStatus
    });

    if (otaDispatcher && typeof otaDispatcher.pushUpdate === 'function') {
      otaDispatcher.pushUpdate({
        unitId,
        type: 'booking.created',
        payload: {
          bookingId: id,
          checkin,
          checkout,
          agency: agencyValue
        }
      });
    }

    const bookingRow = db
      .prepare(
        `SELECT b.*, u.name AS unit_name, u.property_id, p.name AS property_name
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE b.id = ?`
      )
      .get(id);
    if (bookingRow) {
      const branding = resolveBrandingForRequest(req, {
        propertyId: bookingRow.property_id,
        propertyName: bookingRow.property_name
      });
      const templateKey = bookingRow.status === 'CONFIRMED' ? 'booking_confirmed_guest' : 'booking_pending_guest';
      bookingEmailer
        .sendGuestEmail({ booking: bookingRow, templateKey, branding, request: req })
        .catch(err => console.warn('Falha ao enviar email de reserva:', err.message));
    }

    csrfProtection.rotateToken(req, res);
    res.redirect(`/book/confirmation/${id}?token=${encodeURIComponent(confirmationToken)}`);
  } catch (e) {
    csrfProtection.rotateToken(req, res);
    if (e instanceof ConflictError || e.message === 'conflict') {
      return res.status(409).send('Datas indisponíveis. Tente novamente.');
    }
    if (e.message && e.message.startsWith('minstay:')) return res.status(400).send('Estadia mínima: ' + e.message.split(':')[1] + ' noites');
    console.error(e);
    res.status(500).send('Erro ao criar reserva');
  }
});

  app.get('/book/confirmation/:bookingId', (req, res) => {
    const bookingId = Number.parseInt(req.params.bookingId, 10);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(404).send('Reserva não encontrada');
    }

    const requestedToken = normalizeGuestToken(req.query.token);
    const bookingRow = loadGuestBookingRow(bookingId);
    if (!bookingRow) {
      return res.status(404).send('Reserva não encontrada');
    }

    const sess = getSession(req.cookies.adm, req);
    const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;
    const allowWithoutToken = user && userCan(user, 'bookings.edit');
    const storedToken = normalizeGuestToken(bookingRow.confirmation_token);
    if ((!requestedToken || !storedToken || requestedToken !== storedToken) && !allowWithoutToken) {
      return res.status(403).send('Reserva não encontrada');
    }

    const theme = resolveBrandingForRequest(req, {
      propertyId: bookingRow.property_id,
      propertyName: bookingRow.property_name
    });
    rememberActiveBrandingProperty(res, bookingRow.property_id);

    const checkinDate = dayjs(bookingRow.checkin);
    const checkoutDate = dayjs(bookingRow.checkout);
    const checkinLabel = checkinDate.isValid() ? checkinDate.format('DD/MM/YYYY') : bookingRow.checkin;
    const checkoutLabel = checkoutDate.isValid() ? checkoutDate.format('DD/MM/YYYY') : bookingRow.checkout;
    const nightsCount = checkinDate.isValid() && checkoutDate.isValid() && checkoutDate.isAfter(checkinDate)
      ? dateRangeNights(bookingRow.checkin, bookingRow.checkout).length
      : null;
    const adultsValue = Number(bookingRow.adults || 1);
    const childrenValue = Number(bookingRow.children || 0);
    const guestLabel = (() => {
      const adultPart = `${adultsValue} adulto${adultsValue === 1 ? '' : 's'}`;
      if (childrenValue > 0) {
        return `${adultPart} · ${childrenValue} criança${childrenValue === 1 ? '' : 's'}`;
      }
      return adultPart;
    })();
    const totalFormatted = `€ ${eur(Number(bookingRow.total_cents || 0))}`;
    const statusRaw = (bookingRow.status || '').toUpperCase();
    const statusHeadline = statusRaw === 'CONFIRMED'
      ? 'Reserva confirmada!'
      : statusRaw === 'PENDING'
        ? 'Reserva recebida!'
        : 'Atualização da reserva';
    const statusDescription = statusRaw === 'CONFIRMED'
      ? 'Enviámos a confirmação para o email indicado e reservámos a unidade para as datas selecionadas.'
      : statusRaw === 'PENDING'
        ? 'Estamos a validar a disponibilidade final. Receberá uma confirmação por email assim que o pedido for confirmado.'
        : 'Consulte os detalhes abaixo para acompanhar o estado da sua reserva.';
    const cancellationPolicy = bookingRow.cancellation_policy
      ? bookingRow.cancellation_policy.trim()
      : 'Cancelamentos gratuitos até 48 horas antes da chegada. Após esse período poderá ser cobrada a primeira noite de estadia.';
    const cancellationPolicyHtml = esc(cancellationPolicy).replace(/\n/g, '<br/>');
    const tokenForLinks = requestedToken || storedToken;
    const calendarLink = tokenForLinks
      ? `/book/${bookingId}/ical?token=${encodeURIComponent(tokenForLinks)}`
      : null;
    const guestPortalLink = tokenForLinks
      ? `/guest/${bookingId}?token=${encodeURIComponent(tokenForLinks)}`
      : `/guest/${bookingId}`;

    serverRender('route:/book/confirmation/:bookingId');
    res.send(layout({
      title: 'Resumo da reserva',
      user,
      branding: theme,
      activeNav: 'search',
      pageClass: 'page-frontoffice page-booking-confirmation',
      body: html`
        <section class="fo-confirmation">
          <header class="fo-confirmation__header">
            <span class="pill-indicator">Reserva #${esc(String(bookingId))}</span>
            <h1 class="text-2xl font-semibold">${esc(statusHeadline)}</h1>
            <p class="text-slate-600">${esc(statusDescription)}</p>
          </header>
          <div class="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <article class="card p-6 space-y-5">
              <section>
                <h2 class="font-semibold text-lg">Resumo da estadia</h2>
                <dl class="fo-confirmation__summary">
                  <div>
                    <dt>Check-in</dt>
                    <dd>${esc(checkinLabel)}</dd>
                  </div>
                  <div>
                    <dt>Check-out</dt>
                    <dd>${esc(checkoutLabel)}</dd>
                  </div>
                  <div>
                    <dt>Noites</dt>
                    <dd>${nightsCount != null ? esc(String(nightsCount)) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Hóspedes</dt>
                    <dd>${esc(guestLabel)}</dd>
                  </div>
                  <div>
                    <dt>Unidade</dt>
                    <dd>${esc(bookingRow.property_name)} · ${esc(bookingRow.unit_name)}</dd>
                  </div>
                  <div>
                    <dt>Total estimado</dt>
                    <dd class="font-semibold">${esc(totalFormatted)}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h2 class="font-semibold text-lg">Próximos passos</h2>
                <ul class="fo-confirmation__steps">
                  <li>Revise o email de confirmação que enviámos com todos os detalhes da estadia.</li>
                  <li>Guarde o contacto da propriedade para comunicar qualquer alteração ou pedido especial.</li>
                  <li>Adicione a reserva ao seu calendário para receber lembretes automáticos.</li>
                </ul>
              </section>
              <section>
                <h2 class="font-semibold text-lg">Política de cancelamento</h2>
                <p class="text-sm text-slate-600">${cancellationPolicyHtml}</p>
              </section>
              <div class="fo-confirmation__actions">
                ${calendarLink
                  ? `<a class="btn btn-secondary" href="${esc(calendarLink)}" download="reserva-${bookingId}.ics">Adicionar ao calendário</a>`
                  : ''}
                <a class="btn btn-light" href="${esc(guestPortalLink)}">Abrir portal do hóspede</a>
              </div>
            </article>
            <aside class="card p-6 space-y-4 fo-confirmation__aside">
              <div>
                <h2 class="font-semibold text-lg">Contactos úteis</h2>
                <p class="text-sm text-slate-600">Em caso de dúvida, responda ao email de confirmação ou contacte diretamente a equipa da propriedade.</p>
              </div>
              <div>
                <h3 class="font-semibold text-base">Localização</h3>
                <p class="text-sm text-slate-600">
                  ${esc(bookingRow.property_address || 'Morada enviada por email')}
                  ${bookingRow.property_locality ? `<br/>${esc(bookingRow.property_locality)}` : ''}
                  ${bookingRow.property_district ? `<br/>${esc(bookingRow.property_district)}` : ''}
                </p>
              </div>
              <div>
                <h3 class="font-semibold text-base">Estado atual</h3>
                <p class="text-sm text-slate-600">${esc(statusHeadline)}</p>
              </div>
            </aside>
          </div>
        </section>
      `
    }));
  });

  app.get('/book/:bookingId/ical', (req, res) => {
    const bookingId = Number.parseInt(req.params.bookingId, 10);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(404).send('Reserva não encontrada');
    }

    const requestedToken = normalizeGuestToken(req.query.token);
    const bookingRow = loadGuestBookingRow(bookingId);
    if (!bookingRow) {
      return res.status(404).send('Reserva não encontrada');
    }

    const sess = getSession(req.cookies.adm, req);
    const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;
    const allowWithoutToken = user && userCan(user, 'bookings.edit');
    const storedToken = normalizeGuestToken(bookingRow.confirmation_token);
    if ((!requestedToken || !storedToken || requestedToken !== storedToken) && !allowWithoutToken) {
      return res.status(403).send('Reserva não encontrada');
    }

    const checkinDate = dayjs(bookingRow.checkin);
    const checkoutDate = dayjs(bookingRow.checkout);
    if (!checkinDate.isValid() || !checkoutDate.isValid()) {
      return res.status(400).send('Datas inválidas para exportação.');
    }

    const pad = value => String(value).padStart(2, '0');
    const now = new Date();
    const dtStamp =
      now.getUTCFullYear().toString() +
      pad(now.getUTCMonth() + 1) +
      pad(now.getUTCDate()) +
      'T' +
      pad(now.getUTCHours()) +
      pad(now.getUTCMinutes()) +
      pad(now.getUTCSeconds()) +
      'Z';
    const dtStart = checkinDate.format('YYYYMMDD');
    const dtEnd = checkoutDate.format('YYYYMMDD');
    const escapeICS = (value) => {
      return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
    };
    const locationParts = [bookingRow.property_address, bookingRow.property_locality, bookingRow.property_district]
      .map(part => (part ? String(part).trim() : ''))
      .filter(Boolean);
    const location = locationParts.join(', ');
    const statusRaw = (bookingRow.status || '').toUpperCase();
    const statusMap = { CONFIRMED: 'CONFIRMED', PENDING: 'TENTATIVE', CANCELLED: 'CANCELLED' };
    const status = statusMap[statusRaw] || 'CONFIRMED';
    const baseHost = req.get('host');
    const protocol = req.protocol || 'https';
    const tokenForLinks = requestedToken || storedToken;
    const portalUrl = baseHost && tokenForLinks
      ? `${protocol}://${baseHost}/guest/${bookingId}?token=${encodeURIComponent(tokenForLinks)}`
      : '';
    const summary = `${bookingRow.property_name} – ${bookingRow.unit_name}`;
    const statusLabel = statusRaw === 'CONFIRMED'
      ? 'Confirmada'
      : statusRaw === 'PENDING'
        ? 'Pendente'
        : statusRaw === 'CANCELLED'
          ? 'Cancelada'
          : 'Reserva';
    const descriptionLines = [
      `Hóspede: ${bookingRow.guest_name || '—'}`,
      `Estado: ${statusLabel}`,
      `Reserva #${bookingId}`
    ];
    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Gestor de Alojamentos//Frontoffice//PT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:booking-${bookingId}@${escapeICS(baseHost || 'gestor.local')}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeICS(summary)}`,
      `DESCRIPTION:${escapeICS(descriptionLines.join('\n'))}`,
      location ? `LOCATION:${escapeICS(location)}` : null,
      `STATUS:${status}`,
      portalUrl ? `URL:${escapeICS(portalUrl)}` : null,
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reserva-${bookingId}.ics"`);
    res.send(icsLines.join('\r\n') + '\r\n');
  });

  app.get('/guest/:bookingId', (req, res) => {
    const bookingId = Number.parseInt(req.params.bookingId, 10);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(404).send('Reserva não encontrada');
    }

    const requestedToken = normalizeGuestToken(req.query.token);
    const bookingRow = loadGuestBookingRow(bookingId);
    if (!bookingRow) {
      return res.status(404).send('Reserva não encontrada');
    }

    ensureNoIndexHeader(res);

    const storedToken = normalizeGuestToken(bookingRow.confirmation_token);
    if (!storedToken || !requestedToken || storedToken !== requestedToken) {
      if (guestPortalService && requestedToken) {
        guestPortalService.recordEvent({
          bookingId,
          token: requestedToken,
          eventType: 'invalid_token',
          request: req
        });
      }
      return res.status(403).send('Pedido não autorizado');
    }

    const payload = buildGuestPortalPayload(bookingRow);
    if (!payload) {
      return res.status(500).send('Não foi possível carregar a reserva');
    }

    if (guestPortalService) {
      guestPortalService.recordEvent({
        bookingId,
        token: requestedToken,
        eventType: 'page_view',
        request: req
      });
    }

    const theme = resolveBrandingForRequest(req, {
      propertyId: bookingRow.property_id,
      propertyName: bookingRow.property_name
    });
    rememberActiveBrandingProperty(res, bookingRow.property_id);

    const bookingSummary = payload.booking;
    const instructions = payload.instructions || {};
    const paymentSummaryLines = Array.isArray(payload.payments.summaryLines)
      ? payload.payments.summaryLines
      : [];
    const paymentEntries = Array.isArray(payload.payments.entries) ? payload.payments.entries : [];
    const extrasAvailable = Array.isArray(payload.extras.available) ? payload.extras.available : [];
    const extraPurchases = Array.isArray(payload.extras.purchases) ? payload.extras.purchases : [];
    const extrasSummary = payload.extras && payload.extras.summary
      ? {
          totalCents: Number(payload.extras.summary.totalCents) || 0,
          totalFormatted: payload.extras.summary.totalFormatted || `€ ${eur(payload.extras.summary.totalCents || 0)}`,
          refundedCents: Number(payload.extras.summary.refundedCents) || 0,
          refundedFormatted:
            payload.extras.summary.refundedFormatted ||
            (Number(payload.extras.summary.refundedCents) > 0
              ? `€ ${eur(payload.extras.summary.refundedCents)}`
              : null),
          outstandingCents: Number(payload.extras.summary.outstandingCents) || 0,
          outstandingFormatted:
            payload.extras.summary.outstandingFormatted ||
            `€ ${eur(payload.extras.summary.outstandingCents || 0)}`
        }
      : {
          totalCents: 0,
          totalFormatted: '€ 0,00',
          refundedCents: 0,
          refundedFormatted: null,
          outstandingCents: 0,
          outstandingFormatted: '€ 0,00'
        };

    const formatMultiline = (value) => (value ? esc(String(value)).replace(/\n/g, '<br/>') : '');

    const instructionsItems = [];
    if (bookingSummary.propertyAddress) {
      instructionsItems.push(`<li><strong>Morada:</strong> ${esc(bookingSummary.propertyAddress)}</li>`);
    }
    if (instructions.checkinFrom) {
      instructionsItems.push(`<li><strong>Check-in a partir das:</strong> ${esc(instructions.checkinFrom)}</li>`);
    }
    if (instructions.checkoutUntil) {
      instructionsItems.push(`<li><strong>Check-out até às:</strong> ${esc(instructions.checkoutUntil)}</li>`);
    }
    if (instructions.childrenPolicy) {
      instructionsItems.push(`<li><strong>Crianças:</strong> ${esc(instructions.childrenPolicy)}</li>`);
    }
    if (instructions.petsAllowed != null) {
      const petsFee = instructions.petsFee != null && Number.isFinite(Number(instructions.petsFee))
        ? ` (taxa: € ${eur(Math.round(Number(instructions.petsFee) * 100))})`
        : '';
      instructionsItems.push(
        `<li><strong>Animais:</strong> ${instructions.petsAllowed ? 'Permitidos' : 'Não permitidos'}${petsFee}</li>`
      );
    }

    const instructionsNotes = [];
    if (instructions.parkingInfo) {
      instructionsNotes.push(`<p><strong>Estacionamento:</strong> ${formatMultiline(instructions.parkingInfo)}</p>`);
    }
    if (instructions.quietHours) {
      instructionsNotes.push(`<p><strong>Horário de silêncio:</strong> ${formatMultiline(instructions.quietHours)}</p>`);
    }
    if (instructions.paymentMethods) {
      instructionsNotes.push(`<p><strong>Pagamentos:</strong> ${formatMultiline(instructions.paymentMethods)}</p>`);
    }
    if (instructions.cancellationPolicy) {
      instructionsNotes.push(
        `<p><strong>Política de cancelamento:</strong> ${formatMultiline(instructions.cancellationPolicy)}</p>`
      );
    }

    const paymentStatusClass = (tone) => {
      switch (tone) {
        case 'success':
          return 'bg-emerald-100 text-emerald-700';
        case 'warning':
          return 'bg-amber-100 text-amber-700';
        case 'info':
          return 'bg-sky-100 text-sky-700';
        case 'danger':
          return 'bg-rose-100 text-rose-700';
        case 'muted':
        default:
          return 'bg-slate-200 text-slate-700';
      }
    };

    const paymentSummaryHtml = paymentSummaryLines.length
      ? paymentSummaryLines.map(line => `<li>${esc(line)}</li>`).join('')
      : '<li>Sem pagamentos registados.</li>';

    const paymentEntriesHtml = paymentEntries.length
      ? paymentEntries
          .map(entry => {
            const badgeClass = paymentStatusClass(entry.statusTone);
            const created = entry.createdAtLabel ? esc(entry.createdAtLabel) : 'Sem data';
            return `<li class="border border-slate-200 rounded px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <div class="font-medium text-slate-800">${esc(entry.amountFormatted)}</div>
                <div class="text-xs text-slate-500">${created}</div>
              </div>
              <span class="text-xs font-medium px-2 py-1 rounded ${badgeClass}">${esc(entry.statusLabel)}</span>
            </li>`;
          })
          .join('')
      : '<li class="text-sm text-slate-500">Sem movimentos registados.</li>';

    const extrasFormVisible = extrasAvailable.length > 0;

    const extrasAvailableHtml = extrasFormVisible
      ? extrasAvailable
          .map(extra => {
            const descriptionHtml = extra.description
              ? `<p class="text-sm text-slate-600">${esc(extra.description)}</p>`
              : '';
            const pricingRuleHtml = extra.pricingRuleDescription
              ? `<p class="text-xs text-slate-500">${esc(extra.pricingRuleDescription)}</p>`
              : '';
            const availabilityHtml = extra.availabilityDescription
              ? `<p class="text-xs text-slate-500">${esc(extra.availabilityDescription)}</p>`
              : '';
            const priceHtml = extra.priceFormatted
              ? `<div class="text-sm font-semibold text-slate-700">${esc(extra.priceFormatted)}</div>`
              : '';
            const identifier = esc(extra.id || extra.code);
            return `<div class="border border-slate-200 rounded px-3 py-3 space-y-3" data-extra-item data-extra-id="${identifier}">
              <div class="flex items-start justify-between gap-4">
                <div class="space-y-1">
                  <div class="font-medium text-slate-800">${esc(extra.name)}</div>
                  ${descriptionHtml}
                  ${pricingRuleHtml}
                  ${availabilityHtml}
                </div>
                ${priceHtml}
              </div>
              <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                <span>Quantidade</span>
                <input type="number" min="0" value="0" class="input w-24" data-extra-quantity />
              </label>
            </div>`;
          })
          .join('')
      : '';

    const extraPurchasesHtml = extraPurchases.length
      ? extraPurchases
          .map(extra => {
            const created = extra.createdAtLabel ? `<div class="text-xs text-slate-500">${esc(extra.createdAtLabel)}</div>` : '';
            const statusLabel = extra.status && extra.status !== 'confirmed'
              ? `<span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">${esc(extra.status)}</span>`
              : '';
            const refundedHtml = extra.refundedFormatted
              ? `<div class="text-xs text-slate-500">Reembolsado: ${esc(extra.refundedFormatted)}</div>`
              : '';
            return `<li class="border border-slate-200 rounded px-3 py-3">
              <div class="flex items-start justify-between gap-4">
                <div class="space-y-1">
                  <div class="font-medium text-slate-800">${esc(extra.name)}</div>
                  <div class="text-xs text-slate-500">Quantidade: ${esc(String(extra.quantity))}</div>
                  ${created}
                  ${refundedHtml}
                  ${statusLabel}
                </div>
                <div class="text-sm font-semibold text-slate-700">${esc(extra.totalFormatted)}</div>
              </div>
            </li>`;
          })
          .join('')
      : '<p class="text-sm text-slate-600">Ainda não adicionou extras.</p>';

    const extrasSummaryLines = [];
    if (extrasSummary.totalCents > 0) {
      extrasSummaryLines.push(`<li>Total extras: <strong>${esc(extrasSummary.totalFormatted)}</strong></li>`);
    }
    if (extrasSummary.refundedCents > 0) {
      extrasSummaryLines.push(`<li>Reembolsado: ${esc(extrasSummary.refundedFormatted)}</li>`);
    }
    if (extrasSummary.outstandingCents > 0 || extrasSummary.totalCents > 0) {
      extrasSummaryLines.push(`<li>Por cobrar: <strong>${esc(extrasSummary.outstandingFormatted)}</strong></li>`);
    }
    const extrasSummaryHtml = extrasSummaryLines.length
      ? `<ul class="space-y-1 text-sm text-slate-600">${extrasSummaryLines.join('')}</ul>`
      : '<p class="text-sm text-slate-600">Sem extras registados.</p>';

    const inlineState = serializeGuestPortalState({
      bookingId: bookingSummary.id,
      token: requestedToken,
      payload
    });

    res.send(layout({
      title: 'Portal do hóspede',
      branding: theme,
      user: null,
      body: html`
        <div class="max-w-4xl mx-auto space-y-6" data-guest-portal-root data-booking-id="${bookingSummary.id}" data-token="${esc(requestedToken)}">
          <header class="card p-6 space-y-2 bg-white shadow-sm">
            <span class="pill-indicator">${esc(bookingSummary.statusLabel)}</span>
            <h1 class="text-2xl font-semibold text-slate-800">Olá ${esc(bookingSummary.guestName || 'hóspede')}!</h1>
            <p class="text-slate-600 text-sm">Aqui encontra tudo o que precisa para preparar a sua estadia.</p>
          </header>
          <section class="grid gap-6 md:grid-cols-2">
            <article class="card p-6 space-y-4">
              <h2 class="text-xl font-semibold text-slate-800">Reserva</h2>
              <dl class="grid gap-3 text-sm">
                <div>
                  <dt class="text-slate-500">Propriedade</dt>
                  <dd class="font-medium text-slate-800">${esc(bookingSummary.propertyName)} · ${esc(bookingSummary.unitName)}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">Datas</dt>
                  <dd class="font-medium text-slate-800">${esc(bookingSummary.checkinLabel)} &mdash; ${esc(bookingSummary.checkoutLabel)} (${bookingSummary.nights} noite${bookingSummary.nights === 1 ? '' : 's'})</dd>
                </div>
                <div>
                  <dt class="text-slate-500">Hóspedes</dt>
                  <dd class="font-medium text-slate-800">${bookingSummary.adults} adulto${bookingSummary.adults === 1 ? '' : 's'}${bookingSummary.children ? ` · ${bookingSummary.children} criança${bookingSummary.children === 1 ? '' : 's'}` : ''}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">Contacto</dt>
                  <dd class="font-medium text-slate-800">${esc(bookingSummary.guestPhone || '-')}</dd>
                  <dd class="text-sm text-slate-500">${esc(bookingSummary.guestEmail || '')}</dd>
                </div>
                ${bookingSummary.agency ? `<div><dt class="text-slate-500">Agência</dt><dd class="font-medium text-slate-800">${esc(bookingSummary.agency)}</dd></div>` : ''}
                ${bookingSummary.propertyAddress ? `<div><dt class="text-slate-500">Localização</dt><dd class="font-medium text-slate-800">${esc(bookingSummary.propertyAddress)}</dd></div>` : ''}
              </dl>
            </article>
            <article class="card p-6 space-y-4">
              <h2 class="text-xl font-semibold text-slate-800">Pagamentos</h2>
              <div>
                <div class="text-xs text-slate-500 uppercase tracking-wide">Total da reserva</div>
                <div class="text-3xl font-semibold text-slate-800">${esc(payload.payments.totalFormatted)}</div>
                <p class="text-sm text-slate-600">Saldo por liquidar: <span data-guest-outstanding>${esc(payload.payments.outstandingFormatted)}</span></p>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-slate-700">Resumo</h3>
                <ul class="mt-2 space-y-1 text-sm text-slate-600" data-guest-payment-summary>${paymentSummaryHtml}</ul>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-slate-700">Movimentos</h3>
                <ul class="mt-2 space-y-2 text-sm" data-guest-payment-entries>${paymentEntriesHtml}</ul>
              </div>
            </article>
          </section>
          <section class="card p-6 space-y-4">
            <h2 class="text-xl font-semibold text-slate-800">Instruções de estadia</h2>
            <ul class="space-y-2 text-sm text-slate-700">${instructionsItems.join('')}</ul>
            ${instructionsNotes.length ? `<div class="space-y-3 text-sm text-slate-600">${instructionsNotes.join('')}</div>` : ''}
          </section>
          <section class="card p-6 space-y-4">
            <h2 class="text-xl font-semibold text-slate-800">Extras &amp; serviços</h2>
            <div class="grid gap-6 md:grid-cols-2">
              <div class="space-y-3">
                <h3 class="text-sm font-semibold text-slate-700">Catálogo</h3>
                <p class="text-sm text-slate-600" data-extra-empty style="${extrasFormVisible ? 'display:none;' : ''}">Sem extras disponíveis.</p>
                <form data-extra-form class="space-y-3" style="${extrasFormVisible ? '' : 'display:none;'}">
                  <div class="space-y-3" data-guest-extras-available>${extrasAvailableHtml}</div>
                  <button type="submit" class="btn btn-primary w-full md:w-auto" data-extra-submit>Adicionar extras</button>
                  <p class="text-sm text-slate-500" data-extra-feedback role="status"></p>
                </form>
              </div>
              <div class="space-y-3">
                <h3 class="text-sm font-semibold text-slate-700">Reservados</h3>
                <div class="space-y-2 text-sm" data-guest-extra-purchases>${extraPurchasesHtml}</div>
                <div data-guest-extras-summary>${extrasSummaryHtml}</div>
              </div>
            </div>
          </section>
        </div>
        <script>window.__GUEST_PORTAL_DATA__ = ${inlineState};</script>
        <script>
          (function() {
            const root = document.querySelector('[data-guest-portal-root]');
            if (!root) return;
            const bookingId = root.getAttribute('data-booking-id');
            const token = root.getAttribute('data-token');
            const paymentSummaryEl = root.querySelector('[data-guest-payment-summary]');
            const paymentEntriesEl = root.querySelector('[data-guest-payment-entries]');
            const outstandingEl = root.querySelector('[data-guest-outstanding]');
            const extrasAvailableEl = root.querySelector('[data-guest-extras-available]');
            const extraPurchasesEl = root.querySelector('[data-guest-extra-purchases]');
            const extrasSummaryEl = root.querySelector('[data-guest-extras-summary]');
            const extrasEmptyEl = root.querySelector('[data-extra-empty]');
            const form = root.querySelector('[data-extra-form]');
            const feedbackEl = root.querySelector('[data-extra-feedback]');
            const submitBtn = root.querySelector('[data-extra-submit]');

            function escapeHtml(value) {
              return String(value == null ? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            }

            function statusClass(tone) {
              switch (tone) {
                case 'success':
                  return 'bg-emerald-100 text-emerald-700';
                case 'warning':
                  return 'bg-amber-100 text-amber-700';
                case 'info':
                  return 'bg-sky-100 text-sky-700';
                case 'danger':
                  return 'bg-rose-100 text-rose-700';
                case 'muted':
                default:
                  return 'bg-slate-200 text-slate-700';
              }
            }

            function renderPaymentSummary(lines) {
              if (!paymentSummaryEl) return;
              if (!Array.isArray(lines) || !lines.length) {
                paymentSummaryEl.innerHTML = '<li>Sem pagamentos registados.</li>';
                return;
              }
              paymentSummaryEl.innerHTML = lines.map(line => '<li>' + escapeHtml(line) + '</li>').join('');
            }

            function renderPaymentEntries(entries) {
              if (!paymentEntriesEl) return;
              if (!Array.isArray(entries) || !entries.length) {
                paymentEntriesEl.innerHTML = '<li class="text-sm text-slate-500">Sem movimentos registados.</li>';
                return;
              }
              paymentEntriesEl.innerHTML = entries
                .map(entry => {
                  const badge = statusClass(entry.statusTone);
                  const created = entry.createdAtLabel ? escapeHtml(entry.createdAtLabel) : 'Sem data';
                  return (
                    '<li class="border border-slate-200 rounded px-3 py-2 flex items-center justify-between gap-3">' +
                      '<div>' +
                        '<div class="font-medium text-slate-800">' + escapeHtml(entry.amountFormatted) + '</div>' +
                        '<div class="text-xs text-slate-500">' + created + '</div>' +
                      '</div>' +
                      '<span class="text-xs font-medium px-2 py-1 rounded ' + badge + '">' + escapeHtml(entry.statusLabel) + '</span>' +
                    '</li>'
                  );
                })
                .join('');
            }

            function toggleExtrasForm(extras) {
              if (!form) return;
              const hasExtras = Array.isArray(extras) && extras.length > 0;
              form.style.display = hasExtras ? '' : 'none';
              if (extrasEmptyEl) {
                extrasEmptyEl.style.display = hasExtras ? 'none' : '';
              }
            }

            function renderExtrasAvailable(extras) {
              if (!extrasAvailableEl) return;
              if (!Array.isArray(extras) || !extras.length) {
                extrasAvailableEl.innerHTML = '';
                toggleExtrasForm([]);
                return;
              }
              toggleExtrasForm(extras);
              const list = extras
                .map(extra => {
                  const description = extra.description
                    ? '<p class="text-sm text-slate-600">' + escapeHtml(extra.description) + '</p>'
                    : '';
                  const pricing = extra.pricingRuleDescription
                    ? '<p class="text-xs text-slate-500">' + escapeHtml(extra.pricingRuleDescription) + '</p>'
                    : '';
                  const availability = extra.availabilityDescription
                    ? '<p class="text-xs text-slate-500">' + escapeHtml(extra.availabilityDescription) + '</p>'
                    : '';
                  const price = extra.priceFormatted
                    ? '<div class="text-sm font-semibold text-slate-700">' + escapeHtml(extra.priceFormatted) + '</div>'
                    : '';
                  const identifier = escapeHtml(extra.id || extra.code);
                  return (
                    '<div class="border border-slate-200 rounded px-3 py-3 space-y-3" data-extra-item data-extra-id="' + identifier + '">' +
                      '<div class="flex items-start justify-between gap-4">' +
                        '<div class="space-y-1">' +
                          '<div class="font-medium text-slate-800">' + escapeHtml(extra.name) + '</div>' +
                          description +
                          pricing +
                          availability +
                        '</div>' +
                        price +
                      '</div>' +
                      '<label class="flex items-center gap-2 text-sm font-medium text-slate-700">' +
                        '<span>Quantidade</span>' +
                        '<input type="number" min="0" value="0" class="input w-24" data-extra-quantity />' +
                      '</label>' +
                    '</div>'
                  );
                })
                .join('');
              extrasAvailableEl.innerHTML = list;
              extrasAvailableEl.querySelectorAll('[data-extra-quantity]').forEach(input => {
                input.value = '0';
                input.setAttribute('min', '0');
              });
            }

            function renderExtraPurchases(purchases) {
              if (!extraPurchasesEl) return;
              if (!Array.isArray(purchases) || !purchases.length) {
                extraPurchasesEl.innerHTML = '<p class="text-sm text-slate-600">Ainda não adicionou extras.</p>';
                return;
              }
              const list = purchases
                .map(extra => {
                  const created = extra.createdAtLabel
                    ? '<div class="text-xs text-slate-500">' + escapeHtml(extra.createdAtLabel) + '</div>'
                    : '';
                  const refunded = extra.refundedFormatted
                    ? '<div class="text-xs text-slate-500">Reembolsado: ' + escapeHtml(extra.refundedFormatted) + '</div>'
                    : '';
                  const status = extra.status && extra.status !== 'confirmed'
                    ? '<span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">' +
                      escapeHtml(extra.status) +
                      '</span>'
                    : '';
                  return (
                    '<li class="border border-slate-200 rounded px-3 py-3">' +
                      '<div class="flex items-start justify-between gap-4">' +
                        '<div class="space-y-1">' +
                          '<div class="font-medium text-slate-800">' + escapeHtml(extra.name) + '</div>' +
                          '<div class="text-xs text-slate-500">Quantidade: ' + escapeHtml(String(extra.quantity)) + '</div>' +
                          created +
                          refunded +
                          status +
                        '</div>' +
                        '<div class="text-sm font-semibold text-slate-700">' + escapeHtml(extra.totalFormatted) + '</div>' +
                      '</div>' +
                    '</li>'
                  );
                })
                .join('');
              extraPurchasesEl.innerHTML = list;
            }

            function renderExtrasSummary(summary) {
              if (!extrasSummaryEl) return;
              if (!summary) {
                extrasSummaryEl.innerHTML = '<p class="text-sm text-slate-600">Sem extras registados.</p>';
                return;
              }
              const lines = [];
              const total = summary.totalFormatted || summary.totalCents;
              if (summary.totalCents > 0) {
                lines.push('<li>Total extras: <strong>' + escapeHtml(String(total)) + '</strong></li>');
              }
              if (summary.refundedCents > 0) {
                const refunded = summary.refundedFormatted || summary.refundedCents;
                lines.push('<li>Reembolsado: ' + escapeHtml(String(refunded)) + '</li>');
              }
              if ((summary.outstandingCents || 0) > 0 || (summary.totalCents || 0) > 0) {
                const outstanding = summary.outstandingFormatted || summary.outstandingCents;
                lines.push('<li>Por cobrar: <strong>' + escapeHtml(String(outstanding)) + '</strong></li>');
              }
              extrasSummaryEl.innerHTML = lines.length
                ? '<ul class="space-y-1 text-sm text-slate-600">' + lines.join('') + '</ul>'
                : '<p class="text-sm text-slate-600">Sem extras registados.</p>';
            }

            function renderData(data) {
              if (!data) return;
              if (data.payments) {
                renderPaymentSummary(data.payments.summaryLines);
                renderPaymentEntries(data.payments.entries);
                if (outstandingEl) {
                  outstandingEl.textContent = data.payments.outstandingFormatted || '';
                }
              }
              if (data.extras) {
                renderExtrasAvailable(data.extras.available);
                renderExtraPurchases(data.extras.purchases);
                renderExtrasSummary(data.extras.summary);
              } else {
                renderExtrasAvailable([]);
                renderExtraPurchases([]);
                renderExtrasSummary(null);
              }
            }

            function fetchData() {
              if (!bookingId || !token) return;
              const url =
                '/api/guest/booking?bookingId=' +
                encodeURIComponent(bookingId) +
                '&token=' +
                encodeURIComponent(token);
              fetch(url, { headers: { Accept: 'application/json' } })
                .then(res => (res.ok ? res.json() : res.json().catch(() => ({})).then(body => Promise.reject(body))))
                .then(data => {
                  renderData(data);
                })
                .catch(() => {
                  if (feedbackEl) {
                    feedbackEl.textContent = 'Não foi possível atualizar os dados.';
                    feedbackEl.classList.remove('text-emerald-600');
                    feedbackEl.classList.add('text-rose-600');
                  }
                });
            }

            if (form) {
              form.addEventListener('submit', event => {
                event.preventDefault();
                if (!bookingId || !token) return;
                const items = [];
                if (extrasAvailableEl) {
                  extrasAvailableEl.querySelectorAll('[data-extra-item]').forEach(itemEl => {
                    const id = itemEl.getAttribute('data-extra-id');
                    const input = itemEl.querySelector('[data-extra-quantity]');
                    const qtyValue = input ? Number(input.value || '0') : 0;
                    const quantity = Number.isFinite(qtyValue) && qtyValue > 0 ? Math.round(qtyValue) : 0;
                    if (id && quantity > 0) {
                      items.push({ id, quantity });
                    }
                  });
                }

                if (!items.length) {
                  if (feedbackEl) {
                    feedbackEl.textContent = 'Selecione ao menos um extra.';
                    feedbackEl.classList.remove('text-emerald-600');
                    feedbackEl.classList.add('text-rose-600');
                  }
                  return;
                }

                if (feedbackEl) {
                  feedbackEl.textContent = 'A processar...';
                  feedbackEl.classList.remove('text-rose-600');
                  feedbackEl.classList.remove('text-emerald-600');
                }
                if (submitBtn) {
                  submitBtn.setAttribute('disabled', 'disabled');
                }

                fetch('/api/guest/extras/checkout', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                  },
                  body: JSON.stringify({
                    bookingId: Number(bookingId),
                    token,
                    items
                  })
                })
                  .then(res => (res.ok ? res.json() : res.json().catch(() => ({})).then(body => Promise.reject(body))))
                  .then(data => {
                    renderData(data);
                    if (feedbackEl) {
                      feedbackEl.textContent = 'Extras adicionados com sucesso.';
                      feedbackEl.classList.remove('text-rose-600');
                      feedbackEl.classList.add('text-emerald-600');
                    }
                  })
                  .catch(err => {
                    if (feedbackEl) {
                      feedbackEl.textContent = err && err.error ? err.error : 'Não foi possível registar os extras.';
                      feedbackEl.classList.remove('text-emerald-600');
                      feedbackEl.classList.add('text-rose-600');
                    }
                  })
                  .finally(() => {
                    if (submitBtn) {
                      submitBtn.removeAttribute('disabled');
                    }
                  });
              });
            }

            const initial = window.__GUEST_PORTAL_DATA__ && window.__GUEST_PORTAL_DATA__.payload;
            renderData(initial);
            fetchData();
          })();
        </script>
      `
    }));
  });

  app.get('/api/guest/booking', (req, res) => {
    const bookingId = Number.parseInt(req.query.bookingId, 10);
    const requestedToken = normalizeGuestToken(req.query.token);

    if (!Number.isInteger(bookingId) || bookingId <= 0 || !requestedToken) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    const bookingRow = loadGuestBookingRow(bookingId);
    if (!bookingRow) {
      return res.status(404).json({ error: 'Reserva não encontrada.' });
    }

    const storedToken = normalizeGuestToken(bookingRow.confirmation_token);
    if (!storedToken || storedToken !== requestedToken) {
      if (guestPortalService) {
        guestPortalService.recordEvent({
          bookingId,
          token: requestedToken,
          eventType: 'invalid_token',
          request: req
        });
      }
      return res.status(403).json({ error: 'Pedido não autorizado.' });
    }

    const payload = buildGuestPortalPayload(bookingRow);
    if (!payload) {
      return res.status(404).json({ error: 'Reserva não encontrada.' });
    }

    if (guestPortalService) {
      guestPortalService.recordEvent({
        bookingId,
        token: requestedToken,
        eventType: 'fetch_booking',
        request: req
      });
    }

    res.json(payload);
  });

  app.post('/api/guest/extras/checkout', (req, res) => {
    const body = req.body || {};
    const bookingId = Number.parseInt(body.bookingId, 10);
    const requestedToken = normalizeGuestToken(body.token);
    const itemsRaw = Array.isArray(body.items) ? body.items : [];

    if (!Number.isInteger(bookingId) || bookingId <= 0 || !requestedToken) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    const bookingRow = loadGuestBookingRow(bookingId);
    if (!bookingRow) {
      return res.status(404).json({ error: 'Reserva não encontrada.' });
    }

    const storedToken = normalizeGuestToken(bookingRow.confirmation_token);
    if (!storedToken || storedToken !== requestedToken) {
      if (guestPortalService) {
        guestPortalService.recordEvent({
          bookingId,
          token: requestedToken,
          eventType: 'invalid_token',
          request: req
        });
      }
      return res.status(403).json({ error: 'Pedido não autorizado.' });
    }

    const extrasAvailable = parsePolicyExtras(bookingRow.policy_extras);
    if (!extrasAvailable.length) {
      return res.status(400).json({ error: 'Nenhum extra disponível para esta reserva.' });
    }

    const extrasIndex = new Map();
    extrasAvailable.forEach(extra => {
      if (!extra) return;
      extrasIndex.set(extra.id, extra);
      if (extra.code && !extrasIndex.has(extra.code)) {
        extrasIndex.set(extra.code, extra);
      }
    });

    const consolidated = new Map();
    for (const item of itemsRaw) {
      if (!item) continue;
      const idRaw = typeof item.id === 'string' ? item.id.trim() : '';
      const codeRaw = typeof item.code === 'string' ? item.code.trim() : '';
      const key = idRaw || codeRaw;
      const quantityRaw = item.quantity != null ? Number(item.quantity) : 0;
      const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.min(50, Math.round(quantityRaw)) : 0;
      if (!key || quantity <= 0) continue;
      const existing = consolidated.get(key) || 0;
      const newQuantity = Math.min(100, existing + quantity);
      consolidated.set(key, newQuantity);
    }

    if (consolidated.size === 0) {
      return res.status(400).json({ error: 'Selecione ao menos um extra.' });
    }

    const now = dayjs();
    const selections = [];
    for (const [key, quantity] of consolidated.entries()) {
      const extra = extrasIndex.get(key);
      if (!extra) {
        return res.status(400).json({ error: 'Extra inválido.' });
      }
      const eligibility = validateExtraEligibility(extra, bookingRow, now);
      if (!eligibility.ok) {
        const message =
          eligibility.reason === 'schedule'
            ? 'Extra indisponível no horário atual.'
            : eligibility.reason === 'long_stay'
              ? 'Extra disponível apenas para estadias longas.'
              : 'Extra inválido.';
        return res.status(409).json({ error: message });
      }
      const pricing = computeExtraPricing(extra, bookingRow, quantity);
      selections.push({ extra, quantity, pricing });
    }

    try {
      const insertExtras = db.transaction(records => {
        const stmt = db.prepare(
          `INSERT INTO booking_extras(
            booking_id, extra_id, extra_name, pricing_rule, pricing_payload_json,
            quantity, unit_price_cents, total_cents, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`
        );
        for (const record of records) {
          stmt.run(
            bookingId,
            record.extra.id || record.extra.code,
            record.extra.name,
            record.extra.pricingRule || 'standard',
            JSON.stringify(record.pricing.pricingPayload || null),
            record.quantity,
            record.pricing.unitPriceCents,
            record.pricing.totalCents
          );
        }
      });
      insertExtras(selections);
    } catch (err) {
      console.error('Failed to store booking extras', err);
      return res.status(500).json({ error: 'Não foi possível registar os extras.' });
    }

    if (guestPortalService) {
      try {
        guestPortalService.recordEvent({
          bookingId,
          token: requestedToken,
          eventType: 'extras_checkout',
          payload: {
            items: selections.map(selection => ({
              id: selection.extra.id,
              name: selection.extra.name,
              quantity: selection.quantity,
              pricingRule: selection.extra.pricingRule,
              totalCents: selection.pricing.totalCents
            }))
          },
          request: req
        });
      } catch (err) {
        console.warn('Failed to record guest portal event for extras checkout', err);
      }
    }

    const payload = buildGuestPortalPayload(loadGuestBookingRow(bookingId));
    res.json({
      booking: payload ? payload.booking : null,
      payments: payload ? payload.payments : null,
      extras: payload
        ? payload.extras
        : { available: [], purchases: [], summary: { totalCents: 0, refundedCents: 0, outstandingCents: 0 } }
    });
  });

app.get('/booking/:id', (req, res) => {
  const sess = getSession(req.cookies.adm, req);
  const viewer = sess ? buildUserContext(sess) : undefined;
  const user = viewer;
  const requestedToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';

  const b = db.prepare(
    `SELECT b.*, u.name as unit_name, u.property_id, p.name as property_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?`
  ).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  ensureNoIndexHeader(res);

  const viewerCanSeeBooking = viewer && userCan(viewer, 'bookings.view');
  if (requestedToken) {
    if (requestedToken !== b.confirmation_token) {
      return res.status(403).send('Pedido não autorizado');
    }
  } else if (!viewerCanSeeBooking) {
    return res.status(403).send('Pedido não autorizado');
  }

  const theme = resolveBrandingForRequest(req, { propertyId: b.property_id, propertyName: b.property_name });
  rememberActiveBrandingProperty(res, b.property_id);

  const safeGuestName = esc(b.guest_name || '');
  const safeGuestEmail = esc(b.guest_email || '');
  const safeGuestPhone = b.guest_phone ? esc(b.guest_phone) : '-';
  const guestNationalityHtml = b.guest_nationality
    ? `<span class="text-slate-500">(${esc(b.guest_nationality)})</span>`
    : '';
  const agencyHtml = b.agency ? `<div>Agencia: <strong>${esc(b.agency)}</strong></div>` : '';
  const safePropertyName = esc(b.property_name || '');
  const safeUnitName = esc(b.unit_name || '');
  const isPending = b.status === 'PENDING';
  const statusLabel = isPending ? 'Pendente' : 'Confirmada';
  const headerPill = isPending ? 'Pedido enviado' : 'Reserva finalizada';
  const headerTitle = isPending ? 'Reserva pendente' : 'Reserva confirmada';
  const headerDescriptionHtml = isPending
    ? `Vamos rever a sua reserva e enviar a confirmação para <strong>${safeGuestEmail}</strong> em breve.`
    : `Enviámos a confirmação para ${safeGuestEmail}. Obrigado por reservar connosco!`;
  const bookingStepLabel = isPending ? '3. Aguarde confirmação' : '3. Confirme e relaxe';
  const inlineFeedbackHtml = isPending
    ? `<div class="inline-feedback" data-variant="warning" aria-live="polite" role="status">
          <span class="inline-feedback-icon">⏳</span>
          <div><strong>Reserva pendente</strong><br/>A equipa foi notificada e irá validar o pedido antes de confirmar.</div>
        </div>`
    : `<div class="inline-feedback" data-variant="success" aria-live="polite" role="status">
          <span class="inline-feedback-icon">✓</span>
          <div><strong>Reserva garantida!</strong><br/>A unidade ficou bloqueada para si e pode preparar a chegada com tranquilidade.</div>
        </div>`;

  const confirmationLink = requestedToken
    ? `/booking/${b.id}?token=${encodeURIComponent(requestedToken)}`
    : `/booking/${b.id}`;
  const myReservationsShortcut = viewerCanSeeBooking || requestedToken
    ? `<aside class="card p-4 mt-6 bg-slate-50/70 border border-slate-200">
        <h2 class="text-base font-semibold text-slate-800">As minhas reservas</h2>
        <p class="text-sm text-slate-600 mb-2">Guarde este atalho para rever a confirmação sempre que precisar.</p>
        <a class="text-sm text-indigo-600 hover:text-indigo-800 underline" href="${esc(confirmationLink)}">Ver confirmação</a>
      </aside>`
    : '';

  res.send(layout({
    title: headerTitle,
    user,
    activeNav: 'search',
    branding: theme,
    body: html`
      <div class="result-header">
        <span class="pill-indicator">${headerPill}</span>
        <h1 class="text-2xl font-semibold">${headerTitle}</h1>
        <p class="text-slate-600">${headerDescriptionHtml}</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">${bookingStepLabel}</li>
        </ul>
      </div>
      <div class="card p-6 space-y-6">
        ${inlineFeedbackHtml}
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <div class="font-semibold">${safePropertyName} – ${safeUnitName}</div>
            <div>Hóspede: <strong>${safeGuestName}</strong> ${guestNationalityHtml}</div>
            <div>Contacto: <strong>${safeGuestPhone}</strong> &middot; <strong>${safeGuestEmail}</strong></div>
            <div>Ocupação: <strong>${b.adults} adulto(s)${b.children?` + ${b.children} criança(s)`:''}</strong></div>
            ${agencyHtml}
            <div>Check-in: <strong>${dayjs(b.checkin).format('DD/MM/YYYY')}</strong></div>
            <div>Check-out: <strong>${dayjs(b.checkout).format('DD/MM/YYYY')}</strong></div>
            <div>Noites: ${dateRangeNights(b.checkin, b.checkout).length}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Total</div>
            <div class="text-3xl font-semibold">€ ${eur(b.total_cents)}</div>
            <div class="text-xs text-slate-500">Status: ${statusLabel}</div>
          </div>
        </div>
        <div class="mt-2"><a class="btn btn-primary" href="/">Nova pesquisa</a></div>
      </div>
      ${myReservationsShortcut}
    `
  }));
});

// ===================== Export Excel (privado) =====================
app.get('/admin/export', requireLogin, requirePermission('bookings.export'), (req, res) => {
  ensureNoIndexHeader(res);
  const ymDefault = dayjs().format('YYYY-MM');
  const rawYm = typeof req.query.ym === 'string' ? req.query.ym : ymDefault;
  const ymSelected = /^\d{4}-\d{2}$/.test(rawYm) ? rawYm : ymDefault;
  const rawMonths = req.query.months !== undefined ? req.query.months : 1;
  const monthsSelected = sanitizeMonths(rawMonths);
  const linkData = buildSignedExportLink(ymSelected, monthsSelected);
  const downloadUrl = linkData.url;
  const signingError = linkData.error;
  const linkNotice = signingError
    ? `<p class="text-sm text-rose-600 mt-2">${esc(signingError)}</p>`
    : isFlagEnabled('FEATURE_SIGNED_EXPORT_DOWNLOAD')
    ? '<p class="text-xs text-slate-500 mt-2">Link válido durante 60 segundos. Utilize o formulário acima para gerar um novo.</p>'
    : '';
  const generatedAt = linkData.ts
    ? `<p class="text-xs text-slate-400">Assinado às ${dayjs(linkData.ts).format('HH:mm:ss')}.</p>`
    : '';
  const downloadCta = downloadUrl
    ? `<a class="btn btn-primary" data-export-download href="${esc(downloadUrl)}">Descarregar Excel</a>`
    : '<button class="btn btn-primary" type="button" disabled>Configuração indisponível</button>';

  res.send(
    layout({
      title: 'Exportar Mapa (Excel)',
      user: req.user,
      activeNav: 'export',
      branding: resolveBrandingForRequest(req),
      pageClass: 'page-backoffice page-export',
      body: html`
        <div class="bo-page">
          <a class="text-slate-600" href="/calendar">&larr; Voltar ao Mapa</a>
          <h1 class="text-2xl font-semibold mb-4">Exportar Mapa de Reservas (Excel)</h1>
          <form method="get" action="/admin/export" class="card p-4 grid gap-3 max-w-md">
            <div>
              <label class="text-sm">Mês inicial</label>
              <input type="month" name="ym" value="${esc(ymSelected)}" class="input" required />
            </div>
            <div>
              <label class="text-sm">Quantos meses (1–12)</label>
              <input type="number" min="1" max="12" name="months" value="${monthsSelected}" class="input" required />
            </div>
            <button class="btn btn-light" type="submit">Atualizar link</button>
          </form>
          <div class="mt-4 space-y-2">
            ${downloadCta}
            ${linkNotice}
            ${generatedAt}
          </div>
          <p class="text-sm text-slate-500 mt-3">Uma folha por mês. Cada linha = unidade; colunas = dias. Reservas em blocos unidos.</p>
        </div>
      `
    })
  );
});

// Excel estilo Gantt + tabela de detalhes
app.get(
  '/admin/export/download',
  requireLogin,
  requirePermission('bookings.export'),
  logExportAttempt,
  verifyExportSignature,
  exportRateLimiter,
  async (req, res) => {
    ensureNoIndexHeader(res);
    const signedParams = req.exportDownloadParams || {};
    const ym = typeof signedParams.ym === 'string' ? signedParams.ym : String(req.query.ym || '').trim();
    const months = sanitizeMonths(
      typeof signedParams.months === 'number' ? signedParams.months : req.query.months || 1
    );
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).send('Parâmetro ym inválido (YYYY-MM)');
    const start = dayjs(`${ym}-01`);
    if (!start.isValid()) return res.status(400).send('Data inválida.');

  const wb = new ExcelJS.Workbook();

  const units = db.prepare(`
    SELECT u.id, u.name as unit_name, p.name as property_name
      FROM units u
      JOIN properties p ON p.id = u.property_id
     ORDER BY p.name, u.name
  `).all();

  const entriesStmt = db.prepare(`
    SELECT * FROM (
      SELECT 'BOOKING' AS kind, b.id, b.checkin, b.checkout, b.guest_name, b.adults, b.children, b.status
        FROM bookings b
       WHERE b.unit_id = ? AND NOT (b.checkout <= ? OR b.checkin >= ?)
      UNION ALL
      SELECT 'BLOCK' AS kind, bl.id, bl.start_date AS checkin, bl.end_date AS checkout,
             'BLOQUEADO' AS guest_name, NULL AS adults, NULL AS children, 'BLOCK' AS status
        FROM blocks bl
       WHERE bl.unit_id = ? AND NOT (bl.end_date <= ? OR bl.start_date >= ?)
    )
    ORDER BY checkin
  `);

  const bookingsMonthStmt = db.prepare(`
    SELECT b.*, u.name AS unit_name, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE NOT (b.checkout <= ? OR b.checkin >= ?)
     ORDER BY b.checkin, b.guest_name
  `);

  const numberToLetters = idx => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let n = idx;
    let label = '';
    do {
      label = alphabet[n % 26] + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  };

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF93C47D' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
  const weekendFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const bookingFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6AA84F' } };
  const pendingFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
  const blockFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };

  const formatGuestCount = (adults, children) => {
    const parts = [];
    if (typeof adults === 'number') parts.push(`${adults}A`);
    if (typeof children === 'number' && children > 0) parts.push(`${children}C`);
    return parts.join('+');
  };

  const allCaps = str => {
    if (!str) return '';
    return str
      .split(' ')
      .map(word => (word ? word[0].toUpperCase() + word.slice(1) : ''))
      .join(' ');
  };

  for (let i = 0; i < months; i++) {
    const month = start.add(i, 'month');
    const sheetName = month.format('YYYY_MM');
    const ws = wb.addWorksheet(sheetName);
    ws.properties.defaultRowHeight = 22;

    const daysInMonth = month.daysInMonth();
    const monthStartObj = month.startOf('month');
    const monthStart = monthStartObj.format('YYYY-MM-DD');
    const monthEndExcl = monthStartObj.endOf('month').add(1, 'day').format('YYYY-MM-DD');
    const monthLabel = month.format("MMM'YY").replace('.', '');

    const dayNames = [''];
    const dayNumbers = [''];
    const weekendColumns = new Set();
    for (let d = 0; d < daysInMonth; d++) {
      const date = monthStartObj.add(d, 'day');
      const dow = date.day();
      const weekday = date.locale('pt').format('ddd');
      const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      dayNames.push(label);
      dayNumbers.push(date.format('DD'));
      if (dow === 0 || dow === 6) weekendColumns.add(d + 2);
    }

    const dayNameRow = ws.addRow(dayNames);
    const dayNumberRow = ws.addRow(dayNumbers);
    dayNameRow.height = 20;
    dayNumberRow.height = 20;

    ws.mergeCells(dayNameRow.number, 1, dayNumberRow.number, 1);
    const monthCell = ws.getCell(dayNameRow.number, 1);
    monthCell.value = monthLabel;
    monthCell.fill = headerFill;
    monthCell.font = headerFont;
    monthCell.alignment = { vertical: 'middle', horizontal: 'center' };

    [dayNameRow, dayNumberRow].forEach(r => {
      r.eachCell((cell, colNumber) => {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        if (weekendColumns.has(colNumber)) cell.fill = weekendFill;
        cell.font = { bold: r === dayNameRow };
      });
    });

    const MIN_DAY_WIDTH = 6.5;
    const MAX_DAY_WIDTH = 20;
    let maxDayWidth = MIN_DAY_WIDTH;

    ws.getColumn(1).width = 28;
    for (let col = 2; col <= daysInMonth + 1; col++) {
      ws.getColumn(col).width = MIN_DAY_WIDTH;
    }

    const bookingsForMonth = bookingsMonthStmt.all(monthStart, monthEndExcl);

    const bookingIds = bookingsForMonth.map(booking => booking.id);
    let paymentRows = [];
    let refundRows = [];
    if (bookingIds.length) {
      const placeholders = bookingIds.map(() => '?').join(',');
      const paymentsSql = `
        SELECT id, booking_id, status, amount_cents
          FROM payments
         WHERE booking_id IN (${placeholders})
      `;
      paymentRows = db.prepare(paymentsSql).all(...bookingIds);

      const paymentIds = paymentRows.map(payment => payment.id);
      if (paymentIds.length) {
        const refundPlaceholders = paymentIds.map(() => '?').join(',');
        const refundsSql = `
          SELECT id, payment_id, status, amount_cents
            FROM refunds
           WHERE payment_id IN (${refundPlaceholders})
        `;
        refundRows = db.prepare(refundsSql).all(...paymentIds);
      }
    }

    const { bookingSummaries } = aggregatePaymentData({
      payments: paymentRows,
      refunds: refundRows
    });

    const refByBookingId = new Map();
    bookingsForMonth.forEach((booking, idx) => {
      refByBookingId.set(booking.id, numberToLetters(idx));
    });

    for (const u of units) {
      const nameRow = ws.addRow(['', ...Array(daysInMonth).fill('')]);
      const occRow = ws.addRow(['', ...Array(daysInMonth).fill('')]);
      nameRow.height = 20;
      occRow.height = 24;

      ws.mergeCells(nameRow.number, 1, occRow.number, 1);
      const unitCell = ws.getCell(nameRow.number, 1);
      unitCell.value = u.property_name === u.unit_name
        ? allCaps(u.unit_name)
        : `${allCaps(u.property_name)}\n${allCaps(u.unit_name)}`;
      unitCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      unitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
      unitCell.font = { bold: true, color: { argb: 'FF1F2937' } };

      const entries = entriesStmt.all(u.id, monthStart, monthEndExcl, u.id, monthStart, monthEndExcl);

      for (const entry of entries) {
        const startDate = dayjs.max(dayjs(entry.checkin), monthStartObj);
        const endDateExclusive = dayjs.min(dayjs(entry.checkout), dayjs(monthEndExcl));
        const startOffset = startDate.diff(monthStartObj, 'day');
        const endOffset = endDateExclusive.diff(monthStartObj, 'day');
        const startCol = Math.max(2, startOffset + 2);
        const endCol = Math.min(daysInMonth + 1, endOffset + 1);
        if (endCol < startCol) continue;

        ws.mergeCells(nameRow.number, startCol, nameRow.number, endCol);
        ws.mergeCells(occRow.number, startCol, occRow.number, endCol);

        const nameCell = ws.getCell(nameRow.number, startCol);
        const occCell = ws.getCell(occRow.number, startCol);

        const isBooking = entry.kind === 'BOOKING';
        const ref = isBooking ? refByBookingId.get(entry.id) : null;
        const guestCount = isBooking ? formatGuestCount(entry.adults || 0, entry.children || 0) : '';

        nameCell.value = entry.guest_name;
        nameCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        nameCell.font = { bold: true, color: { argb: 'FF111827' } };

        const occLabel = entry.status === 'BLOCK'
          ? 'BLOQUEADO'
          : `${ref ? `(${ref}) ` : ''}${guestCount}`.trim();

        if (entry.status === 'BLOCK') {
          occCell.fill = blockFill;
          occCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        } else {
          const fill = entry.status === 'PENDING' ? pendingFill : bookingFill;
          const fontColor = entry.status === 'PENDING' ? 'FF1F2937' : 'FFFFFFFF';
          occCell.fill = fill;
          occCell.font = { bold: true, color: { argb: fontColor } };
        }
        occCell.value = occLabel;
        occCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

        const span = endCol - startCol + 1;
        const labelChars = Math.max(String(nameCell.value || '').length, occLabel.length);
        const totalTargetWidth = Math.max(10, Math.min(80, labelChars * 1.1));
        const perColumnWidth = Math.max(MIN_DAY_WIDTH, Math.min(MAX_DAY_WIDTH, totalTargetWidth / span));
        maxDayWidth = Math.max(maxDayWidth, perColumnWidth);
      }

      for (const col of weekendColumns) {
        [nameRow, occRow].forEach(row => {
          const cell = row.getCell(col);
          const empty = cell.value === undefined || cell.value === null || String(cell.value).trim() === '';
          if (empty && !cell.isMerged) {
            cell.fill = weekendFill;
          }
        });
      }
    }

    const finalDayWidth = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, maxDayWidth));
    for (let col = 2; col <= daysInMonth + 1; col++) {
      ws.getColumn(col).width = finalDayWidth;
    }

    ws.addRow([]);

    const detailHeaders = [
      'Ref',
      'Nome',
      'Agência',
      'País',
      'Nr Hóspedes',
      'Nr Noites',
      'Data entrada',
      'Data saída',
      'Tlm',
      'Email',
      'Nr Quartos',
      'Hora Check-in',
      'Outras Informações',
      'Valor total a pagar',
      'Pré-pagamento 30%',
      'A pagar no check-out',
      'Fatura',
      'Data Pré-Pagamento',
      'Dados pagamento',
      'Dados faturação'
    ];

    const detailMonthRow = ws.addRow([monthLabel, ...Array(detailHeaders.length - 1).fill('')]);
    ws.mergeCells(detailMonthRow.number, 1, detailMonthRow.number, detailHeaders.length);
    const detailMonthCell = ws.getCell(detailMonthRow.number, 1);
    detailMonthCell.value = monthLabel;
    detailMonthCell.fill = headerFill;
    detailMonthCell.font = headerFont;
    detailMonthCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const headerRow = ws.addRow(detailHeaders);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 24;

    const currencyColumns = new Set([14, 15, 16]);
    const defaultDetailWidths = [6, 24, 14, 8, 12, 10, 12, 12, 14, 30, 10, 12, 24, 16, 16, 16, 10, 16, 22, 22];
    defaultDetailWidths.forEach((w, idx) => {
      const colIndex = idx + 1;
      const currentWidth = ws.getColumn(colIndex).width || 10;
      ws.getColumn(colIndex).width = Math.max(currentWidth, w);
    });

    bookingsForMonth.forEach((booking, idx) => {
      const ref = refByBookingId.get(booking.id) || numberToLetters(idx);
      const totalCents = booking.total_cents;
      const prepaymentCents = Math.round(totalCents * 0.3);
      const checkoutCents = totalCents - prepaymentCents;
      const nights = dayjs(booking.checkout).diff(dayjs(booking.checkin), 'day');
      const guestCount = (booking.adults || 0) + (booking.children || 0);

      const detailRow = ws.addRow([
        ref,
        booking.guest_name,
        booking.agency || '',
        booking.guest_nationality || '',
        guestCount,
        nights,
        dayjs(booking.checkin).format('DD/MMM'),
        dayjs(booking.checkout).format('DD/MMM'),
        booking.guest_phone || '',
        booking.guest_email || '',
        1,
        '',
        booking.status === 'PENDING' ? 'PENDENTE' : '',
        totalCents / 100,
        prepaymentCents / 100,
        checkoutCents / 100,
        '',
        '',
        '',
        ''
      ]);

      const paymentSummary = bookingSummaries.get(booking.id) || null;
      const paymentLines = summarizePaymentDetailsForBooking(booking, paymentSummary);
      const paymentCell = detailRow.getCell(19);
      paymentCell.value = paymentLines.join('\n');

      detailRow.eachCell((cell, colNumber) => {
        if (currencyColumns.has(colNumber)) {
          cell.numFmt = '#,##0.00';
          cell.font = { color: { argb: 'FF1F2937' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if ([5, 6, 11].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        }
      });
    });

    ws.eachRow(r => {
      r.eachCell(c => {
        c.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
      });
    });
  }

    const filename =
      months === 1
        ? `mapa_${start.format('YYYY_MM')}.xlsx`
        : `mapa_${start.format('YYYY_MM')}_+${months - 1}m.xlsx`;

    logExportActivity(req.user, 'export:download_success', { ym, months });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  }
);

};
