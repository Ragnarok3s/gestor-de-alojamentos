function sanitizeUrlSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9-_]/g, '');
}

function buildBookingLink({ booking, request, fallbackBase }) {
  const token = booking.confirmation_token ? `?token=${sanitizeUrlSegment(booking.confirmation_token)}` : '';

  if (request && typeof request.get === 'function') {
    const host = request.get('host');
    const protocol = request.protocol || 'https';
    if (host) {
      return `${protocol}://${host.replace(/\/$/, '')}/booking/${booking.id}${token}`;
    }
  }

  if (fallbackBase) {
    const base = fallbackBase.replace(/\/$/, '');
    return `${base}/booking/${booking.id}${token}`;
  }

  return `/booking/${booking.id}${token}`;
}

function createBookingEmailer({ emailTemplates, mailer, dayjs, eur }) {
  if (!emailTemplates || !mailer) {
    throw new Error('createBookingEmailer requer serviços de templates e mailer.');
  }

  async function sendGuestEmail({ booking, templateKey, branding, request, extraVariables = {}, from } = {}) {
    if (!booking || !booking.guest_email) return false;
    const template = emailTemplates.renderTemplate(templateKey, {});
    if (!template) return false;

    const nights = dayjs && booking.checkin && booking.checkout
      ? Math.max(1, dayjs(booking.checkout).diff(dayjs(booking.checkin), 'day'))
      : '';
    const checkin = dayjs && booking.checkin ? dayjs(booking.checkin).format('DD/MM/YYYY') : booking.checkin || '';
    const checkout = dayjs && booking.checkout ? dayjs(booking.checkout).format('DD/MM/YYYY') : booking.checkout || '';
    const totalAmount = typeof eur === 'function' ? eur(booking.total_cents || 0) : booking.total_cents;
    const statusLabel = booking.status === 'CONFIRMED' ? 'Confirmada' : 'Pendente';
    const brandName = branding && branding.brandName ? branding.brandName : 'Equipa de Reservas';

    const bookingLink = buildBookingLink({
      booking,
      request,
      fallbackBase: process.env.PUBLIC_BASE_URL
    });

    const variables = {
      guest_name: booking.guest_name || '',
      property_name: booking.property_name || '',
      unit_name: booking.unit_name || '',
      checkin,
      checkout,
      nights,
      total_amount: totalAmount,
      status_label: statusLabel,
      booking_reference: booking.id,
      booking_link: bookingLink,
      brand_name: brandName,
      today: dayjs ? dayjs().format('DD/MM/YYYY') : '',
      ...extraVariables
    };

    const compiled = emailTemplates.renderTemplate(templateKey, variables);
    if (!compiled) return false;

    const body = compiled.body || '';
    const htmlBody = body.replace(/\r?\n/g, '<br/>');

    try {
      await mailer.sendMail({
        to: booking.guest_email,
        subject: compiled.subject,
        html: htmlBody,
        text: body,
        from: from || mailer.getDefaultFrom()
      });
      return true;
    } catch (err) {
      if (console && typeof console.warn === 'function') {
        console.warn('Falha ao enviar email de reserva:', err.message);
      }
      return false;
    }
  }

  return {
    sendGuestEmail
  };
}

module.exports = { createBookingEmailer };
