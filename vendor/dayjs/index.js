const INVALID_DATE_STRING = 'Invalid Date';

const BASE_LOCALES = {
  en: {
    name: 'en',
    weekStart: 0,
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  }
};

const monthNameLookup = {
  jan: 0,
  january: 0,
  janv: 0,
  fev: 1,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  abr: 3,
  apr: 3,
  april: 3,
  mai: 4,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  ago: 7,
  aug: 7,
  august: 7,
  set: 8,
  sep: 8,
  sept: 8,
  september: 8,
  out: 9,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dez: 11,
  dec: 11,
  december: 11
};

const locales = { ...BASE_LOCALES };
let defaultLocale = 'en';
let customParseTwoDigitYear = null;

function cloneDate(date) {
  return new Date(date.getTime());
}

function isNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value);
}

function pad(value, length = 2) {
  return String(Math.abs(value)).padStart(length, '0');
}

function normalizeUnit(unit) {
  if (!unit) return null;
  const normalized = unit.toString().toLowerCase();
  switch (normalized) {
    case 'millisecond':
    case 'milliseconds':
    case 'ms':
      return 'millisecond';
    case 'second':
    case 'seconds':
    case 's':
      return 'second';
    case 'minute':
    case 'minutes':
    case 'm':
      return 'minute';
    case 'hour':
    case 'hours':
    case 'h':
      return 'hour';
    case 'day':
    case 'days':
    case 'd':
      return 'day';
    case 'week':
    case 'weeks':
    case 'w':
      return 'week';
    case 'month':
    case 'months':
      return 'month';
    case 'year':
    case 'years':
    case 'y':
      return 'year';
    default:
      return normalized;
  }
}

function parseTwoDigitYearValue(value) {
  if (typeof customParseTwoDigitYear === 'function') {
    const overrideResult = customParseTwoDigitYear(String(value));
    const numeric = Number(overrideResult);
    return Number.isFinite(numeric) ? numeric : NaN;
  }

  const year = Number(value);
  if (!Number.isFinite(year)) return NaN;
  return year + (year > 68 ? 1900 : 2000);
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyMilliseconds(ctx, raw) {
  const str = String(raw);
  if (!/^[0-9]+$/.test(str)) {
    ctx.invalid = true;
    return;
  }
  const padded = str.padEnd(3, '0').slice(0, 3);
  ctx.millisecond = Number(padded);
}

function lookupMonthIndexFromLocale(name, locale) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(monthNameLookup, lower)) {
    return monthNameLookup[lower];
  }

  const months = (locale && Array.isArray(locale.months) ? locale.months : BASE_LOCALES.en.months) || [];
  let index = months.findIndex(entry => entry && entry.toLowerCase() === lower);
  if (index >= 0) return index;

  const monthsShort = (locale && Array.isArray(locale.monthsShort) ? locale.monthsShort : BASE_LOCALES.en.monthsShort) || [];
  index = monthsShort.findIndex(entry => entry && entry.toLowerCase() === lower);
  if (index >= 0) return index;

  return null;
}

const GENERIC_TOKEN_HANDLERS = {
  YYYY: {
    pattern: '\\d{4}',
    apply: (ctx, value) => {
      const year = Number(value);
      if (!Number.isFinite(year)) {
        ctx.invalid = true;
      } else {
        ctx.year = year;
      }
    }
  },
  YY: {
    pattern: '\\d{2}',
    apply: (ctx, value) => {
      const year = parseTwoDigitYearValue(value);
      if (!Number.isFinite(year)) {
        ctx.invalid = true;
      } else {
        ctx.year = year;
      }
    }
  },
  MMMM: {
    pattern: '[^\\d\\s]+',
    apply: (ctx, value, locale) => {
      const index = lookupMonthIndexFromLocale(value, locale);
      if (index === null) {
        ctx.invalid = true;
      } else {
        ctx.month = index;
      }
    }
  },
  MMM: {
    pattern: '[^\\d\\s]+',
    apply: (ctx, value, locale) => {
      const index = lookupMonthIndexFromLocale(value, locale);
      if (index === null) {
        ctx.invalid = true;
      } else {
        ctx.month = index;
      }
    }
  },
  MM: {
    pattern: '\\d{2}',
    apply: (ctx, value) => {
      const month = Number(value) - 1;
      if (!Number.isFinite(month)) {
        ctx.invalid = true;
      } else {
        ctx.month = month;
      }
    }
  },
  M: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const month = Number(value) - 1;
      if (!Number.isFinite(month)) {
        ctx.invalid = true;
      } else {
        ctx.month = month;
      }
    }
  },
  DD: {
    pattern: '\\d{2}',
    apply: (ctx, value) => {
      const day = Number(value);
      if (!Number.isFinite(day)) {
        ctx.invalid = true;
      } else {
        ctx.day = day;
      }
    }
  },
  D: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const day = Number(value);
      if (!Number.isFinite(day)) {
        ctx.invalid = true;
      } else {
        ctx.day = day;
      }
    }
  },
  Do: {
    pattern: '\\d{1,2}(?:º|ª|st|nd|rd|th)?',
    apply: (ctx, value) => {
      const match = value.match(/\\d+/);
      const day = match ? Number(match[0]) : NaN;
      if (!Number.isFinite(day)) {
        ctx.invalid = true;
      } else {
        ctx.day = day;
      }
    }
  },
  HH: {
    pattern: '\\d{2}',
    apply: (ctx, value) => {
      const hour = Number(value);
      if (!Number.isFinite(hour)) {
        ctx.invalid = true;
      } else {
        ctx.hour = hour;
      }
    }
  },
  H: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const hour = Number(value);
      if (!Number.isFinite(hour)) {
        ctx.invalid = true;
      } else {
        ctx.hour = hour;
      }
    }
  },
  hh: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const hour = Number(value);
      if (!Number.isFinite(hour)) {
        ctx.invalid = true;
      } else {
        ctx.hour = hour % 12;
        ctx.is12Hour = true;
      }
    }
  },
  h: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const hour = Number(value);
      if (!Number.isFinite(hour)) {
        ctx.invalid = true;
      } else {
        ctx.hour = hour % 12;
        ctx.is12Hour = true;
      }
    }
  },
  mm: {
    pattern: '\\d{2}',
    apply: (ctx, value) => {
      const minute = Number(value);
      if (!Number.isFinite(minute)) {
        ctx.invalid = true;
      } else {
        ctx.minute = minute;
      }
    }
  },
  m: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const minute = Number(value);
      if (!Number.isFinite(minute)) {
        ctx.invalid = true;
      } else {
        ctx.minute = minute;
      }
    }
  },
  ss: {
    pattern: '\\d{2}',
    apply: (ctx, value) => {
      const second = Number(value);
      if (!Number.isFinite(second)) {
        ctx.invalid = true;
      } else {
        ctx.second = second;
      }
    }
  },
  s: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => {
      const second = Number(value);
      if (!Number.isFinite(second)) {
        ctx.invalid = true;
      } else {
        ctx.second = second;
      }
    }
  },
  SSS: {
    pattern: '\\d{1,3}',
    apply: (ctx, value) => applyMilliseconds(ctx, value)
  },
  SS: {
    pattern: '\\d{1,2}',
    apply: (ctx, value) => applyMilliseconds(ctx, value)
  },
  S: {
    pattern: '\\d',
    apply: (ctx, value) => applyMilliseconds(ctx, value)
  },
  A: {
    pattern: 'AM|PM',
    apply: (ctx, value) => {
      ctx.meridiem = value.toUpperCase();
      ctx.is12Hour = true;
    }
  },
  a: {
    pattern: 'am|pm',
    apply: (ctx, value) => {
      ctx.meridiem = value.toUpperCase();
      ctx.is12Hour = true;
    }
  },
  dddd: {
    pattern: '[^\\d\\s]+',
    apply: () => {}
  },
  ddd: {
    pattern: '[^\\d\\s]+',
    apply: () => {}
  },
  dd: {
    pattern: '[^\\d\\s]+',
    apply: () => {}
  }
};

const GENERIC_TOKENS_ORDER = [
  'YYYY',
  'YY',
  'MMMM',
  'MMM',
  'MM',
  'M',
  'DD',
  'Do',
  'D',
  'HH',
  'H',
  'hh',
  'h',
  'mm',
  'm',
  'ss',
  's',
  'SSS',
  'SS',
  'S',
  'A',
  'a',
  'dddd',
  'ddd',
  'dd'
];

function getLocaleConfig(name) {
  const target = name && locales[name] ? locales[name] : locales[defaultLocale];
  return target || locales.en;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function buildDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const result = new Date(year, month, day, hour, minute, second, millisecond);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month ||
    result.getDate() !== day ||
    result.getHours() !== hour ||
    result.getMinutes() !== minute ||
    result.getSeconds() !== second ||
    result.getMilliseconds() !== millisecond
  ) {
    return new Date(NaN);
  }
  return result;
}

function parseWithKnownFormat(value, format, strict, localeName) {
  if (typeof value !== 'string') return null;
  const input = strict ? value : value.trim();
  switch (format) {
    case 'YYYY-MM-DD': {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
      if (!match) return null;
      const [, y, m, d] = match;
      return buildDate(Number(y), Number(m) - 1, Number(d));
    }
    case 'DD/MM/YYYY': {
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
      if (!match) return null;
      const [, d, m, y] = match;
      return buildDate(Number(y), Number(m) - 1, Number(d));
    }
    case 'DD-MM-YYYY': {
      const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(input);
      if (!match) return null;
      const [, d, m, y] = match;
      return buildDate(Number(y), Number(m) - 1, Number(d));
    }
    case 'YYYY/MM/DD': {
      const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(input);
      if (!match) return null;
      const [, y, m, d] = match;
      return buildDate(Number(y), Number(m) - 1, Number(d));
    }
    case 'MM/DD/YYYY': {
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
      if (!match) return null;
      const [, m, d, y] = match;
      return buildDate(Number(y), Number(m) - 1, Number(d));
    }
    case 'DD MMM YYYY': {
      const match = /^(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\s+(\d{4})$/.exec(input);
      if (!match) return null;
      const [, d, mon, y] = match;
      const key = mon.toLowerCase();
      const monthIndex = monthNameLookup[key];
      if (monthIndex == null) return null;
      return buildDate(Number(y), monthIndex, Number(d));
    }
    case 'HH:mm': {
      const match = /^(\d{2}):(\d{2})$/.exec(input);
      if (!match) return null;
      const [, hh, mm] = match;
      const hour = Number(hh);
      const minute = Number(mm);
      if (hour > 23 || minute > 59) return null;
      return buildDate(1970, 0, 1, hour, minute);
    }
    case 'H:mm': {
      const match = /^(\d{1,2}):(\d{2})$/.exec(input);
      if (!match) return null;
      const [, h, m] = match;
      const hour = Number(h);
      const minute = Number(m);
      if (hour > 23 || minute > 59) return null;
      return buildDate(1970, 0, 1, hour, minute);
    }
    default:
      return parseGenericFormat(input, format, strict, localeName);
  }
}

function parseGenericFormat(value, format, strict, localeName) {
  if (typeof format !== 'string' || !format) return null;
  const locale = getLocaleConfig(localeName);
  const handlers = [];
  let pattern = '';

  for (let i = 0; i < format.length; ) {
    const char = format[i];
    if (char === '[') {
      const end = format.indexOf(']', i);
      if (end === -1) return null;
      pattern += escapeRegexLiteral(format.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    let matchedToken;
    for (const token of GENERIC_TOKENS_ORDER) {
      if (format.slice(i, i + token.length) === token) {
        matchedToken = token;
        break;
      }
    }

    if (matchedToken) {
      const handler = GENERIC_TOKEN_HANDLERS[matchedToken];
      if (!handler) {
        pattern += escapeRegexLiteral(char);
        i += 1;
        continue;
      }
      handlers.push(handler);
      pattern += `(${handler.pattern})`;
      i += matchedToken.length;
    } else {
      pattern += escapeRegexLiteral(char);
      i += 1;
    }
  }

  if (!handlers.length) return null;

  const matcher = new RegExp(`^${pattern}$`, 'i');
  const target = strict ? value : value.trim();
  const match = matcher.exec(target);
  if (!match) return null;

  const context = {
    meridiem: null,
    is12Hour: false,
    invalid: false
  };

  let index = 1;
  for (const handler of handlers) {
    const segment = match[index++] || '';
    handler.apply(context, segment, locale);
    if (context.invalid) {
      return new Date(NaN);
    }
  }

  let year = context.year;
  let month = context.month;
  let day = context.day;
  let hour = context.hour !== undefined ? Number(context.hour) : 0;
  let minute = context.minute !== undefined ? Number(context.minute) : 0;
  let second = context.second !== undefined ? Number(context.second) : 0;
  let millisecond = context.millisecond !== undefined ? Number(context.millisecond) : 0;

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second) || !Number.isFinite(millisecond)) {
    return new Date(NaN);
  }

  if (context.is12Hour) {
    const meridiem = context.meridiem ? context.meridiem.toUpperCase() : null;
    if (meridiem === 'PM' && hour < 12) {
      hour += 12;
    }
    if (meridiem === 'AM' && hour === 12) {
      hour = 0;
    }
    if (meridiem === null && hour > 12) {
      return new Date(NaN);
    }
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) {
    return new Date(NaN);
  }

  if (month !== undefined && (!Number.isFinite(month) || month < 0 || month > 11)) {
    return new Date(NaN);
  }

  if (day !== undefined && (!Number.isFinite(day) || day < 1 || day > 31)) {
    return new Date(NaN);
  }

  const hasDate = year !== undefined || month !== undefined || day !== undefined;
  const reference = new Date();
  year = Number.isFinite(year) ? year : hasDate ? reference.getFullYear() : 1970;
  month = Number.isFinite(month) ? month : hasDate ? reference.getMonth() : 0;
  day = Number.isFinite(day) ? day : hasDate ? 1 : 1;

  return buildDate(year, month, day, hour, minute, second, millisecond);
}

function parseFormatted(value, formats, strict, localeName) {
  const list = Array.isArray(formats) ? formats : [formats];
  for (const fmt of list) {
    const parsed = parseWithKnownFormat(value, fmt, strict, localeName);
    if (parsed) return parsed;
  }
  return null;
}

const FORMAT_TOKENS = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|mm|m|ss|s|dddd|ddd|dd|d|A|a|YYYY/g;

function formatDate(date, formatStr, localeName) {
  const locale = getLocaleConfig(localeName);
  return formatStr.replace(FORMAT_TOKENS, token => {
    if (token.startsWith('[') && token.endsWith(']')) {
      return token.slice(1, -1);
    }
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'YY':
        return pad(date.getFullYear() % 100, 2);
      case 'MMMM':
        return locale.months[date.getMonth()] || BASE_LOCALES.en.months[date.getMonth()];
      case 'MMM':
        return locale.monthsShort[date.getMonth()] || BASE_LOCALES.en.monthsShort[date.getMonth()];
      case 'MM':
        return pad(date.getMonth() + 1, 2);
      case 'M':
        return String(date.getMonth() + 1);
      case 'DD':
        return pad(date.getDate(), 2);
      case 'D':
        return String(date.getDate());
      case 'HH':
        return pad(date.getHours(), 2);
      case 'H':
        return String(date.getHours());
      case 'mm':
        return pad(date.getMinutes(), 2);
      case 'm':
        return String(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds(), 2);
      case 's':
        return String(date.getSeconds());
      case 'dddd':
        return locale.weekdays[date.getDay()] || BASE_LOCALES.en.weekdays[date.getDay()];
      case 'ddd':
        return locale.weekdaysShort[date.getDay()] || BASE_LOCALES.en.weekdaysShort[date.getDay()];
      case 'dd':
        return (locale.weekdaysShort[date.getDay()] || BASE_LOCALES.en.weekdaysShort[date.getDay()]).slice(0, 2);
      case 'd':
        return String(date.getDay());
      case 'A':
        return date.getHours() < 12 ? 'AM' : 'PM';
      case 'a':
        return date.getHours() < 12 ? 'am' : 'pm';
      default:
        return token;
    }
  });
}

function addMonths(baseDate, amount) {
  if (!isNumber(amount)) return new Date(NaN);
  const date = cloneDate(baseDate);
  const desiredDate = date.getDate();
  const targetMonth = date.getMonth() + amount;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const maxDay = daysInMonth(targetYear, normalizedMonth);
  date.setFullYear(targetYear, normalizedMonth, Math.min(desiredDate, maxDay));
  return date;
}

class DayjsLite {
  constructor(config, legacyLocale) {
    const cfg =
      config instanceof Date || config instanceof DayjsLite || typeof config !== 'object' || config === null
        ? { date: config, locale: legacyLocale }
        : { ...config };

    this.$L = typeof cfg.locale === 'string' ? cfg.locale : defaultLocale;
    this.$u = cfg.utc === true;
    this.$d = new Date();
    this.parse({ ...cfg, args: Array.isArray(cfg.args) ? cfg.args.slice() : cfg.args });
    this.init();
  }

  init() {
    this.$isValid = !Number.isNaN(this.$d.getTime());
    return this;
  }

  parse(config) {
    const cfg = config || {};
    const args = Array.isArray(cfg.args) ? cfg.args : [];

    if (typeof cfg.locale === 'string') {
      this.$L = cfg.locale;
    }

    let parsingFormat = cfg.format;
    let parsingStrict = cfg.strict;
    let localeFromArgs = cfg.locale;

    if (args.length > 1) {
      const second = args[1];
      if (second && typeof second === 'object' && !Array.isArray(second)) {
        if (second.locale && localeFromArgs === undefined) {
          localeFromArgs = second.locale;
        }
        if (second.format !== undefined && parsingFormat === undefined) {
          parsingFormat = second.format;
        }
        if (second.strict !== undefined && parsingStrict === undefined) {
          parsingStrict = second.strict;
        }
      } else if (parsingFormat === undefined && (typeof second === 'string' || Array.isArray(second))) {
        parsingFormat = second;
      }
    }

    if (args.length > 2 && parsingStrict === undefined) {
      parsingStrict = args[2];
    }

    if (args.length > 3 && localeFromArgs === undefined && typeof args[3] === 'string') {
      localeFromArgs = args[3];
    }

    if (typeof localeFromArgs === 'string') {
      this.$L = localeFromArgs;
    }

    const input = cfg.date;

    if (input instanceof DayjsLite) {
      this.$d = cloneDate(input.$d);
      this.$L = input.$L;
      this.$u = input.$u;
      return;
    }

    if (input instanceof Date) {
      this.$d = new Date(input.getTime());
      return;
    }

    if (typeof input === 'number') {
      this.$d = new Date(input);
      return;
    }

    if (input === undefined) {
      this.$d = new Date();
      return;
    }

    if (input === null) {
      this.$d = new Date(NaN);
      return;
    }

    if (typeof input === 'string' || Array.isArray(parsingFormat)) {
      this.$d = parseInput(input, parsingFormat, parsingStrict, this.$L);
      return;
    }

    this.$d = parseInput(input, parsingFormat, parsingStrict, this.$L);
  }

  $locale() {
    return getLocaleConfig(this.$L);
  }

  clone() {
    return wrap(cloneDate(this.$d), this.$L, this.$u);
  }

  isValid() {
    return this.$isValid;
  }

  valueOf() {
    return this.$isValid ? this.$d.getTime() : NaN;
  }

  toDate() {
    return this.$isValid ? cloneDate(this.$d) : new Date(NaN);
  }

  toISOString() {
    return this.$isValid ? this.$d.toISOString() : INVALID_DATE_STRING;
  }

  toJSON() {
    return this.toISOString();
  }

  toString() {
    return this.$isValid ? this.$d.toString() : INVALID_DATE_STRING;
  }

  format(fmt) {
    if (!this.$isValid) return INVALID_DATE_STRING;
    const formatString = fmt || 'YYYY-MM-DDTHH:mm:ssZ';
    return formatDate(this.$d, formatString, this.$L);
  }

  add(amount, unit) {
    if (!this.$isValid) return wrap(new Date(NaN), this.$L, this.$u);
    const normalized = normalizeUnit(unit);
    const value = Number(amount);
    if (!Number.isFinite(value)) return wrap(new Date(NaN), this.$L, this.$u);
    let result;
    switch (normalized) {
      case 'millisecond':
        result = new Date(this.$d.getTime() + value);
        break;
      case 'second':
        result = new Date(this.$d.getTime() + value * 1000);
        break;
      case 'minute':
        result = new Date(this.$d.getTime() + value * 60 * 1000);
        break;
      case 'hour':
        result = new Date(this.$d.getTime() + value * 60 * 60 * 1000);
        break;
      case 'day':
        result = new Date(this.$d.getTime() + value * 24 * 60 * 60 * 1000);
        break;
      case 'week':
        result = new Date(this.$d.getTime() + value * 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        result = addMonths(this.$d, value);
        break;
      case 'year':
        result = addMonths(this.$d, value * 12);
        break;
      default:
        result = new Date(NaN);
    }
    return wrap(result, this.$L, this.$u);
  }

  subtract(amount, unit) {
    return this.add(-Number(amount || 0), unit);
  }

  startOf(unit) {
    if (!this.$isValid) return wrap(new Date(NaN), this.$L, this.$u);
    const normalized = normalizeUnit(unit);
    const date = cloneDate(this.$d);
    switch (normalized) {
      case 'year':
        date.setMonth(0);
      // falls through
      case 'month':
        date.setDate(1);
      // falls through
      case 'day':
        date.setHours(0, 0, 0, 0);
        break;
      case 'hour':
        date.setMinutes(0, 0, 0);
        break;
      case 'minute':
        date.setSeconds(0, 0);
        break;
      case 'second':
        date.setMilliseconds(0);
        break;
      case 'week': {
        const locale = this.$locale();
        const weekStart = Number.isInteger(locale.weekStart) ? locale.weekStart : 0;
        const diff = (date.getDay() - weekStart + 7) % 7;
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - diff);
        break;
      }
      default:
        return wrap(new Date(NaN), this.$L, this.$u);
    }
    return wrap(date, this.$L, this.$u);
  }

  endOf(unit) {
    if (!this.$isValid) return wrap(new Date(NaN), this.$L, this.$u);
    const normalized = normalizeUnit(unit);
    switch (normalized) {
      case 'year':
        return this.startOf('year').add(1, 'year').subtract(1, 'millisecond');
      case 'month':
        return this.startOf('month').add(1, 'month').subtract(1, 'millisecond');
      case 'week':
        return this.startOf('week').add(7, 'day').subtract(1, 'millisecond');
      case 'day':
        return this.startOf('day').add(1, 'day').subtract(1, 'millisecond');
      case 'hour':
        return this.startOf('hour').add(1, 'hour').subtract(1, 'millisecond');
      case 'minute':
        return this.startOf('minute').add(1, 'minute').subtract(1, 'millisecond');
      case 'second':
        return this.startOf('second').add(1, 'second').subtract(1, 'millisecond');
      default:
        return wrap(new Date(NaN), this.$L, this.$u);
    }
  }

  diff(otherInput, unit = 'millisecond', asFloat = false) {
    if (!this.$isValid) return NaN;
    const other = dayjs(otherInput);
    if (!other.isValid()) return NaN;
    const diffMs = this.$d.getTime() - other.valueOf();
    const normalized = normalizeUnit(unit) || 'millisecond';
    let result;
    switch (normalized) {
      case 'year':
        result = diffMs / (365.25 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        result = diffMs / (30.4375 * 24 * 60 * 60 * 1000);
        break;
      case 'week':
        result = diffMs / (7 * 24 * 60 * 60 * 1000);
        break;
      case 'day':
        result = diffMs / (24 * 60 * 60 * 1000);
        break;
      case 'hour':
        result = diffMs / (60 * 60 * 1000);
        break;
      case 'minute':
        result = diffMs / (60 * 1000);
        break;
      case 'second':
        result = diffMs / 1000;
        break;
      case 'millisecond':
      default:
        result = diffMs;
    }
    return asFloat ? result : (result < 0 ? Math.ceil(result) : Math.floor(result));
  }

  isBefore(otherInput, unit) {
    if (!this.$isValid) return false;
    const other = dayjs(otherInput);
    if (!other.isValid()) return false;
    if (!unit) return this.valueOf() < other.valueOf();
    return this.startOf(unit).valueOf() < other.startOf(unit).valueOf();
  }

  isAfter(otherInput, unit) {
    if (!this.$isValid) return false;
    const other = dayjs(otherInput);
    if (!other.isValid()) return false;
    if (!unit) return this.valueOf() > other.valueOf();
    return this.endOf(unit).valueOf() > other.endOf(unit).valueOf();
  }

  isSame(otherInput, unit) {
    if (!this.$isValid) return false;
    const other = dayjs(otherInput);
    if (!other.isValid()) return false;
    if (!unit) return this.valueOf() === other.valueOf();
    return this.startOf(unit).valueOf() === other.startOf(unit).valueOf();
  }

  isSameOrBefore(otherInput, unit) {
    return this.isBefore(otherInput, unit) || this.isSame(otherInput, unit);
  }

  isSameOrAfter(otherInput, unit) {
    return this.isAfter(otherInput, unit) || this.isSame(otherInput, unit);
  }

  day(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getDay();
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return wrap(new Date(NaN), this.$L, this.$u);
    const current = this.$d.getDay();
    const diff = normalized - current;
    return this.add(diff, 'day');
  }

  date(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getDate();
    const newDate = cloneDate(this.$d);
    newDate.setDate(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  month(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getMonth();
    const newDate = cloneDate(this.$d);
    newDate.setMonth(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  year(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getFullYear();
    const newDate = cloneDate(this.$d);
    newDate.setFullYear(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  hour(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getHours();
    const newDate = cloneDate(this.$d);
    newDate.setHours(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  minute(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getMinutes();
    const newDate = cloneDate(this.$d);
    newDate.setMinutes(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  second(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getSeconds();
    const newDate = cloneDate(this.$d);
    newDate.setSeconds(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  millisecond(value) {
    if (!this.$isValid) return value === undefined ? NaN : wrap(new Date(NaN), this.$L, this.$u);
    if (value === undefined) return this.$d.getMilliseconds();
    const newDate = cloneDate(this.$d);
    newDate.setMilliseconds(Number(value));
    return wrap(newDate, this.$L, this.$u);
  }

  daysInMonth() {
    if (!this.$isValid) return NaN;
    return daysInMonth(this.$d.getFullYear(), this.$d.getMonth());
  }

  locale(name) {
    if (name === undefined) return this.$L;
    if (typeof name === 'string' && locales[name]) {
      return wrap(cloneDate(this.$d), name, this.$u);
    }
    return this.clone();
  }
}

function wrap(date, localeName, utcFlag) {
  return new DayjsLite({ date, locale: localeName, utc: utcFlag === true });
}

function parseInput(input, format, strict, localeName) {
  if (format) {
    const parsed = parseFormatted(input, format, strict, localeName);
    return parsed || new Date(NaN);
  }
  if (input instanceof DayjsLite) return cloneDate(input.$d);
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    if (!input.trim()) return new Date(NaN);
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return new Date(NaN);
    return parsed;
  }
  if (input === null || input === undefined) return new Date();
  return new Date(NaN);
}

function dayjs() {
  const args = Array.prototype.slice.call(arguments);
  const input = args[0];
  let format = args[1];
  let strict = args[2];
  let localeFromOptions;

  if (format && typeof format === 'object' && !Array.isArray(format)) {
    localeFromOptions = format.locale;
    strict = format.strict;
    format = format.format;
  }

  if (args.length > 3 && localeFromOptions === undefined && typeof args[3] === 'string') {
    localeFromOptions = args[3];
  }

  return new DayjsLite({
    date: input,
    format,
    strict,
    locale: localeFromOptions,
    args
  });
}

dayjs.Dayjs = DayjsLite;
dayjs.isDayjs = value => value instanceof DayjsLite;

dayjs.Ls = locales;
dayjs.p = {};

dayjs.extend = function extend(plugin, options) {
  if (typeof plugin === 'function') {
    plugin(options, DayjsLite, dayjs);
  }
  return dayjs;
};

dayjs.locale = function locale(name, config, setAsDefault) {
  if (name === undefined) {
    return defaultLocale;
  }

  if (typeof name === 'string' && typeof config === 'object' && config) {
    locales[name] = {
      name,
      weekStart: Number.isInteger(config.weekStart) ? config.weekStart : 0,
      weekdays: config.weekdays ? config.weekdays.slice() : BASE_LOCALES.en.weekdays.slice(),
      weekdaysShort: config.weekdaysShort
        ? config.weekdaysShort.slice()
        : BASE_LOCALES.en.weekdaysShort.slice(),
      months: config.months ? config.months.slice() : BASE_LOCALES.en.months.slice(),
      monthsShort: config.monthsShort ? config.monthsShort.slice() : BASE_LOCALES.en.monthsShort.slice()
    };
    if (setAsDefault) {
      defaultLocale = name;
    }
    return name;
  }

  if (typeof name === 'object' && name) {
    const localeConfig = name;
    const localeName = localeConfig.name || defaultLocale;
    return dayjs.locale(localeName, localeConfig, config);
  }

  if (typeof name === 'string') {
    if (locales[name]) {
      defaultLocale = name;
      return name;
    }
    return defaultLocale;
  }

  return defaultLocale;
};

dayjs.__setParseTwoDigitYear = fn => {
  customParseTwoDigitYear = typeof fn === 'function' ? fn : null;
};

module.exports = dayjs;
