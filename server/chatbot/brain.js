'use strict';

const { parseMessage, normalizeText } = require('./parser');
const { createAvailabilityHandler } = require('./handlers/availability');
const { createPricingHandler } = require('./handlers/pricing');
const { createPoliciesHandler } = require('./handlers/policies');
const { createAmenitiesHandler } = require('./handlers/amenities');
const { createLocationHandler } = require('./handlers/location');
const { createContactHandler } = require('./handlers/contact');

const STOPWORDS_PT = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'um', 'uma', 'para', 'por', 'que', 'com', 'no', 'na', 'nos', 'nas',
  'em', 'se', 'qual', 'quais', 'quando', 'onde', 'como', 'porque', 'quanto', 'quantos', 'quantas', 'qualquer', 'ser', 'estar',
  'ter', 'tem', 'tens', 'preciso', 'precisa', 'precisamos', 'quero', 'queria', 'queremos', 'gostava', 'pode', 'podes'
]);

const ALLOWED_TAGS = new Set(['p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'a', 'br']);

function createChatbotBrain(context) {
  const { db, dayjs, esc, html, unitAvailable, rateQuote } = context;
  if (!db || !dayjs || !esc || !html) {
    throw new Error('createChatbotBrain requer db, dayjs, esc e html.');
  }

  const availabilityHandler = createAvailabilityHandler({ db, dayjs, html, esc, unitAvailable, rateQuote });
  const pricingHandler = createPricingHandler({ availabilityHandler });
  const policiesHandler = createPoliciesHandler({ db, esc });
  const amenitiesHandler = createAmenitiesHandler({ db, esc });
  const locationHandler = createLocationHandler({ db, esc });
  const contactHandler = createContactHandler({ db, esc });

  const selectSynonyms = db.prepare(
    `SELECT canonical, variants FROM kb_synonyms WHERE locale = ?`
  );
  const selectQa = db.prepare(
    `SELECT id, locale, property_id, answer_template, tags, confidence_base
       FROM kb_qas
      WHERE id = ? AND is_published = 1`
  );
  const selectArticle = db.prepare(
    `SELECT id, locale, property_id, title, body, tags
       FROM kb_articles
      WHERE id = ? AND is_published = 1`
  );
  const selectProperty = db.prepare(
    `SELECT id, name, location, address FROM properties WHERE id = ?`
  );
  const selectPolicy = db.prepare(
    `SELECT checkin_from, checkout_until, pets_allowed, pets_fee, cancellation_policy, parking_info, children_policy, payment_methods, quiet_hours, extras
       FROM property_policies WHERE property_id = ?`
  );

  const searchKb = db.prepare(
    `SELECT ref, locale, property_id, title, content, tags, bm25(kb_index) AS score
       FROM kb_index
      WHERE kb_index MATCH ?
        AND locale = ?
        AND (property_id = '' OR property_id IS NULL OR property_id = @propertyId)
      ORDER BY score ASC
      LIMIT 5`
  );

  const synonymsCache = new Map();

  function expandSynonyms(locale, tokens) {
    if (!synonymsCache.has(locale)) {
      const variants = selectSynonyms.all(locale);
      const mapping = new Map();
      variants.forEach(row => {
        try {
          const parsed = JSON.parse(row.variants || '[]');
          parsed.forEach(variant => {
            mapping.set(String(variant).toLowerCase(), row.canonical.toLowerCase());
          });
          mapping.set(row.canonical.toLowerCase(), row.canonical.toLowerCase());
        } catch (_) {
          mapping.set(row.canonical.toLowerCase(), row.canonical.toLowerCase());
        }
      });
      synonymsCache.set(locale, mapping);
    }
    const mapping = synonymsCache.get(locale);
    const expanded = new Set(tokens);
    tokens.forEach(token => {
      const canonical = mapping.get(token);
      if (canonical) {
        expanded.add(canonical);
      }
    });
    return Array.from(expanded);
  }

  function tokenize(locale, text) {
    const normalized = normalizeText(text || '');
    const rawTokens = normalized
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const filtered = rawTokens.filter(token => !STOPWORDS_PT.has(token));
    return expandSynonyms(locale, filtered);
  }

  function detectIntent(normalized) {
    if (/quanto custa|preco|preço|tarifa|valor/.test(normalized)) return 'pricing';
    if (/disponibil|vagas|livre|tem quarto/.test(normalized)) return 'availability';
    if (/check.?in|check.?out|cancel|politica|política|regras/.test(normalized)) return 'policies';
    if (/animal|pet|piscina|wifi|amenidade|comodidade|servico|berco|crian/.test(normalized)) return 'amenities';
    if (/onde|local|morada|direc|perto|chegar/.test(normalized)) return 'location';
    if (/contact|telefone|email|whatsapp|falar/.test(normalized)) return 'contact';
    return 'kb';
  }

  function scoreToConfidence(score, base = 0.7) {
    if (score <= 1) return Math.min(1, base + 0.25);
    if (score <= 2.2) return Math.min(1, base + 0.15);
    if (score <= 4) return Math.min(1, base);
    if (score <= 7) return Math.max(0.45, base - 0.1);
    return Math.max(0.3, base - 0.2);
  }

  function sanitizeMarkup(raw) {
    return String(raw || '').replace(/<([^>]+)>/g, (match, inner) => {
      const lower = inner.trim().toLowerCase();
      if (lower.startsWith('!')) return '';
      if (lower.startsWith('/')) {
        const closingTag = lower.slice(1).split(/[\s>]/)[0];
        return ALLOWED_TAGS.has(closingTag) ? `</${closingTag}>` : '';
      }
      const tag = lower.split(/\s+/)[0];
      if (!ALLOWED_TAGS.has(tag)) {
        return '';
      }
      if (tag === 'a') {
        const hrefMatch = inner.match(/href\s*=\s*"([^"]+)"/i);
        const href = hrefMatch && /^https?:/i.test(hrefMatch[1]) ? hrefMatch[1] : '#';
        return `<a href="${href}" target="_blank" rel="noopener">`;
      }
      return `<${tag}>`;
    });
  }

  function buildTemplateContext({ propertyId, parsedMessage }) {
    const contextMap = {};
    if (propertyId) {
      const property = selectProperty.get(propertyId);
      if (property) {
        contextMap.property_name = property.name;
        contextMap.property_location = property.location || property.address || '';
      }
      const policy = selectPolicy.get(propertyId);
      if (policy) {
        let extras = null;
        if (policy.extras) {
          try {
            extras = JSON.parse(policy.extras);
          } catch (_) {
            extras = null;
          }
        }
        Object.assign(contextMap, {
          checkin_from: policy.checkin_from || '',
          checkout_until: policy.checkout_until || '',
          pets_allowed: policy.pets_allowed,
          pets_fee: policy.pets_fee,
          cancellation_policy: policy.cancellation_policy || '',
          parking_info: policy.parking_info || '',
          children_policy: policy.children_policy || '',
          payment_methods: policy.payment_methods || '',
          quiet_hours: policy.quiet_hours || '',
          extras,
        });
      }
    }
    if (parsedMessage) {
      if (parsedMessage.checkin) {
        contextMap.date_in = parsedMessage.checkin.format('YYYY-MM-DD');
      }
      if (parsedMessage.checkout) {
        contextMap.date_out = parsedMessage.checkout.format('YYYY-MM-DD');
      }
      if (parsedMessage.guests) {
        contextMap.adults = parsedMessage.guests;
      }
    }
    return contextMap;
  }

  function resolveVariable(contextMap, key) {
    if (Object.prototype.hasOwnProperty.call(contextMap, key)) {
      return contextMap[key];
    }
    return undefined;
  }

  function applyTemplate(rawTemplate, contextMap) {
    if (!rawTemplate) return '';
    let template = rawTemplate;

    template = template.replace(/{{#if\s+([a-zA-Z0-9_]+)}}([\s\S]*?){{\/if}}/g, (match, key, body) => {
      const value = resolveVariable(contextMap, key);
      return value ? body : '';
    });

    template = template.replace(/{{#unless\s+([a-zA-Z0-9_]+)}}([\s\S]*?){{\/unless}}/g, (match, key, body) => {
      const value = resolveVariable(contextMap, key);
      return value ? '' : body;
    });

    template = template.replace(/{{([a-zA-Z0-9_]+)(\|[^}]+)?}}/g, (match, key, fallback) => {
      let value = resolveVariable(contextMap, key);
      if (value == null || value === '') {
        if (fallback) {
          return esc(fallback.slice(1));
        }
        return '';
      }
      if (typeof value === 'number') {
        return esc(value.toString());
      }
      if (typeof value === 'boolean') {
        return value ? 'sim' : 'não';
      }
      return esc(String(value));
    });

    return sanitizeMarkup(template);
  }

  function renderArticleSnippet(article) {
    const safeBody = sanitizeMarkup(article.body.slice(0, 600));
    return `<article class="chatbot-article"><h4>${esc(article.title)}</h4><div>${safeBody}</div></article>`;
  }

  function buildClarifications(locale, text, propertyId) {
    const tokens = tokenize(locale, text);
    if (!tokens.length) return [];
    const query = tokens.map(token => `${token}*`).join(' ');
    const rows = searchKb.all({ query, locale, propertyId: propertyId ? String(propertyId) : '' });
    return rows.slice(0, 3).map(row => {
      const label = row.title.slice(0, 80);
      return {
        ref: row.ref,
        label,
      };
    });
  }

  function process({ session, text, propertyId, locale = 'pt', csrfToken }) {
    const normalized = normalizeText(text || '');
    const parsedMessage = parseMessage(dayjs, text || '');
    const intent = detectIntent(normalized);
    const tokens = tokenize(locale, text || '');

    if (intent === 'availability' || intent === 'pricing') {
      const handlerPayload = {
        checkin: parsedMessage.checkin ? parsedMessage.checkin.format('YYYY-MM-DD') : session.state.checkin,
        checkout: parsedMessage.checkout ? parsedMessage.checkout.format('YYYY-MM-DD') : session.state.checkout,
        guests: parsedMessage.guests || session.state.guests,
        propertyId: propertyId || session.property_id || null,
      };
      if (!handlerPayload.checkin && session.state.checkin) handlerPayload.checkin = session.state.checkin;
      if (!handlerPayload.checkout && session.state.checkout) handlerPayload.checkout = session.state.checkout;
      if (!handlerPayload.guests && session.state.guests) handlerPayload.guests = session.state.guests;
      const handler = intent === 'availability' ? availabilityHandler : pricingHandler;
      const result = handler.handle(handlerPayload);
      return {
        html: result.html,
        confidence: result.confidence,
        intent,
        nextState: {
          checkin: handlerPayload.checkin,
          checkout: handlerPayload.checkout,
          guests: handlerPayload.guests,
          intent,
        },
        kbRef: null,
        clarifications: [],
      };
    }

    if (intent === 'policies') {
      const result = policiesHandler.handle({ propertyId: propertyId || session.property_id || null });
      return { html: result.html, confidence: result.confidence, intent, nextState: { intent: 'availability' }, kbRef: null, clarifications: [] };
    }
    if (intent === 'amenities') {
      const result = amenitiesHandler.handle({ propertyId: propertyId || session.property_id || null });
      return { html: result.html, confidence: result.confidence, intent, nextState: { intent: 'availability' }, kbRef: null, clarifications: [] };
    }
    if (intent === 'location') {
      const result = locationHandler.handle({ propertyId: propertyId || session.property_id || null });
      return { html: result.html, confidence: result.confidence, intent, nextState: { intent: 'availability' }, kbRef: null, clarifications: [] };
    }
    if (intent === 'contact') {
      const result = contactHandler.handle({ propertyId: propertyId || session.property_id || null });
      return { html: result.html, confidence: result.confidence, intent, nextState: { intent: 'availability' }, kbRef: null, clarifications: [] };
    }

    if (!tokens.length) {
      return {
        html: '<p>Preciso de mais detalhes para encontrar a resposta certa. Pode reformular a pergunta?</p>',
        confidence: 0.3,
        intent,
        nextState: { intent: 'kb' },
        kbRef: null,
        clarifications: [],
      };
    }

    const query = tokens.map(token => `${token}*`).join(' ');
    const rows = searchKb.all({ query, locale, propertyId: propertyId ? String(propertyId) : '' });
    let bestAnswer = null;
    let bestConfidence = 0;

    rows.forEach(row => {
      if (!row.ref) return;
      if (row.ref.startsWith('QA:')) {
        const qa = selectQa.get(row.ref.slice(3));
        if (!qa) return;
        const contextMap = buildTemplateContext({ propertyId: qa.property_id || propertyId || session.property_id || null, parsedMessage });
        const rendered = applyTemplate(qa.answer_template, contextMap);
        const confidence = scoreToConfidence(row.score, qa.confidence_base || 0.7);
        if (confidence > bestConfidence) {
          bestAnswer = { html: rendered, ref: row.ref, kind: 'QA' };
          bestConfidence = confidence;
        }
      } else if (row.ref.startsWith('ART:')) {
        const article = selectArticle.get(row.ref.slice(4));
        if (!article) return;
        const confidence = scoreToConfidence(row.score, 0.65);
        if (confidence > bestConfidence) {
          bestAnswer = { html: renderArticleSnippet(article), ref: row.ref, kind: 'ART' };
          bestConfidence = confidence;
        }
      }
    });

    if (!bestAnswer || bestConfidence < 0.65) {
      const clarifications = buildClarifications(locale, text, propertyId);
      const chips = clarifications
        .map(choice => {
          const payload = {
            text: choice.label,
          };
          if (csrfToken) payload._csrf = csrfToken;
          const payloadJson = JSON.stringify(payload).replace(/"/g, '&quot;');
          return `<button type="button" class="chatbot-chip" hx-post="/chatbot/message" hx-trigger="click" hx-vals="${payloadJson}" hx-target="#chatbot-conversation">${esc(choice.label)}</button>`;
        })
        .join('');
      const htmlReply = `<p>Não tenho a certeza. Pode escolher uma das opções ou reformular?</p>${chips ? `<div class="chatbot-clarify">${chips}</div>` : ''}`;
      return {
        html: htmlReply,
        confidence: bestConfidence || 0.4,
        intent,
        nextState: { intent: 'kb' },
        kbRef: bestAnswer ? bestAnswer.ref : null,
        clarifications,
      };
    }

    return {
      html: bestAnswer.html,
      confidence: bestConfidence,
      intent,
      nextState: { intent: 'availability' },
      kbRef: bestAnswer.ref,
      clarifications: [],
    };
  }

  return { process };
}

module.exports = { createChatbotBrain };
