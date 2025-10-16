const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

const CHANNEL_DEFINITIONS = [
  {
    key: 'booking_com',
    name: 'Booking.com',
    defaultAgency: 'BOOKING.COM',
    supportsAuto: true,
    supportsManual: true,
    autoFormats: ['ics', 'csv'],
    manualFormats: ['csv', 'xlsx', 'ics'],
    description:
      'Importa reservas da extranet da Booking.com através de ficheiros CSV ou da ligação iCal fornecida pelo canal.'
  },
  {
    key: 'airbnb',
    name: 'Airbnb',
    defaultAgency: 'AIRBNB',
    supportsAuto: true,
    supportsManual: true,
    autoFormats: ['ics'],
    manualFormats: ['ics'],
    description:
      'Sincroniza automaticamente calendários iCal ou processa exportações manuais de reservas provenientes do Airbnb.'
  },
  {
    key: 'booking',
    name: 'Booking.com (tempo real)',
    defaultAgency: 'BOOKING',
    supportsAuto: true,
    supportsManual: false,
    autoFormats: [],
    manualFormats: [],
    description:
      'Canal em tempo real que utiliza a API do Booking.com para atualizar tarifas, disponibilidades e receber reservas instantaneamente.'
  },
  {
    key: 'expedia',
    name: 'Expedia',
    defaultAgency: 'EXPEDIA',
    supportsAuto: true,
    supportsManual: false,
    autoFormats: [],
    manualFormats: [],
    description:
      'Integração direta com a Expedia Partner Central para sincronização de inventário e receção de reservas em tempo real.'
  },
  {
    key: 'i_escape',
    name: 'i-escape',
    defaultAgency: 'I-ESCAPE',
    supportsAuto: true,
    supportsManual: true,
    autoFormats: ['csv'],
    manualFormats: ['csv', 'xlsx'],
    description:
      'Recebe reservas exportadas da plataforma i-escape no formato CSV ou XLSX e permite agendar sincronizações automáticas.'
  },
  {
    key: 'splendia',
    name: 'Splendia',
    defaultAgency: 'SPLENDIA',
    supportsAuto: true,
    supportsManual: true,
    autoFormats: ['csv'],
    manualFormats: ['csv', 'xlsx'],
    description:
      'Processa reservas provenientes da Splendia tanto por ficheiro manual como por uma ligação de sincronização automática.'
  }
];

function safeJsonParse(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (err) {
    return fallback;
  }
}

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeWhitespace(value) {
  return normalizeString(value).replace(/\s+/g, ' ').trim();
}

function detectDelimiter(sample) {
  if (!sample) return ',';
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = (sample.match(new RegExp(candidate, 'g')) || []).length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function parseDelimited(content, delimiter) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;
  const pushCell = () => {
    row.push(current);
    current = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      pushCell();
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && content[i + 1] === '\n') {
        i += 1;
      }
      pushCell();
      pushRow();
      continue;
    }
    current += char;
  }
  pushCell();
  pushRow();
  return rows
    .map(r => r.map(value => normalizeString(value)))
    .filter(r => !(r.length === 1 && r[0] === ''));
}

function buildObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => normalizeWhitespace(h));
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(cell => !cell)) continue;
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] != null ? row[index] : '';
    });
    objects.push(obj);
  }
  return objects;
}

function parseCurrencyValue(input, fallbackCurrency = 'EUR') {
  const raw = normalizeString(input);
  if (!raw) {
    return { cents: 0, currency: fallbackCurrency };
  }
  const currencyMatch = raw.match(/[A-Za-z]{3}/);
  const currency = currencyMatch ? currencyMatch[0].toUpperCase() : fallbackCurrency;
  const numericPart = raw
    .replace(/[^0-9,.-]/g, '')
    .replace(/,(?=[0-9]{3}\b)/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const amount = Number.parseFloat(numericPart);
  if (!Number.isFinite(amount)) {
    return { cents: 0, currency };
  }
  return { cents: Math.round(amount * 100), currency };
}

function parseInteger(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const num = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeDate(dayjs, value) {
  if (!value) return null;
  if (value instanceof Date) {
    return dayjs(value).format('YYYY-MM-DD');
  }
  const str = normalizeString(value);
  if (!str) return null;
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const compact = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  const european = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (european) {
    const day = european[1].padStart(2, '0');
    const month = european[2].padStart(2, '0');
    let year = european[3];
    if (year.length === 2) {
      year = Number(year) > 70 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  const parsed = dayjs(str, ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD', 'MM/DD/YYYY', 'DD MMM YYYY'], true);
  if (parsed.isValid()) {
    return parsed.format('YYYY-MM-DD');
  }
  const fallback = dayjs(str);
  return fallback.isValid() ? fallback.format('YYYY-MM-DD') : null;
}

function decodeIcsText(value) {
  return normalizeString(value)
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseIcs(content) {
  const lines = normalizeString(content)
    .replace(/\r\n/g, '\n')
    .split('\n');
  const unfolded = [];
  for (const line of lines) {
    if (!line) continue;
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  const events = [];
  let current = null;
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const splitIndex = line.indexOf(':');
    if (splitIndex === -1) continue;
    const keyPart = line.slice(0, splitIndex).toUpperCase();
    const valuePart = line.slice(splitIndex + 1);
    const [key, ...paramParts] = keyPart.split(';');
    current[key] = {
      value: decodeIcsText(valuePart),
      params: paramParts
    };
  }
  return events;
}

function pickField(object, synonyms, slugify) {
  if (!object) return '';
  const entries = Object.entries(object);
  const normalizedMap = new Map();
  for (const [key, value] of entries) {
    const slug = slugify ? slugify(key) : key.toLowerCase();
    normalizedMap.set(slug, value);
  }
  for (const candidate of synonyms) {
    const slug = slugify ? slugify(candidate) : candidate.toLowerCase();
    if (normalizedMap.has(slug)) {
      return normalizedMap.get(slug);
    }
  }
  return '';
}

function extractKeyedValuesFromDescription(text, slugify) {
  const map = new Map();
  if (!text) return map;
  const lines = decodeIcsText(text).split(/\n+/);
  for (const rawLine of lines) {
    const line = normalizeString(rawLine);
    if (!line) continue;
    const sepIndex = line.indexOf(':');
    if (sepIndex === -1) continue;
    const key = line.slice(0, sepIndex).trim();
    const value = line.slice(sepIndex + 1).trim();
    if (!key) continue;
    const slug = slugify ? slugify(key) : key.toLowerCase();
    if (!map.has(slug)) {
      map.set(slug, value);
    }
  }
  return map;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function ensureDefaults(db) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS channel_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_key TEXT UNIQUE NOT NULL,
      channel_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT,
      credentials_json TEXT,
      last_synced_at TEXT,
      last_status TEXT,
      last_error TEXT,
      last_summary_json TEXT,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS channel_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_key TEXT NOT NULL,
      source TEXT NOT NULL,
      file_name TEXT,
      original_name TEXT,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'processed',
      summary_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`
  ).run();
  const existing = new Set(
    db
      .prepare('SELECT channel_key FROM channel_integrations')
      .all()
      .map(row => row.channel_key)
  );
  const insert = db.prepare(
    `INSERT INTO channel_integrations(channel_key, channel_name, is_active, settings_json, credentials_json)
       VALUES (?, ?, ?, ?, ?)`
  );
  for (const channel of CHANNEL_DEFINITIONS) {
    if (!existing.has(channel.key)) {
      insert.run(channel.key, channel.name, 0, JSON.stringify({}), JSON.stringify({}));
    }
  }
}

function fetchRemote(url, auth) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return reject(err);
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const headers = {};
    if (auth && auth.username) {
      const token = Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    const request = lib.get(parsed, { headers, timeout: 12000 }, response => {
      if (response.statusCode && response.statusCode >= 400) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode} ao sincronizar canal`));
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        resolve({ buffer: Buffer.concat(chunks), contentType: response.headers['content-type'] || '' });
      });
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Timeout na ligação ao canal'));
    });
  });
}

function truncatePayload(payload, maxLength = 4000) {
  if (!payload) return null;
  if (payload.length <= maxLength) return payload;
  return payload.slice(0, maxLength) + '…';
}

function buildKeyVariants(key) {
  const base = String(key);
  const variants = new Set([base]);
  const snake = base
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  variants.add(snake);
  const camel = snake.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  variants.add(camel);
  if (camel) {
    variants.add(camel.charAt(0).toUpperCase() + camel.slice(1));
  }
  variants.add(base.toLowerCase());
  return Array.from(variants);
}

function resolvePath(source, path) {
  if (!isPlainObject(source)) return undefined;
  const segments = Array.isArray(path) ? path : String(path).split('.');
  let current = source;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isInteger(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      return undefined;
    }
    const keys = buildKeyVariants(segment);
    let next = undefined;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        next = current[key];
        break;
      }
    }
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }
  return current;
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function pickValue(source, candidates) {
  for (const candidate of candidates) {
    const value = resolvePath(source, candidate);
    if (hasMeaningfulValue(value)) {
      return value;
    }
  }
  return undefined;
}

function coerceCurrencyValue(value, fallbackCurrency = 'EUR') {
  if (value == null || value === '') {
    return { cents: null, currency: fallbackCurrency };
  }
  if (isPlainObject(value)) {
    const nestedCurrency = pickValue(value, [['currency'], ['code'], ['iso']]);
    const nestedValue = pickValue(value, [['amount'], ['total'], ['gross'], ['net'], ['value'], ['price']]);
    const currency = hasMeaningfulValue(nestedCurrency) ? String(nestedCurrency) : fallbackCurrency;
    if (hasMeaningfulValue(nestedValue)) {
      return coerceCurrencyValue(nestedValue, currency || fallbackCurrency);
    }
    return { cents: null, currency: currency || fallbackCurrency };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Math.abs(value) >= 1000) {
      return { cents: value, currency: fallbackCurrency };
    }
    return { cents: Math.round(value * 100), currency: fallbackCurrency };
  }
  const parsed = parseCurrencyValue(String(value), fallbackCurrency);
  return parsed;
}

const webhookFieldSynonyms = {
  property: [
    ['propertyName'],
    ['property'],
    ['property', 'name'],
    ['property', 'title'],
    ['hotel'],
    ['hotel', 'name'],
    ['listing', 'property'],
    ['listing', 'name'],
    ['accommodation', 'property'],
    ['accommodation', 'name'],
    ['stay', 'property'],
    ['unit', 'propertyName'],
    ['room', 'propertyName']
  ],
  unit: [
    ['unitName'],
    ['unit'],
    ['unit', 'name'],
    ['room'],
    ['room', 'name'],
    ['listing', 'unit'],
    ['listing', 'name'],
    ['accommodation'],
    ['accommodation', 'name'],
    ['rental'],
    ['rental', 'name'],
    ['inventory', 'name']
  ],
  checkin: [
    ['checkin'],
    ['checkIn'],
    ['arrival'],
    ['arrivalDate'],
    ['arrival_date'],
    ['startDate'],
    ['start_date'],
    ['from'],
    ['start'],
    ['stay', 'checkin'],
    ['stay', 'checkIn'],
    ['stay', 'from'],
    ['stay', 'start'],
    ['stay', 'arrival'],
    ['dates', 'checkin'],
    ['dates', 'from'],
    ['dates', 'start']
  ],
  checkout: [
    ['checkout'],
    ['checkOut'],
    ['departure'],
    ['departureDate'],
    ['departure_date'],
    ['endDate'],
    ['end_date'],
    ['to'],
    ['end'],
    ['stay', 'checkout'],
    ['stay', 'checkOut'],
    ['stay', 'to'],
    ['stay', 'end'],
    ['stay', 'departure'],
    ['dates', 'checkout'],
    ['dates', 'to'],
    ['dates', 'end']
  ],
  guestName: [
    ['guestName'],
    ['guest', 'name'],
    ['guest', 'fullName'],
    ['leadGuest', 'name'],
    ['lead_guest', 'name'],
    ['customer', 'name'],
    ['traveller', 'name'],
    ['contact', 'name'],
    ['primaryGuest', 'name'],
    ['primary_guest', 'name']
  ],
  guestEmail: [
    ['guestEmail'],
    ['guest', 'email'],
    ['leadGuest', 'email'],
    ['customer', 'email'],
    ['contact', 'email'],
    ['primaryGuest', 'email']
  ],
  guestPhone: [
    ['guestPhone'],
    ['guest', 'phone'],
    ['guest', 'telephone'],
    ['guest', 'mobile'],
    ['leadGuest', 'phone'],
    ['customer', 'phone'],
    ['customer', 'telephone'],
    ['contact', 'phone'],
    ['contact', 'telephone'],
    ['primaryGuest', 'phone']
  ],
  adults: [
    ['adults'],
    ['guests', 'adults'],
    ['pax', 'adults'],
    ['occupancy', 'adults'],
    ['party', 'adults'],
    ['counts', 'adults'],
    ['guestCounts', 'adults'],
    ['stay', 'guests', 'adults']
  ],
  children: [
    ['children'],
    ['guests', 'children'],
    ['pax', 'children'],
    ['occupancy', 'children'],
    ['party', 'children'],
    ['counts', 'children'],
    ['guestCounts', 'children'],
    ['stay', 'guests', 'children']
  ],
  total: [
    ['totalCents'],
    ['total'],
    ['total_amount'],
    ['totalGross'],
    ['totalGrossCents'],
    ['pricing', 'total'],
    ['pricing', 'gross'],
    ['price', 'total'],
    ['price', 'gross'],
    ['amount', 'total'],
    ['amount', 'gross'],
    ['financial', 'total'],
    ['financial', 'gross'],
    ['payout', 'amount'],
    ['summary', 'total'],
    ['totals', 'gross']
  ],
  currency: [
    ['currency'],
    ['pricing', 'currency'],
    ['price', 'currency'],
    ['amount', 'currency'],
    ['financial', 'currency'],
    ['payout', 'currency'],
    ['totals', 'currency']
  ],
  reference: [
    ['externalRef'],
    ['externalReference'],
    ['reference'],
    ['bookingReference'],
    ['reservationCode'],
    ['reservationId'],
    ['id'],
    ['code'],
    ['confirmationNumber'],
    ['confirmation', 'number'],
    ['otaReference'],
    ['locator']
  ],
  status: [
    ['status'],
    ['state'],
    ['reservationStatus'],
    ['bookingStatus'],
    ['event'],
    ['type']
  ],
  notes: [
    ['notes'],
    ['note'],
    ['comments'],
    ['comment'],
    ['observations'],
    ['obs'],
    ['message'],
    ['specialRequests'],
    ['special_requests'],
    ['guest', 'message']
  ]
};

function normalizeRecord(record, channelKey, definition, dayjs) {
  const checkin = normalizeDate(dayjs, record.checkin || record.arrival || record.start_date);
  const checkout = normalizeDate(dayjs, record.checkout || record.departure || record.end_date);
  return {
    raw: record,
    channelKey,
    externalRef: normalizeString(record.externalRef || record.reference || record.booking_reference),
    guestName: normalizeWhitespace(record.guestName || record.guest || record.name),
    guestEmail: normalizeString(record.guestEmail || record.email),
    guestPhone: normalizeString(record.guestPhone || record.phone || record.telephone),
    propertyName: normalizeWhitespace(record.propertyName || record.property || record.hotel),
    unitName: normalizeWhitespace(record.unitName || record.unit || record.room || record.roomName),
    checkin,
    checkout,
    adults: Number.isFinite(record.adults) ? record.adults : parseInteger(record.adults, 1),
    children: Number.isFinite(record.children) ? record.children : parseInteger(record.children, 0),
    totalCents: Number.isFinite(record.totalCents) ? record.totalCents : parseInteger(record.totalCents, 0),
    currency: record.currency || definition?.defaultCurrency || 'EUR',
    status: record.status ? String(record.status).toUpperCase() : undefined,
    notes: normalizeString(record.notes)
  };
}

function normalizeWebhookEntry(entry, channelKey, definition, dayjs) {
  if (!isPlainObject(entry)) return null;
  const propertyName = pickValue(entry, webhookFieldSynonyms.property);
  const unitName = pickValue(entry, webhookFieldSynonyms.unit);
  const checkin = pickValue(entry, webhookFieldSynonyms.checkin);
  const checkout = pickValue(entry, webhookFieldSynonyms.checkout);
  const guestName = pickValue(entry, webhookFieldSynonyms.guestName);
  const guestEmail = pickValue(entry, webhookFieldSynonyms.guestEmail);
  const guestPhone = pickValue(entry, webhookFieldSynonyms.guestPhone);
  const adults = pickValue(entry, webhookFieldSynonyms.adults);
  const children = pickValue(entry, webhookFieldSynonyms.children);
  const totalRaw = pickValue(entry, webhookFieldSynonyms.total);
  const currencyRaw = pickValue(entry, webhookFieldSynonyms.currency);
  const reference = pickValue(entry, webhookFieldSynonyms.reference);
  const status = pickValue(entry, webhookFieldSynonyms.status);
  const notes = pickValue(entry, webhookFieldSynonyms.notes);
  const currency = hasMeaningfulValue(currencyRaw) ? String(currencyRaw).trim() : definition?.defaultCurrency || 'EUR';
  const totalParsed = coerceCurrencyValue(totalRaw, currency);

  const record = normalizeRecord(
    {
      raw: entry,
      propertyName,
      unitName,
      checkin,
      checkout,
      guestName,
      guestEmail,
      guestPhone,
      adults: hasMeaningfulValue(adults) ? adults : undefined,
      children: hasMeaningfulValue(children) ? children : undefined,
      totalCents: hasMeaningfulValue(totalParsed.cents) ? totalParsed.cents : undefined,
      currency: totalParsed.currency || currency,
      reference,
      status: status ? String(status).toUpperCase() : undefined,
      notes
    },
    channelKey,
    definition,
    dayjs
  );

  if (!record.checkin || !record.checkout || !record.guestName) {
    return null;
  }
  if (!record.unitName && !record.propertyName && !record.notes) {
    return null;
  }
  return record;
}

function parseWebhookRecords({ channelKey, payload, definition, dayjs }) {
  if (payload == null) return [];
  const queue = [payload];
  const seen = new WeakSet();
  const records = [];

  while (queue.length) {
    const item = queue.shift();
    if (item == null) continue;
    if (Array.isArray(item)) {
      for (const value of item) {
        if (isPlainObject(value) || Array.isArray(value)) {
          queue.push(value);
        }
      }
      continue;
    }
    if (!isPlainObject(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);

    const normalized = normalizeWebhookEntry(item, channelKey, definition, dayjs);
    if (normalized) {
      records.push(normalized);
    }

    for (const value of Object.values(item)) {
      if (isPlainObject(value) || Array.isArray(value)) {
        queue.push(value);
      }
    }
  }

  return records;
}

function createChannelIntegrationService({
  db,
  dayjs,
  slugify,
  ExcelJS,
  ensureDir,
  uploadsDir
}) {
  ensureDefaults(db);

  const tabularSynonyms = {
    property: ['property', 'hotel', 'alojamento', 'property name', 'hotel name'],
    unit: ['unit', 'room', 'room name', 'accommodation', 'listing', 'unit name'],
    checkin: ['check-in', 'checkin', 'arrival', 'arrival date', 'start', 'start date', 'from'],
    checkout: ['check-out', 'checkout', 'departure', 'departure date', 'end', 'end date', 'to'],
    guest_name: ['guest', 'guest name', 'name', 'lead name', 'customer', 'cliente'],
    guest_email: ['email', 'guest email', 'mail'],
    guest_phone: ['phone', 'telephone', 'contact', 'contact phone'],
    adults: ['adults', 'adultos'],
    children: ['children', 'kids', 'criancas', 'crianças'],
    total: ['total', 'amount', 'gross amount', 'price', 'valor', 'total price', 'payout'],
    currency: ['currency', 'moeda'],
    reference: ['reference', 'booking reference', 'reservation id', 'reservation number', 'confirmation number', 'res id'],
    status: ['status', 'state'],
    notes: ['notes', 'observations', 'obs', 'comentarios', 'comments']
  };

  const unitsQuery = db.prepare(
    `SELECT u.id, u.name, p.name AS property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id`
  );

  const insertBatchStmt = db.prepare(
    `INSERT INTO channel_import_batches(channel_key, source, file_name, original_name, uploaded_by, status, summary_json, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const finalizeBatchStmt = db.prepare(
    `UPDATE channel_import_batches
        SET status = ?, processed_at = datetime('now'), summary_json = ?, error_message = ?
      WHERE id = ?`
  );

  const findExternalRefStmt = db.prepare('SELECT id FROM bookings WHERE external_ref = ? LIMIT 1');
  const findOverlapStmt = db.prepare(
    `SELECT id, guest_name, external_ref
       FROM bookings
      WHERE unit_id = ?
        AND status IN ('CONFIRMED','PENDING')
        AND NOT (checkout <= ? OR checkin >= ?)
      LIMIT 1`
  );
  const findExactStmt = db.prepare(
    `SELECT id FROM bookings WHERE unit_id = ? AND checkin = ? AND checkout = ? AND UPPER(guest_name) = UPPER(?) LIMIT 1`
  );

  const insertBookingStmt = db.prepare(
    `INSERT INTO bookings(
        unit_id,
        guest_name,
        guest_email,
        guest_nationality,
        guest_phone,
        agency,
        adults,
        children,
        checkin,
        checkout,
        total_cents,
        status,
        external_ref,
        source_channel,
        import_batch_id,
        import_source,
        imported_at,
        source_payload,
        import_notes,
        rate_plan_id
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  function getChannelDefinition(channelKey) {
    return CHANNEL_DEFINITIONS.find(item => item.key === channelKey);
  }

  function loadIntegrations() {
    const rows = db.prepare('SELECT * FROM channel_integrations ORDER BY channel_name').all();
    return rows.map(row => {
      const definition = getChannelDefinition(row.channel_key) || { key: row.channel_key, name: row.channel_name };
      return {
        ...row,
        definition,
        settings: safeJsonParse(row.settings_json, {}),
        credentials: safeJsonParse(row.credentials_json, {}),
        last_summary: safeJsonParse(row.last_summary_json, null)
      };
    });
  }

  function listIntegrations() {
    return loadIntegrations().map(record => {
      const { definition } = record;
      return {
        key: record.channel_key,
        name: record.channel_name,
        description: definition ? definition.description : '',
        supportsAuto: definition ? !!definition.supportsAuto : false,
        supportsManual: definition ? !!definition.supportsManual : false,
        autoFormats: definition && definition.autoFormats ? definition.autoFormats : [],
        manualFormats: definition && definition.manualFormats ? definition.manualFormats : [],
        defaultAgency: definition && definition.defaultAgency ? definition.defaultAgency : record.channel_name,
        settings: record.settings || {},
        credentials: record.credentials || {},
        last_synced_at: record.last_synced_at,
        last_status: record.last_status,
        last_error: record.last_error,
        last_summary: record.last_summary
      };
    });
  }

  function getIntegration(channelKey) {
    return loadIntegrations().find(item => item.channel_key === channelKey);
  }

  function saveIntegrationSettings(channelKey, payload, userId) {
    const record = getIntegration(channelKey);
    if (!record) throw new Error('Canal desconhecido');
    const currentSettings = record.settings || {};
    const currentCredentials = record.credentials || {};

    const nextSettings = {
      ...currentSettings,
      autoEnabled: payload.autoEnabled ? true : false,
      autoUrl: normalizeString(payload.autoUrl),
      autoFormat: normalizeString(payload.autoFormat) || currentSettings.autoFormat || '',
      defaultStatus: payload.defaultStatus === 'PENDING' ? 'PENDING' : 'CONFIRMED',
      timezone: normalizeString(payload.timezone) || currentSettings.timezone || '',
      notes: normalizeString(payload.notes || currentSettings.notes || '')
    };

    const nextCredentials = { ...currentCredentials };
    if (payload.autoUsername != null) {
      nextCredentials.username = normalizeString(payload.autoUsername);
    }
    if (payload.autoPassword) {
      nextCredentials.password = payload.autoPassword;
    } else if (payload.retainPassword === false) {
      nextCredentials.password = '';
    }

    db.prepare(
      `UPDATE channel_integrations
          SET settings_json = ?,
              credentials_json = ?,
              updated_at = datetime('now'),
              updated_by = ?
        WHERE channel_key = ?`
    ).run(JSON.stringify(nextSettings), JSON.stringify(nextCredentials), userId || null, channelKey);

    return {
      channelKey,
      settings: nextSettings,
      credentials: nextCredentials
    };
  }

  function listRecentImports(limit = 25) {
    return db
      .prepare(
        `SELECT b.*, u.username
           FROM channel_import_batches b
           LEFT JOIN users u ON u.id = b.uploaded_by
          ORDER BY b.created_at DESC
          LIMIT ?`
      )
      .all(limit)
      .map(row => ({
        ...row,
        summary: safeJsonParse(row.summary_json, null)
      }));
  }

  function determineFormatFromName(name) {
    if (!name) return '';
    const ext = path.extname(String(name).toLowerCase());
    if (!ext) return '';
    if (ext === '.csv') return 'csv';
    if (ext === '.tsv') return 'tsv';
    if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xls') return 'xlsx';
    if (ext === '.ics' || ext === '.ical') return 'ics';
    if (ext === '.json') return 'json';
    return ext.replace('.', '');
  }

  function mapTabularRow(row, channelKey, definition, dayjs) {
    const synonyms = tabularSynonyms;
    const record = {
      propertyName: pickField(row, synonyms.property, slugify),
      unitName: pickField(row, synonyms.unit, slugify),
      checkin: pickField(row, synonyms.checkin, slugify),
      checkout: pickField(row, synonyms.checkout, slugify),
      guestName: pickField(row, synonyms.guest_name, slugify),
      guestEmail: pickField(row, synonyms.guest_email, slugify),
      guestPhone: pickField(row, synonyms.guest_phone, slugify),
      adults: pickField(row, synonyms.adults, slugify),
      children: pickField(row, synonyms.children, slugify),
      total: pickField(row, synonyms.total, slugify),
      currency: pickField(row, synonyms.currency, slugify),
      reference: pickField(row, synonyms.reference, slugify),
      status: pickField(row, synonyms.status, slugify),
      notes: pickField(row, synonyms.notes, slugify)
    };
    const currencyParsed = parseCurrencyValue(record.total, record.currency || definition?.defaultCurrency || 'EUR');
    return normalizeRecord(
      {
        rawRow: row,
        propertyName: record.propertyName,
        unitName: record.unitName,
        checkin: record.checkin,
        checkout: record.checkout,
        guestName: record.guestName,
        guestEmail: record.guestEmail,
        guestPhone: record.guestPhone,
        adults: parseInteger(record.adults, 1),
        children: parseInteger(record.children, 0),
        totalCents: currencyParsed.cents,
        currency: currencyParsed.currency,
        reference: record.reference,
        status: record.status,
        notes: record.notes
      },
      channelKey,
      definition,
      dayjs
    );
  }

  function parseIcsEvents(events, channelKey, definition, dayjs) {
    return events
      .map(event => {
        const descriptionMap = extractKeyedValuesFromDescription(event.DESCRIPTION && event.DESCRIPTION.value, slugify);
        const propertyName = descriptionMap.get(slugify('Property')) || descriptionMap.get(slugify('Hotel')) || '';
        const unitName =
          descriptionMap.get(slugify('Unit')) ||
          descriptionMap.get(slugify('Room')) ||
          descriptionMap.get(slugify('Accommodation')) ||
          (event.LOCATION ? event.LOCATION.value : '');
        const summary = event.SUMMARY ? event.SUMMARY.value : '';
        const summaryParts = summary
          .split(/[\-|·•–]/)
          .map(part => normalizeWhitespace(part))
          .filter(Boolean);
        let guestName = descriptionMap.get(slugify('Guest')) || descriptionMap.get(slugify('Guest Name')) || '';
        if (!guestName && summaryParts.length) {
          guestName = summaryParts[summaryParts.length - 1];
        }
        const reference = descriptionMap.get(slugify('Reference')) || descriptionMap.get(slugify('Booking')) || event.UID?.value || '';
        const total = parseCurrencyValue(descriptionMap.get(slugify('Total')) || descriptionMap.get(slugify('Amount')) || '',
          definition?.defaultCurrency || 'EUR');
        const checkin = normalizeDate(dayjs, event.DTSTART ? event.DTSTART.value : null);
        const checkout = normalizeDate(dayjs, event.DTEND ? event.DTEND.value : null);
        const adults = parseInteger(descriptionMap.get(slugify('Adults')), 1);
        const children = parseInteger(descriptionMap.get(slugify('Children')), 0);
        return normalizeRecord(
          {
            propertyName: propertyName || (summaryParts.length > 1 ? summaryParts[0] : ''),
            unitName: unitName || (summaryParts.length > 1 ? summaryParts[0] : ''),
            checkin,
            checkout,
            guestName,
            guestEmail: descriptionMap.get(slugify('Email')),
            guestPhone: descriptionMap.get(slugify('Phone')),
            adults,
            children,
            totalCents: total.cents,
            currency: total.currency,
            reference,
            status: descriptionMap.get(slugify('Status')),
            notes: summary
          },
          channelKey,
          definition,
          dayjs
        );
      })
      .filter(record => record.checkin && record.checkout && record.guestName);
  }

  function parseRecordsFromSource({ channelKey, buffer, format, originalName, dayjs }) {
    const definition = getChannelDefinition(channelKey);
    const detectedFormat = format || determineFormatFromName(originalName);
    if (detectedFormat === 'ics') {
      const events = parseIcs(buffer.toString('utf8'));
      return parseIcsEvents(events, channelKey, definition, dayjs);
    }
    if (detectedFormat === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      return workbook.xlsx.load(buffer).then(wb => {
        const sheet = wb.worksheets[0];
        if (!sheet) return [];
        const rows = [];
        sheet.eachRow((row, rowNumber) => {
          rows[rowNumber - 1] = row.values
            .slice(1)
            .map(value => (value == null ? '' : String(value)));
        });
        const objects = buildObjects(rows);
        return objects.map(row => mapTabularRow(row, channelKey, definition, dayjs));
      });
    }
    let delimiter = ',';
    let content = buffer.toString('utf8');
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    const firstLine = content.split(/\r?\n/)[0];
    delimiter = detectDelimiter(firstLine);
    let rows = parseDelimited(content, delimiter);
    if (rows.length && rows[0].length <= 1 && delimiter !== ';') {
      rows = parseDelimited(content, ';');
    }
    const objects = buildObjects(rows);
    return objects.map(row => mapTabularRow(row, channelKey, definition, dayjs));
  }

  function buildUnitIndex() {
    const units = unitsQuery.all();
    return units.map(unit => ({
      ...unit,
      unitSlug: slugify(unit.name),
      propertySlug: slugify(unit.property_name)
    }));
  }

  function matchUnit(record, unitsIndex) {
    const hints = [];
    if (record.unitName) hints.push(record.unitName);
    if (record.propertyName) hints.push(record.propertyName);
    if (record.notes) hints.push(record.notes);
    const normalizedHints = hints
      .map(hint => slugify(hint))
      .filter(Boolean);
    const propertySlug = record.propertyName ? slugify(record.propertyName) : '';
    let matches = unitsIndex.filter(unit =>
      normalizedHints.some(hint => unit.unitSlug.includes(hint) || hint.includes(unit.unitSlug))
    );
    if (propertySlug) {
      const propertyMatches = matches.filter(unit => unit.propertySlug.includes(propertySlug) || propertySlug.includes(unit.propertySlug));
      if (propertyMatches.length === 1) return propertyMatches[0];
      if (!matches.length) {
        const byProperty = unitsIndex.filter(unit => unit.propertySlug.includes(propertySlug) || propertySlug.includes(unit.propertySlug));
        if (byProperty.length === 1) return byProperty[0];
        if (byProperty.length > 1 && record.unitName) {
          matches = byProperty.filter(unit => unit.unitSlug.includes(slugify(record.unitName)));
          if (matches.length === 1) return matches[0];
        }
      }
    }
    if (!matches.length && propertySlug) {
      const fallback = unitsIndex.filter(unit => unit.propertySlug.includes(propertySlug) || propertySlug.includes(unit.propertySlug));
      if (fallback.length === 1) return fallback[0];
    }
    if (matches.length === 1) return matches[0];
    return null;
  }

  function buildFallbackEmail(record, channelKey) {
    if (record.guestEmail) return record.guestEmail;
    const base = `${channelKey}-${record.externalRef || record.guestName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    return `${base || channelKey}@imports.local`; // synthetic email
  }

  async function processRecords({
    records,
    channelKey,
    source,
    fileName,
    originalName,
    uploadedBy,
    targetStatus
  }) {
    const definition = getChannelDefinition(channelKey);
    const unitsIndex = buildUnitIndex();
    const inserted = [];
    const duplicates = [];
    const conflicts = [];
    const unmatched = [];
    const errors = [];
    const summary = {
      channelKey,
      totalRecords: records.length,
      insertedCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      unmatchedCount: 0,
      errorCount: 0,
      sample: {
        inserted: [],
        duplicates: [],
        conflicts: [],
        unmatched: [],
        errors: []
      }
    };

    const execute = db.transaction(() => {
      const batchId = insertBatchStmt.run(
        channelKey,
        source,
        fileName || null,
        originalName || null,
        uploadedBy || null,
        'processing',
        null,
        null
      ).lastInsertRowid;

      for (const record of records) {
        try {
          const unit = matchUnit(record, unitsIndex);
          if (!unit) {
            unmatched.push({ record, reason: 'unit_not_found' });
            continue;
          }
          if (record.externalRef) {
            const existing = findExternalRefStmt.get(record.externalRef);
            if (existing) {
              duplicates.push({ record, booking_id: existing.id });
              continue;
            }
          }
          const overlap = findOverlapStmt.get(unit.id, record.checkin, record.checkout);
          if (overlap) {
            conflicts.push({ record, booking_id: overlap.id });
            continue;
          }
          const exact = findExactStmt.get(unit.id, record.checkin, record.checkout, record.guestName || '');
          if (exact) {
            duplicates.push({ record, booking_id: exact.id });
            continue;
          }
          const agency = definition?.defaultAgency || record.channelKey || channelKey;
          const status = targetStatus || record.status || 'CONFIRMED';
          const payload = truncatePayload(JSON.stringify(record.raw || {}));
          insertBookingStmt.run(
            unit.id,
            record.guestName || 'Hóspede',
            buildFallbackEmail(record, channelKey),
            null,
            record.guestPhone || null,
            agency,
            Number.isFinite(record.adults) && record.adults > 0 ? record.adults : 1,
            Number.isFinite(record.children) && record.children >= 0 ? record.children : 0,
            record.checkin,
            record.checkout,
            Number.isFinite(record.totalCents) ? record.totalCents : 0,
            status,
            record.externalRef || null,
            channelKey,
            batchId,
            source,
            dayjs().format('YYYY-MM-DD HH:mm:ss'),
            payload,
            record.notes || null,
            Number.isInteger(record.ratePlanId) && record.ratePlanId > 0 ? record.ratePlanId : null
          );
          const lastId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
          inserted.push({ record, booking_id: lastId, unit });
        } catch (err) {
          errors.push({ record, error: err.message });
        }
      }

      summary.insertedCount = inserted.length;
      summary.duplicateCount = duplicates.length;
      summary.conflictCount = conflicts.length;
      summary.unmatchedCount = unmatched.length;
      summary.errorCount = errors.length;
      summary.sample.inserted = inserted.slice(0, 10).map(item => ({
        booking_id: item.booking_id,
        guestName: item.record.guestName,
        checkin: item.record.checkin,
        checkout: item.record.checkout,
        unitName: item.unit ? item.unit.name : null
      }));
      summary.sample.duplicates = duplicates.slice(0, 10).map(item => ({
        booking_id: item.booking_id,
        guestName: item.record.guestName,
        checkin: item.record.checkin,
        checkout: item.record.checkout
      }));
      summary.sample.conflicts = conflicts.slice(0, 10).map(item => ({
        booking_id: item.booking_id,
        guestName: item.record.guestName,
        checkin: item.record.checkin,
        checkout: item.record.checkout
      }));
      summary.sample.unmatched = unmatched.slice(0, 10).map(item => ({
        guestName: item.record.guestName,
        propertyName: item.record.propertyName,
        unitName: item.record.unitName
      }));
      summary.sample.errors = errors.slice(0, 5);

      const status = errors.length && !inserted.length ? 'failed' : errors.length ? 'partial' : 'processed';
      finalizeBatchStmt.run(status, JSON.stringify(summary), errors.length ? 'Importação com alertas' : null, batchId);

      return { batchId, summary, status };
    });

    const outcome = execute();
    return { ...outcome, inserted, duplicates, conflicts, unmatched, errors };
  }

  async function importFromFile({ channelKey, filePath, originalName, uploadedBy, targetStatus }) {
    const buffer = await fs.promises.readFile(filePath);
    const format = determineFormatFromName(originalName || filePath);
    const records = await Promise.resolve(
      parseRecordsFromSource({ channelKey, buffer, format, originalName, dayjs })
    );
    return processRecords({
      records,
      channelKey,
      source: 'manual-upload',
      fileName: path.basename(filePath),
      originalName,
      uploadedBy,
      targetStatus
    });
  }

  async function importFromBuffer({ channelKey, buffer, format, originalName, uploadedBy, targetStatus }) {
    const records = await Promise.resolve(
      parseRecordsFromSource({ channelKey, buffer, format, originalName, dayjs })
    );
    return processRecords({
      records,
      channelKey,
      source: 'auto-fetch',
      fileName: null,
      originalName,
      uploadedBy,
      targetStatus
    });
  }

  async function autoSyncChannel(channelKey, { userId, reason } = {}) {
    const integration = getIntegration(channelKey);
    if (!integration) throw new Error('Canal desconhecido');
    const settings = integration.settings || {};
    if (!settings.autoEnabled || !settings.autoUrl) {
      return { skipped: true, reason: 'auto_sync_disabled' };
    }
    const definition = getChannelDefinition(channelKey);
    const targetStatus = settings.defaultStatus === 'PENDING' ? 'PENDING' : 'CONFIRMED';
    const auth = integration.credentials || {};
    try {
      const response = await fetchRemote(settings.autoUrl, auth);
      const result = await importFromBuffer({
        channelKey,
        buffer: response.buffer,
        format: settings.autoFormat || determineFormatFromName(settings.autoUrl),
        originalName: settings.autoUrl,
        uploadedBy: userId,
        targetStatus
      });
      db.prepare(
        `UPDATE channel_integrations
            SET last_synced_at = datetime('now'),
                last_status = ?,
                last_error = NULL,
                last_summary_json = ?,
                updated_at = datetime('now'),
                updated_by = ?
          WHERE channel_key = ?`
      ).run(result.status, JSON.stringify(result.summary), userId || null, channelKey);
      return { skipped: false, summary: result.summary };
    } catch (err) {
      db.prepare(
        `UPDATE channel_integrations
            SET last_synced_at = datetime('now'),
                last_status = 'failed',
                last_error = ?,
                updated_at = datetime('now'),
                updated_by = ?
          WHERE channel_key = ?`
      ).run(err.message, userId || null, channelKey);
      throw err;
    }
  }

  async function autoSyncAll(options = {}) {
    const results = [];
    for (const channel of CHANNEL_DEFINITIONS) {
      try {
        const result = await autoSyncChannel(channel.key, options);
        results.push({ channel: channel.key, ...result });
      } catch (err) {
        results.push({ channel: channel.key, error: err.message });
      }
    }
    return results;
  }

  async function importFromWebhook({ channelKey, payload, uploadedBy, targetStatus, sourceLabel }) {
    const integration = getIntegration(channelKey);
    if (!integration) {
      throw new Error('Canal desconhecido');
    }
    const definition = getChannelDefinition(channelKey);
    const desiredStatus = targetStatus || (integration.settings?.defaultStatus === 'PENDING' ? 'PENDING' : 'CONFIRMED');
    const records = parseWebhookRecords({ channelKey, payload, definition, dayjs });

    const result = await processRecords({
      records,
      channelKey,
      source: sourceLabel || 'webhook',
      fileName: null,
      originalName: sourceLabel || 'webhook',
      uploadedBy,
      targetStatus: desiredStatus
    });

    db.prepare(
      `UPDATE channel_integrations
          SET last_synced_at = datetime('now'),
              last_status = ?,
              last_error = NULL,
              last_summary_json = ?,
              updated_at = datetime('now'),
              updated_by = ?
        WHERE channel_key = ?`
    ).run(result.status, JSON.stringify(result.summary || null), uploadedBy || null, channelKey);

    return { ...result, processedRecords: records.length };
  }

  return {
    CHANNEL_DEFINITIONS,
    listIntegrations,
    getIntegration,
    saveIntegrationSettings,
    listRecentImports,
    importFromFile,
    autoSyncChannel,
    autoSyncAll,
    importFromWebhook
  };
}

module.exports = {
  CHANNEL_DEFINITIONS,
  createChannelIntegrationService
};
