'use strict';

const path = require('path');

const SUPPORTED_LANGUAGES = ['pt', 'en'];
const LANGUAGE_ALIASES = new Map([
  ['pt', 'pt'],
  ['pt-pt', 'pt'],
  ['pt-br', 'pt'],
  ['portuguese', 'pt'],
  ['português', 'pt'],
  ['pt_br', 'pt'],
  ['en', 'en'],
  ['en-us', 'en'],
  ['en-gb', 'en'],
  ['english', 'en'],
  ['inglês', 'en'],
  ['en_us', 'en']
]);

const LANGUAGE_LABELS = {
  pt: 'Português',
  en: 'Inglês'
};

const TRANSLATION_FILES = {
  pt: path.join(__dirname, '..', 'i18n', 'pt.json'),
  en: path.join(__dirname, '..', 'i18n', 'en.json')
};

const TRANSLATIONS = SUPPORTED_LANGUAGES.reduce((acc, language) => {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const dictionary = require(TRANSLATION_FILES[language]);
    acc[language] = dictionary && typeof dictionary === 'object' ? dictionary : {};
  } catch (err) {
    acc[language] = {};
  }
  return acc;
}, {});

const PORTUGUESE_TOKEN_SET = new Set([
  'olá',
  'obrigado',
  'obrigada',
  'obrigados',
  'reserva',
  'alojamento',
  'hóspede',
  'hospede',
  'chegada',
  'saída',
  'saida',
  'disponibilidade',
  'por',
  'favor',
  'bom',
  'dia',
  'noite',
  'amanhã',
  'amanha',
  'ficar',
  'check-in',
  'checkin'
]);

const ENGLISH_TOKEN_SET = new Set([
  'hello',
  'hi',
  'thanks',
  'thank',
  'please',
  'booking',
  'stay',
  'guest',
  'check-in',
  'checkin',
  'arrival',
  'depart',
  'night',
  'nights',
  'support',
  'call',
  'help',
  'thanks!',
  'kind'
]);

const PORTUGUESE_PATTERNS = [
  { pattern: /[ãõáàâéêíóôúç]/i, score: 2 },
  { pattern: /\b(obrigad[oa]s?)\b/i, score: 3 },
  { pattern: /\b(boa\s+(tarde|noite|entrada))\b/i, score: 1.5 },
  { pattern: /\b(confirmada?|disponível|chegada|saída)\b/i, score: 1 }
];

const ENGLISH_PATTERNS = [
  { pattern: /\b(thank(s| you))\b/i, score: 2.5 },
  { pattern: /\b(please|could you|we would|let me know)\b/i, score: 1.5 },
  { pattern: /\b(hi|hello|good (morning|afternoon|evening))\b/i, score: 1.2 },
  { pattern: /\b(check[- ]?in|check[- ]?out|stay|booking)\b/i, score: 1 }
];

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .match(/[a-zà-öø-ÿ]+/gi);
}

function normalizeLanguage(input) {
  if (!input && input !== 0) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  const alias = LANGUAGE_ALIASES.get(raw);
  if (alias) return alias;
  const base = raw.split(/[-_]/)[0];
  if (SUPPORTED_LANGUAGES.includes(base)) {
    return base;
  }
  return null;
}

function detectLanguage(text, { minScore = 1 } = {}) {
  const content = typeof text === 'string' ? text : text ? String(text) : '';
  const sample = content.trim();
  if (!sample) return null;

  const scores = { pt: 0, en: 0 };

  const lower = sample.toLowerCase();
  PORTUGUESE_PATTERNS.forEach(({ pattern, score }) => {
    if (pattern.test(sample)) scores.pt += score;
  });
  ENGLISH_PATTERNS.forEach(({ pattern, score }) => {
    if (pattern.test(sample)) scores.en += score;
  });

  const tokens = tokenize(sample) || [];
  tokens.forEach(token => {
    if (PORTUGUESE_TOKEN_SET.has(token)) scores.pt += 1;
    if (ENGLISH_TOKEN_SET.has(token)) scores.en += 1;
  });

  // Short heuristics for common words
  if (/\b(e|de|para|que)\b/i.test(lower)) scores.pt += 0.15;
  if (/\b(the|you|for|we|can)\b/i.test(lower)) scores.en += 0.2;

  const ranked = Object.entries(scores)
    .map(([language, score]) => ({ language, score }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score < minScore) {
    return null;
  }
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    return null;
  }

  return ranked[0];
}

function getNested(dictionary, key) {
  if (!dictionary || typeof dictionary !== 'object') return null;
  const segments = String(key || '')
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (!segments.length) return null;
  let current = dictionary;
  for (const segment of segments) {
    if (current && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return null;
    }
  }
  return current;
}

function formatReplacements(template, replacements) {
  if (!template || typeof template !== 'string') return template;
  if (!replacements || typeof replacements !== 'object') return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) return match;
    const value = replacements[key];
    return value == null ? '' : String(value);
  });
}

function translate(key, { language, fallbackLanguage = 'pt', replacements } = {}) {
  const normalized = normalizeLanguage(language) || normalizeLanguage(fallbackLanguage) || 'pt';
  const fallback = normalizeLanguage(fallbackLanguage) || 'pt';
  const primaryDict = TRANSLATIONS[normalized] || {};
  const fallbackDict = TRANSLATIONS[fallback] || {};
  const raw = getNested(primaryDict, key) ?? getNested(fallbackDict, key);
  const value = raw == null ? key : raw;
  if (typeof value === 'string') {
    return formatReplacements(value, replacements);
  }
  return value;
}

function buildTranslator(language, options = {}) {
  const { fallbackLanguage = 'pt' } = options;
  const normalized = normalizeLanguage(language) || normalizeLanguage(fallbackLanguage) || 'pt';
  const fallback = normalizeLanguage(fallbackLanguage) || 'pt';
  return (key, replacements) => translate(key, { language: normalized, fallbackLanguage: fallback, replacements });
}

function lookupTranslations(language) {
  const normalized = normalizeLanguage(language);
  if (!normalized || !Object.prototype.hasOwnProperty.call(TRANSLATIONS, normalized)) {
    return {};
  }
  return TRANSLATIONS[normalized];
}

function createI18nService({ defaultLanguage = 'pt' } = {}) {
  const fallbackLanguage = normalizeLanguage(defaultLanguage) || 'pt';
  return {
    supportedLanguages: SUPPORTED_LANGUAGES.slice(),
    normalizeLanguage,
    detectLanguage,
    getLanguageLabel(language) {
      const normalized = normalizeLanguage(language);
      return normalized ? LANGUAGE_LABELS[normalized] || normalized.toUpperCase() : null;
    },
    defaultLanguage: fallbackLanguage,
    translate(key, options = {}) {
      return translate(key, { fallbackLanguage, ...options });
    },
    createTranslator(language, options = {}) {
      return buildTranslator(language, { fallbackLanguage, ...options });
    },
    getTranslations(language) {
      return lookupTranslations(language);
    }
  };
}

module.exports = {
  createI18nService,
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  normalizeLanguage,
  detectLanguage,
  getTranslations: lookupTranslations,
  createTranslator: buildTranslator,
  translate
};
