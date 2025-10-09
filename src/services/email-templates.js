const TEMPLATE_DEFINITIONS = [
  {
    key: 'booking_pending_guest',
    name: 'Reserva recebida (pendente)',
    description:
      'Email enviado automaticamente ao hóspede assim que o pedido de reserva é recebido e fica a aguardar confirmação.',
    subject: 'Recebemos o seu pedido de reserva – {{property_name}}',
    body: `Olá {{guest_name}},\n\nRecebemos o seu pedido de reserva para {{property_name}} ({{unit_name}}).\nDatas: {{checkin}} - {{checkout}} ({{nights}} noite(s)).\nTotal estimado: € {{total_amount}}.\n\nO estado atual é {{status_label}} e será revisto pela nossa equipa.\nAssim que a reserva for confirmada receberá novo email.\n\nObrigado,\n{{brand_name}}`,
    placeholders: [
      { key: 'guest_name', label: 'Nome completo do hóspede' },
      { key: 'property_name', label: 'Nome da propriedade' },
      { key: 'unit_name', label: 'Nome da unidade reservada' },
      { key: 'checkin', label: 'Data de check-in (DD/MM/AAAA)' },
      { key: 'checkout', label: 'Data de check-out (DD/MM/AAAA)' },
      { key: 'nights', label: 'Número de noites' },
      { key: 'total_amount', label: 'Total formatado em euros' },
      { key: 'status_label', label: 'Estado atual da reserva' },
      { key: 'booking_reference', label: 'Identificador interno da reserva' },
      { key: 'booking_link', label: 'Ligação para acompanhar a reserva' },
      { key: 'brand_name', label: 'Nome da marca configurada' },
      { key: 'today', label: 'Data atual' }
    ]
  },
  {
    key: 'booking_confirmed_guest',
    name: 'Reserva confirmada',
    description: 'Enviado quando a reserva passa para confirmada por um membro autorizado da equipa.',
    subject: 'A sua reserva está confirmada – {{property_name}}',
    body: `Olá {{guest_name}},\n\nBoas notícias! A reserva para {{property_name}} ({{unit_name}}) encontra-se confirmada.\nDatas: {{checkin}} - {{checkout}} ({{nights}} noite(s)).\nTotal previsto: € {{total_amount}}.\n\nPode consultar todos os detalhes em {{booking_link}}.\nEstamos disponíveis para qualquer questão.\n\nAté breve,\n{{brand_name}}`,
    placeholders: [
      { key: 'guest_name', label: 'Nome completo do hóspede' },
      { key: 'property_name', label: 'Nome da propriedade' },
      { key: 'unit_name', label: 'Nome da unidade reservada' },
      { key: 'checkin', label: 'Data de check-in (DD/MM/AAAA)' },
      { key: 'checkout', label: 'Data de check-out (DD/MM/AAAA)' },
      { key: 'nights', label: 'Número de noites' },
      { key: 'total_amount', label: 'Total formatado em euros' },
      { key: 'booking_link', label: 'Ligação para acompanhar a reserva' },
      { key: 'brand_name', label: 'Nome da marca configurada' },
      { key: 'booking_reference', label: 'Identificador interno da reserva' },
      { key: 'today', label: 'Data atual' }
    ]
  }
];

const TEMPLATE_MAP = new Map(TEMPLATE_DEFINITIONS.map(item => [item.key, item]));

function safeParseMetadata(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function createEmailTemplateService({ db, dayjs }) {
  if (!db) {
    throw new Error('createEmailTemplateService requer acesso à base de dados.');
  }

  const insertTemplateStmt = db.prepare(
    `INSERT INTO email_templates(template_key, name, description, subject, body, metadata_json)
     VALUES (@template_key, @name, @description, @subject, @body, @metadata_json)`
  );
  const updateTemplateStmt = db.prepare(
    `UPDATE email_templates
        SET subject = @subject,
            body = @body,
            updated_at = datetime('now'),
            updated_by = @updated_by
      WHERE template_key = @template_key`
  );
  const upsertMetadataStmt = db.prepare(
    `UPDATE email_templates
        SET name = @name,
            description = @description,
            metadata_json = @metadata_json
      WHERE template_key = @template_key`
  );

  function ensureDefaultTemplates() {
    const existingKeys = new Set(
      db
        .prepare('SELECT template_key FROM email_templates')
        .all()
        .map(row => row.template_key)
    );

    const tx = db.transaction(() => {
      TEMPLATE_DEFINITIONS.forEach(def => {
        const metadata = JSON.stringify({ placeholders: def.placeholders });
        if (existingKeys.has(def.key)) {
          upsertMetadataStmt.run({
            template_key: def.key,
            name: def.name,
            description: def.description,
            metadata_json: metadata
          });
          return;
        }
        insertTemplateStmt.run({
          template_key: def.key,
          name: def.name,
          description: def.description,
          subject: def.subject,
          body: def.body,
          metadata_json: metadata
        });
      });
    });

    tx();
  }

  ensureDefaultTemplates();

  function listTemplates() {
    const rows = db
      .prepare(
        `SELECT t.*, u.username AS updated_by_username
           FROM email_templates t
      LEFT JOIN users u ON u.id = t.updated_by
          ORDER BY t.name`
      )
      .all();

    return rows.map(row => {
      const definition = TEMPLATE_MAP.get(row.template_key) || {};
      const metadata = safeParseMetadata(row.metadata_json);
      const placeholders = Array.isArray(metadata.placeholders)
        ? metadata.placeholders
        : definition.placeholders || [];
      return {
        key: row.template_key,
        name: row.name || definition.name || row.template_key,
        description: row.description || definition.description || '',
        subject: row.subject,
        body: row.body,
        placeholders,
        updated_at: row.updated_at || null,
        updated_by: row.updated_by_username || null
      };
    });
  }

  function getTemplateByKey(templateKey) {
    const row = db
      .prepare('SELECT * FROM email_templates WHERE template_key = ? LIMIT 1')
      .get(templateKey);
    if (row) {
      return row;
    }
    const def = TEMPLATE_MAP.get(templateKey);
    if (!def) return null;
    return {
      template_key: def.key,
      name: def.name,
      description: def.description,
      subject: def.subject,
      body: def.body,
      metadata_json: JSON.stringify({ placeholders: def.placeholders || [] }),
      updated_at: null,
      updated_by: null
    };
  }

  function renderTemplate(templateKey, variables = {}) {
    const template = getTemplateByKey(templateKey);
    if (!template) return null;

    const replace = value =>
      String(value != null ? value : '').replace(/<\\/script>/gi, '<\\/script>');

    const applyPlaceholders = input => {
      if (!input) return '';
      return String(input).replace(/{{\s*([a-zA-Z0-9_\.]+)\s*}}/g, (_, token) => {
        let replacement = variables[token];
        if (replacement == null && token === 'today' && dayjs) {
          replacement = dayjs().format('DD/MM/YYYY');
        }
        return replacement == null ? '' : replace(replacement);
      });
    };

    return {
      subject: applyPlaceholders(template.subject),
      body: applyPlaceholders(template.body),
      template
    };
  }

  function updateTemplate(templateKey, { subject, body }, userId) {
    const normalizedSubject = String(subject || '').trim();
    const normalizedBody = String(body || '').trim();
    if (!normalizedSubject) throw new Error('Assunto não pode ficar vazio.');
    if (!normalizedBody) throw new Error('Mensagem não pode ficar vazia.');

    const existing = getTemplateByKey(templateKey);
    if (!existing) throw new Error('Modelo de email desconhecido.');

    updateTemplateStmt.run({
      template_key: templateKey,
      subject: normalizedSubject,
      body: normalizedBody,
      updated_by: userId || null
    });

    return getTemplateByKey(templateKey);
  }

  return {
    ensureDefaultTemplates,
    listTemplates,
    getTemplateByKey,
    renderTemplate,
    updateTemplate,
    definitions: TEMPLATE_DEFINITIONS
  };
}

module.exports = {
  createEmailTemplateService,
  TEMPLATE_DEFINITIONS
};
