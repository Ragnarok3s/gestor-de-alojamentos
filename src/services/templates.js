'use strict';

const { LANGUAGE_LABELS: I18N_LABELS } = require('./i18n');

const LANGUAGE_LABELS = {
  ...I18N_LABELS
};

const LANGUAGE_ORDER = new Map([
  ['pt', 0],
  ['en', 1]
]);

const DEFAULT_FALLBACK_LANGUAGES = ['en', 'pt'];

const TEMPLATE_DEFINITIONS = [
  {
    key: 'booking_confirmation',
    name: 'Confirmação de reserva (mensagem)',
    description: 'Mensagem curta enviada ao hóspede quando a reserva fica confirmada.',
    placeholders: [
      { key: 'guest_first_name', label: 'Primeiro nome do hóspede' },
      { key: 'property_name', label: 'Nome da propriedade' },
      { key: 'unit_name', label: 'Nome da unidade reservada' },
      { key: 'checkin', label: 'Data de check-in (DD/MM/AAAA)' },
      { key: 'checkout', label: 'Data de check-out (DD/MM/AAAA)' },
      { key: 'nights', label: 'Número de noites' },
      { key: 'door_code', label: 'Código de acesso ou chave' },
      { key: 'support_phone', label: 'Contacto telefónico de apoio' },
      { key: 'brand_name', label: 'Nome da marca configurada' }
    ],
    defaults: {
      pt: `Olá {{guest_first_name}},\n\nA reserva para {{property_name}} de {{checkin}} a {{checkout}} ({{nights}} noite(s)) está confirmada.\n\nCódigo de acesso: {{door_code}}.\nAssistência: {{support_phone}}.\n\nAté breve,\n{{brand_name}}`,
      en: `Hi {{guest_first_name}},\n\nYour stay at {{property_name}} from {{checkin}} to {{checkout}} ({{nights}} night(s)) is confirmed.\n\nDoor code: {{door_code}}.\nSupport: {{support_phone}}.\n\nSee you soon,\n{{brand_name}}`
    },
    sampleVariables: {
      guest_first_name: 'Ana',
      property_name: 'Casa da Ribeira',
      unit_name: 'Suite Jardim',
      checkin: '12/08/2025',
      checkout: '15/08/2025',
      nights: '3',
      door_code: '4829',
      support_phone: '+351 910 000 000',
      brand_name: 'Casas de Pousadouro'
    }
  },
  {
    key: 'pre_checkin_reminder',
    name: 'Lembrete de check-in',
    description: 'Enviado automaticamente algumas horas antes da chegada para partilhar horários e apoio.',
    placeholders: [
      { key: 'guest_first_name', label: 'Primeiro nome do hóspede' },
      { key: 'checkin_time', label: 'Hora de check-in formatada' },
      { key: 'checkin', label: 'Data de check-in (DD/MM/AAAA)' },
      { key: 'support_phone', label: 'Contacto telefónico de apoio' },
      { key: 'unit_name', label: 'Nome da unidade reservada' },
      { key: 'welcome_link', label: 'Ligação para guia de boas-vindas' },
      { key: 'brand_name', label: 'Nome da marca configurada' }
    ],
    defaults: {
      pt: `Olá {{guest_first_name}},\n\nEstamos quase a receber-te! O check-in abre às {{checkin_time}} do dia {{checkin}}.\n\nSe precisares de ajuda liga para {{support_phone}}.\nPrepara-te para ficar na {{unit_name}} – deixámos todas as indicações em {{welcome_link}}.\n\nAté já,\n{{brand_name}}`,
      en: `Hi {{guest_first_name}},\n\nWe are excited to host you soon! Check-in opens at {{checkin_time}} on {{checkin}}.\n\nIf you need anything call {{support_phone}}.\nEverything you need to know about {{unit_name}} is available at {{welcome_link}}.\n\nSee you soon,\n{{brand_name}}`
    },
    sampleVariables: {
      guest_first_name: 'Alex',
      checkin_time: '15:00',
      checkin: '12/08/2025',
      support_phone: '+351 910 000 000',
      unit_name: 'Suite Rio',
      welcome_link: 'https://example.com/welcome',
      brand_name: 'Casas de Pousadouro'
    }
  },
  {
    key: 'review_request_post_checkout',
    name: 'Pedido de avaliação pós check-out',
    description: 'Mensagem enviada após a estadia para convidar o hóspede a deixar uma avaliação.',
    placeholders: [
      { key: 'guest_first_name', label: 'Primeiro nome do hóspede' },
      { key: 'property_name', label: 'Nome da propriedade' },
      { key: 'checkout', label: 'Data de check-out (DD/MM/AAAA)' },
      { key: 'review_link', label: 'Ligação para recolha de avaliação' },
      { key: 'brand_name', label: 'Nome da marca configurada' }
    ],
    defaults: {
      pt: `Olá {{guest_first_name}},\n\nEsperamos que tenhas gostado da estadia em {{property_name}} (check-out a {{checkout}}). Partilha a tua experiência connosco para continuarmos a melhorar.\n\nDeixa a tua avaliação aqui: {{review_link}}\n\nObrigado,\n{{brand_name}}`,
      en: `Hi {{guest_first_name}},\n\nWe hope you enjoyed your stay at {{property_name}} (check-out on {{checkout}}). We would love to hear how it went.\n\nShare your feedback here: {{review_link}}\n\nThank you,\n{{brand_name}}`
    },
    sampleVariables: {
      guest_first_name: 'Jamie',
      property_name: 'Casa da Ribeira',
      checkout: '15/08/2025',
      review_link: 'https://example.com/review/123',
      brand_name: 'Casas de Pousadouro'
    }
  }
];

const TEMPLATE_MAP = new Map(TEMPLATE_DEFINITIONS.map(def => [def.key, def]));

function sortLanguages(languages) {
  return languages.slice().sort((a, b) => {
    const orderA = LANGUAGE_ORDER.has(a) ? LANGUAGE_ORDER.get(a) : Number.MAX_SAFE_INTEGER;
    const orderB = LANGUAGE_ORDER.has(b) ? LANGUAGE_ORDER.get(b) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b, 'en');
  });
}

function sanitizeValue(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u2028\u2029]/g, ' ')
    .replace(/<\/?\s*script[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeVariables(variables, allowedKeys) {
  const safe = Object.create(null);
  if (!variables || typeof variables !== 'object') {
    return safe;
  }
  const allowed = new Set(allowedKeys || []);
  allowed.add('today');
  Object.keys(variables).forEach(key => {
    if (!allowed.has(key)) return;
    const value = variables[key];
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      safe[key] = sanitizeValue(value.join(', '));
      return;
    }
    switch (typeof value) {
      case 'number':
      case 'boolean':
        safe[key] = sanitizeValue(String(value));
        break;
      case 'string':
        safe[key] = sanitizeValue(value);
        break;
      default:
        safe[key] = sanitizeValue(JSON.stringify(value));
    }
  });
  return safe;
}

function createMessageTemplateService({ db, dayjs, i18n }) {
  if (!db) {
    throw new Error('createMessageTemplateService requer acesso à base de dados.');
  }
  if (!i18n || typeof i18n.normalizeLanguage !== 'function' || typeof i18n.detectLanguage !== 'function') {
    throw new Error('createMessageTemplateService requer serviço de i18n.');
  }

  const insertStmt = db.prepare(
    `INSERT INTO message_templates(template_key, language, body, updated_by)
     VALUES (@template_key, @language, @body, @updated_by)`
  );
  const updateStmt = db.prepare(
    `UPDATE message_templates
        SET body = @body,
            updated_at = datetime('now'),
            updated_by = @updated_by
      WHERE template_key = @template_key AND language = @language`
  );
  const selectStmt = db.prepare(
    `SELECT mt.*, u.username AS updated_by_username
       FROM message_templates mt
  LEFT JOIN users u ON u.id = mt.updated_by
      WHERE mt.template_key = ? AND mt.language = ?
      LIMIT 1`
  );
  const listStmt = db.prepare(
    `SELECT mt.*, u.username AS updated_by_username
       FROM message_templates mt
  LEFT JOIN users u ON u.id = mt.updated_by`
  );

  function ensureDefaultTemplates() {
    const tx = db.transaction(() => {
      TEMPLATE_DEFINITIONS.forEach(def => {
        const defaults = def.defaults || {};
        sortLanguages(Object.keys(defaults)).forEach(language => {
          const normalized = i18n.normalizeLanguage(language);
          if (!normalized) return;
          const row = selectStmt.get(def.key, normalized);
          if (row) return;
          insertStmt.run({
            template_key: def.key,
            language: normalized,
            body: defaults[language],
            updated_by: null
          });
        });
      });
    });
    tx();
  }

  ensureDefaultTemplates();

  function fetchTemplateRecord(templateKey, language) {
    const definition = TEMPLATE_MAP.get(templateKey);
    if (!definition) return null;
    const normalizedLanguage = i18n.normalizeLanguage(language);
    if (!normalizedLanguage) return null;
    const row = selectStmt.get(templateKey, normalizedLanguage);
    if (row) {
      return {
        key: templateKey,
        language: normalizedLanguage,
        body: row.body,
        updated_at: row.updated_at || null,
        updated_by: row.updated_by_username || null,
        source: 'database'
      };
    }
    const defaults = definition.defaults || {};
    const fallbackBody = defaults[normalizedLanguage];
    if (fallbackBody == null) return null;
    return {
      key: templateKey,
      language: normalizedLanguage,
      body: fallbackBody,
      updated_at: null,
      updated_by: null,
      source: 'default'
    };
  }

  function listTemplates() {
    const rows = listStmt.all();
    const grouped = new Map();
    rows.forEach(row => {
      if (!grouped.has(row.template_key)) {
        grouped.set(row.template_key, new Map());
      }
      grouped.get(row.template_key).set(row.language, row);
    });

    return TEMPLATE_DEFINITIONS.map(def => {
      const stored = grouped.get(def.key) || new Map();
      const defaults = def.defaults || {};
      const languages = sortLanguages(Object.keys(defaults)).map(language => {
        const normalized = i18n.normalizeLanguage(language);
        if (!normalized) return null;
        const row = stored.get(normalized);
        const baseBody = row ? row.body : defaults[normalized];
        return {
          language: normalized,
          label: LANGUAGE_LABELS[normalized] || normalized.toUpperCase(),
          body: baseBody,
          updated_at: row ? row.updated_at || null : null,
          updated_by: row ? row.updated_by_username || null : null,
          is_default: !row,
          sampleVariables: def.sampleVariables || {}
        };
      });
      const filteredLanguages = languages.filter(Boolean);
      return {
        key: def.key,
        name: def.name,
        description: def.description || '',
        placeholders: def.placeholders || [],
        languages: filteredLanguages,
        sampleVariables: def.sampleVariables || {}
      };
    });
  }

  function updateTemplate(templateKey, language, { body }, userId) {
    const definition = TEMPLATE_MAP.get(templateKey);
    if (!definition) {
      throw new Error('Modelo de mensagem desconhecido.');
    }
    const normalizedLanguage = i18n.normalizeLanguage(language);
    if (!normalizedLanguage || !(definition.defaults || {}).hasOwnProperty(normalizedLanguage)) {
      throw new Error('Idioma não suportado para este modelo.');
    }
    const normalizedBody = String(body || '').trim();
    if (!normalizedBody) {
      throw new Error('Mensagem não pode ficar vazia.');
    }
    const existing = fetchTemplateRecord(templateKey, normalizedLanguage);
    if (!existing) {
      throw new Error('Modelo de mensagem desconhecido.');
    }
    if (existing.source === 'default') {
      insertStmt.run({
        template_key: templateKey,
        language: normalizedLanguage,
        body: normalizedBody,
        updated_by: userId || null
      });
    } else {
      updateStmt.run({
        template_key: templateKey,
        language: normalizedLanguage,
        body: normalizedBody,
        updated_by: userId || null
      });
    }
    return fetchTemplateRecord(templateKey, normalizedLanguage);
  }

  function renderTemplate(templateKey, options = {}) {
    const definition = TEMPLATE_MAP.get(templateKey);
    if (!definition) return null;
    const defaults = definition.defaults || {};
    const availableLanguages = sortLanguages(Object.keys(defaults));
    if (!availableLanguages.length) return null;

    const fallbackLanguages = Array.isArray(options.fallbackLanguages)
      ? options.fallbackLanguages
          .map(code => i18n.normalizeLanguage(code))
          .filter(Boolean)
      : DEFAULT_FALLBACK_LANGUAGES.slice();

    const trySelect = candidate => {
      const normalized = i18n.normalizeLanguage(candidate);
      if (!normalized) return null;
      if (!availableLanguages.includes(normalized)) return null;
      return normalized;
    };

    let language = trySelect(options.language);
    let languageSource = language ? 'explicit' : null;
    let detectionResult = null;

    if (!language && options.guestLanguage) {
      const guestLang = trySelect(options.guestLanguage);
      if (guestLang) {
        language = guestLang;
        languageSource = 'guest';
      }
    }

    if (!language && options.sampleText) {
      detectionResult = i18n.detectLanguage(options.sampleText);
      if (detectionResult) {
        const detectedLang = trySelect(detectionResult.language);
        if (detectedLang) {
          language = detectedLang;
          languageSource = 'detected';
        }
      }
    }

    if (!language) {
      for (const fallback of fallbackLanguages) {
        const candidate = trySelect(fallback);
        if (candidate) {
          language = candidate;
          languageSource = 'fallback';
          break;
        }
      }
    }

    if (!language) {
      language = availableLanguages[0];
      languageSource = 'default';
    }

    const templateRecord = fetchTemplateRecord(templateKey, language);
    if (!templateRecord) {
      throw new Error('Modelo de mensagem desconhecido.');
    }

    const allowedKeys = (definition.placeholders || []).map(p => p.key);
    const safeVariables = sanitizeVariables(options.variables, allowedKeys);

    const baseBody = options.bodyOverride != null ? String(options.bodyOverride) : templateRecord.body;
    const placeholderRegex = /{{\s*([a-zA-Z0-9_\.]+)\s*}}/g;
    const output = String(baseBody).replace(placeholderRegex, (_, token) => {
      if (token === 'today' && dayjs) {
        return dayjs().format('DD/MM/YYYY');
      }
      if (!allowedKeys.includes(token)) {
        return '';
      }
      const value = safeVariables[token];
      return value == null ? '' : value;
    });

    return {
      body: output,
      language,
      languageLabel: LANGUAGE_LABELS[language] || language.toUpperCase(),
      languageSource,
      detectedLanguage: detectionResult,
      template: {
        key: templateKey,
        language,
        body: baseBody,
        placeholders: definition.placeholders || []
      }
    };
  }

  function getLanguageLabel(language) {
    const normalized = i18n.normalizeLanguage(language);
    if (!normalized) return null;
    return LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
  }

  return {
    ensureDefaultTemplates,
    listTemplates,
    getTemplate: fetchTemplateRecord,
    updateTemplate,
    renderTemplate,
    languageLabel: getLanguageLabel,
    definitions: TEMPLATE_DEFINITIONS,
    fallbackLanguages: DEFAULT_FALLBACK_LANGUAGES.slice()
  };
}

module.exports = {
  createMessageTemplateService,
  DEFAULT_FALLBACK_LANGUAGES,
  TEMPLATE_DEFINITIONS,
  LANGUAGE_LABELS
};
