const MONTHS = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outono: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

function normalizeText(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function extractGuests(text) {
  const guestsMatch = text.match(/(\d+)\s*(adultos|pessoas|hospedes|huospedes|adulto|pessoa)/i);
  if (guestsMatch) {
    return Math.max(1, parseInt(guestsMatch[1], 10));
  }
  const familyMatch = text.match(/familia\s*de\s*(\d+)/i);
  if (familyMatch) return Math.max(1, parseInt(familyMatch[1], 10));
  return null;
}

function parseDatePart(dayjs, raw) {
  if (!raw) return null;
  const normalized = normalizeText(raw);
  const direct = dayjs(raw, ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY'], true);
  if (direct.isValid()) return direct;
  const short = dayjs(raw, ['DD/MM', 'DD-MM'], true);
  if (short.isValid()) {
    const candidate = short.year(dayjs().year());
    if (candidate.isBefore(dayjs(), 'day')) {
      return candidate.add(1, 'year');
    }
    return candidate;
  }
  const match = normalized.match(/(\d{1,2})\s*(de\s*)?([a-z]+)/);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthName = match[3];
    const month = MONTHS[monthName];
    if (month != null) {
      let candidate = dayjs().month(month).date(day);
      if (candidate.isBefore(dayjs(), 'day')) {
        candidate = candidate.add(1, 'year');
      }
      return candidate;
    }
  }
  return null;
}

function extractDates(dayjs, text) {
  const isoPattern = /(\d{4}-\d{2}-\d{2})/g;
  const isoMatches = Array.from(text.matchAll(isoPattern)).map(m => m[1]);
  if (isoMatches.length >= 2) {
    const [startRaw, endRaw] = isoMatches;
    const checkin = dayjs(startRaw, 'YYYY-MM-DD', true);
    const checkout = dayjs(endRaw, 'YYYY-MM-DD', true);
    if (checkin.isValid() && checkout.isValid() && checkout.isAfter(checkin)) {
      return { checkin, checkout };
    }
  }

  const naturalPattern = /(\d{1,2}\s*(?:de\s*)?[A-Za-z]+)(?:\s*a\s*|\s*ate\s*|\s*até\s*)(\d{1,2}\s*(?:de\s*)?[A-Za-z]+)/i;
  const naturalMatch = text.match(naturalPattern);
  if (naturalMatch) {
    const checkin = parseDatePart(dayjs, naturalMatch[1]);
    const checkout = parseDatePart(dayjs, naturalMatch[2]);
    if (checkin && checkout && checkout.isAfter(checkin)) {
      return { checkin, checkout };
    }
  }

  const rangeMatch = text.match(/(\d{1,2})\s*(?:a|ao|ate|até)\s*(\d{1,2})\s*(de\s*[A-Za-z]+)/i);
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10);
    const endDay = parseInt(rangeMatch[2], 10);
    const monthPart = rangeMatch[3];
    const monthDate = parseDatePart(dayjs, `${startDay} ${monthPart}`);
    const checkoutDate = parseDatePart(dayjs, `${endDay} ${monthPart}`);
    if (monthDate && checkoutDate && checkoutDate.isAfter(monthDate)) {
      return { checkin: monthDate, checkout: checkoutDate };
    }
  }

  return { checkin: null, checkout: null };
}

function detectIntent(text) {
  const normalized = normalizeText(text);
  if (/preco|preço|quanto|disponibil/i.test(normalized)) {
    return 'availability';
  }
  if (/promocao|promo|codigo/i.test(normalized)) {
    return 'promo';
  }
  if (/check-in|check in|checkin|politica|politica/i.test(normalized)) {
    return 'policy';
  }
  if (/reservar|quero reservar|confirmar/i.test(normalized)) {
    return 'book';
  }
  if (/animal|cao|cachorro|pet|gato/i.test(normalized)) {
    return 'amenities';
  }
  return 'smalltalk';
}

function parseMessage(dayjs, text) {
  const intent = detectIntent(text);
  const guests = extractGuests(text);
  const dates = extractDates(dayjs, text);
  return {
    intent,
    guests,
    checkin: dates.checkin,
    checkout: dates.checkout,
  };
}

module.exports = { parseMessage };
