module.exports = async function emailAction(action = {}, payload = {}, context = {}) {
  const { emailTemplates, mailer, esc } = context;
  if (!emailTemplates || typeof emailTemplates.renderTemplate !== 'function') {
    throw new Error('Serviço de templates indisponível.');
  }
  if (!mailer || typeof mailer.sendMail !== 'function') {
    throw new Error('Serviço de email indisponível.');
  }

  const templateKey = typeof action.template === 'string' ? action.template.trim() : '';
  if (!templateKey) {
    throw new Error('Template de email não definido.');
  }

  const merge = { ...payload };
  if (action.variables && typeof action.variables === 'object') {
    Object.assign(merge, action.variables);
  }

  const rendered = emailTemplates.renderTemplate(templateKey, merge);
  if (!rendered) {
    throw new Error(`Template "${templateKey}" não encontrado.`);
  }

  const rawRecipients = action.to;
  const recipients = [];
  const pushAddress = (value) => {
    if (!value) return;
    const trimmed = String(value).trim();
    if (trimmed && /^.+@.+\..+$/.test(trimmed)) {
      recipients.push(trimmed);
    }
  };

  if (Array.isArray(rawRecipients)) {
    rawRecipients.forEach(pushAddress);
  } else if (typeof rawRecipients === 'string') {
    const lower = rawRecipients.trim().toLowerCase();
    if (lower === 'guest' && payload.guest_email) {
      pushAddress(payload.guest_email);
    } else if (lower === 'owner' && payload.owner_email) {
      pushAddress(payload.owner_email);
    } else if (lower === 'manager' && payload.manager_email) {
      pushAddress(payload.manager_email);
    } else if (lower.includes('@')) {
      pushAddress(lower);
    } else {
      String(rawRecipients)
        .split(/[,;]+/)
        .forEach(pushAddress);
    }
  }

  if (!recipients.length) {
    throw new Error('Nenhum destinatário válido para o email automático.');
  }

  const subject = rendered.subject || `Automação – ${templateKey}`;
  const htmlBody = rendered.body
    .split(/\n\s*\n/)
    .map(paragraph => `<p>${esc ? esc(paragraph) : paragraph}</p>`)
    .join('');

  await mailer.sendMail({
    to: recipients,
    subject,
    html: htmlBody,
    text: rendered.body,
  });

  return { recipients, template: templateKey };
};
