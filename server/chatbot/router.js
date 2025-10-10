'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { createChatbotBrain } = require('./brain');

function createChatbotRouter(context) {
  const {
    chatbotService,
    db,
    esc,
    html,
    csrfProtection,
  } = context;

  if (!chatbotService) {
    throw new Error('Chatbot service não inicializado.');
  }

  const brain = context.chatbotBrain || createChatbotBrain(context);

  const router = express.Router();
  const insertFeedbackStmt = db.prepare(
    `INSERT INTO kb_feedback (id, session_id, question, answer_given, chosen_kb_id, intent, confidence)
     VALUES (@id, @session_id, @question, @answer_given, @chosen_kb_id, @intent, @confidence)`
  );
  const updateFeedbackStmt = db.prepare(
    `UPDATE kb_feedback SET helpful = @helpful, notes = COALESCE(@notes, notes)
      WHERE id = @id`
  );

  function ensureSession(req, res) {
    chatbotService.expireOldSessions();
    const cookieId = req.cookies && req.cookies.cb_sid ? String(req.cookies.cb_sid) : '';
    let session = cookieId ? chatbotService.getSession(cookieId) : null;
    if (!session) {
      session = chatbotService.createSession({ intent: 'availability' }, null);
      res.cookie('cb_sid', session.id, {
        httpOnly: false,
        sameSite: 'Lax',
        maxAge: 1000 * 60 * 60 * 48,
      });
    }
    return session;
  }

  function renderMessage(role, body, extra = '') {
    const bubbleClass = role === 'user' ? 'chatbot-bubble is-user' : 'chatbot-bubble is-bot';
    return html`
      <div class="chatbot-message ${bubbleClass}">
        <div class="chatbot-message__body">${body}</div>
        ${extra}
      </div>`;
  }

  function renderFeedbackControls(feedbackId, csrfToken) {
    const positivePayload = JSON.stringify({ id: feedbackId, helpful: 1, _csrf: csrfToken }).replace(/"/g, '&quot;');
    const negativePayload = JSON.stringify({ id: feedbackId, helpful: 0, _csrf: csrfToken }).replace(/"/g, '&quot;');
    return html`
      <div class="chatbot-feedback" hx-target="this" hx-swap="outerHTML">
        <span>Foi útil?</span>
        <button type="button" class="chatbot-feedback__btn" hx-post="/chatbot/feedback" hx-vals="${positivePayload}">👍</button>
        <button type="button" class="chatbot-feedback__btn" hx-post="/chatbot/feedback" hx-vals="${negativePayload}">👎</button>
      </div>`;
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

    const csrfToken = req.body._csrf || (req.csrfToken ? req.csrfToken() : csrfProtection.ensureToken(req, res));

    if (!csrfProtection.validateRequest(req)) {
      return res.send(renderMessage('bot', 'Não foi possível validar o pedido. Atualize a página e tente novamente.'));
    }

    chatbotService.recordMessage(session.id, 'user', text);

    const result = brain.process({ session, text, propertyId: session.property_id || null, locale: 'pt', csrfToken });

    const nextState = {
      ...session.state,
      ...(result.nextState || {}),
    };
    chatbotService.saveSessionState(session.id, nextState);

    const feedbackId = randomUUID();
    const answerSummary = stripHtml(result.html);
    insertFeedbackStmt.run({
      id: feedbackId,
      session_id: session.id,
      question: text,
      answer_given: answerSummary,
      chosen_kb_id: result.kbRef,
      intent: result.intent,
      confidence: result.confidence,
    });

    chatbotService.recordMessage(session.id, 'assistant', answerSummary);

    const feedbackControls = renderFeedbackControls(feedbackId, csrfToken);
    const botMessage = renderMessage('bot', result.html, feedbackControls);

    res.send(renderMessage('user', esc(text)) + botMessage);
  });

  router.post('/feedback', (req, res) => {
    if (!csrfProtection.validateRequest(req)) {
      return res.send('<div class="chatbot-feedback">Token inválido, por favor tente novamente.</div>');
    }
    const feedbackId = req.body.id;
    if (!feedbackId) {
      return res.send('<div class="chatbot-feedback">Obrigado pelo feedback!</div>');
    }
    const helpful = String(req.body.helpful || '1') === '1' ? 1 : 0;
    const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 500) : null;
    updateFeedbackStmt.run({ id: feedbackId, helpful, notes });
    res.send('<div class="chatbot-feedback">Obrigado pelo feedback!</div>');
  });

  return router;
}

module.exports = { createChatbotRouter };
