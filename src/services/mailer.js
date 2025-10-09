const net = require('node:net');
const tls = require('node:tls');

function createMailer(options = {}) {
  const { env = process.env, logger = console } = options;
  const config = {
    host: env.SMTP_HOST ? String(env.SMTP_HOST).trim() : '',
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' || env.SMTP_SECURE === '1' : false,
    user: env.SMTP_USER ? String(env.SMTP_USER).trim() : '',
    pass: env.SMTP_PASS ? String(env.SMTP_PASS).trim() : '',
    from: env.MAIL_FROM ? String(env.MAIL_FROM).trim() : 'Reservas <reservas@example.com>',
    helloName: env.SMTP_HELO ? String(env.SMTP_HELO).trim() : 'gestor-app.local',
    timeoutMs: env.SMTP_TIMEOUT ? Number(env.SMTP_TIMEOUT) : 10000
  };

  const isConfigured = Boolean(config.host);

  if (!isConfigured && logger && typeof logger.info === 'function') {
    logger.info('Mailer em modo demonstração (SMTP não configurado). Os emails serão registados na consola.');
  }

  function getDefaultFrom() {
    return config.from;
  }

  function normalizeNewlines(body = '') {
    return String(body).replace(/\r?\n/g, '\r\n');
  }

  function stripHtml(html = '') {
    return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseRecipients(value) {
    if (Array.isArray(value)) {
      return value.map(v => String(v || '').trim()).filter(Boolean);
    }
    return String(value || '')
      .split(/[,;]+/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function extractAddress(address = '') {
    const match = String(address).match(/<([^>]+)>/);
    if (match && match[1]) return match[1].trim();
    return String(address).trim();
  }

  function buildMessage({ from, to, subject, text, html }) {
    const hasHtml = typeof html === 'string' && html.trim().length;
    const hasText = typeof text === 'string' && text.trim().length;
    const contentType = hasHtml && !hasText ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    const body = hasHtml && !hasText ? html : hasText ? text : stripHtml(html || text || '');

    const headers = [
      `From: ${from}`,
      `To: ${to.join(', ')}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: ${contentType}`
    ];

    return normalizeNewlines(`${headers.join('\r\n')}\r\n\r\n${body}`);
  }

  function readReply(socket) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const lines = [];
      const onData = chunk => {
        buffer += chunk.toString('utf8');
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.slice(0, index + 1);
          buffer = buffer.slice(index + 1);
          const line = rawLine.replace(/\r?\n$/, '');
          if (!line) continue;
          lines.push(line);
          if (/^\d{3} /.test(line)) {
            cleanup();
            resolve({ code: Number(line.slice(0, 3)), lines });
            return;
          }
        }
      };
      const onError = err => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Ligação SMTP terminada inesperadamente.'));
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error('Ligação SMTP expirou.'));
      };
      function cleanup() {
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
        socket.off('timeout', onTimeout);
      }
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
      socket.once('timeout', onTimeout);
    });
  }

  async function sendCommand(socket, command, expectCodes) {
    if (command) {
      socket.write(`${command}\r\n`);
    }
    const reply = await readReply(socket);
    if (expectCodes) {
      const allowed = Array.isArray(expectCodes) ? expectCodes : [expectCodes];
      if (!allowed.includes(reply.code)) {
        throw new Error(`Resposta SMTP inesperada (${reply.code}): ${reply.lines.join(' | ')}`);
      }
    }
    return reply;
  }

  async function deliver(message) {
    const port = config.port || (config.secure ? 465 : 587);
    const socket = config.secure
      ? tls.connect({ host: config.host, port, servername: config.host })
      : net.connect({ host: config.host, port });

    socket.setTimeout(config.timeoutMs);

    try {
      await sendCommand(socket, null, 220);
      await sendCommand(socket, `EHLO ${config.helloName}`, 250);

      if (config.user && config.pass) {
        await sendCommand(socket, 'AUTH LOGIN', 334);
        await sendCommand(socket, Buffer.from(config.user).toString('base64'), 334);
        await sendCommand(socket, Buffer.from(config.pass).toString('base64'), 235);
      }

      await sendCommand(socket, `MAIL FROM:<${extractAddress(message.from)}>`, [250, 251]);
      for (const recipient of message.to) {
        await sendCommand(socket, `RCPT TO:<${extractAddress(recipient)}>`, [250, 251]);
      }

      await sendCommand(socket, 'DATA', 354);
      socket.write(`${message.data}\r\n.\r\n`);
      await sendCommand(socket, null, 250);
      await sendCommand(socket, 'QUIT', [221, 250]);
    } finally {
      socket.end();
    }
  }

  async function sendMail(message = {}) {
    const toList = parseRecipients(message.to);
    if (!toList.length) {
      throw new Error('sendMail requer pelo menos um destinatário.');
    }
    const subject = String(message.subject || '').trim();
    if (!subject) {
      throw new Error('sendMail requer um assunto.');
    }

    const text = typeof message.text === 'string' ? message.text : '';
    const html = typeof message.html === 'string' ? message.html : '';
    const fromAddress = message.from ? String(message.from).trim() : config.from;

    const payload = {
      from: fromAddress,
      to: toList,
      subject,
      text,
      html,
      data: buildMessage({ from: fromAddress, to: toList, subject, text, html })
    };

    if (!isConfigured) {
      if (logger && typeof logger.info === 'function') {
        logger.info(`Email simulado para ${toList.join(', ')} com assunto "${subject}".`);
      }
      if (logger && typeof logger.debug === 'function') {
        logger.debug(payload.data);
      }
      return true;
    }

    try {
      await deliver(payload);
      return true;
    } catch (err) {
      if (logger && typeof logger.error === 'function') {
        logger.error('Falha ao enviar email via SMTP:', err.message);
      }
      throw err;
    }
  }

  return {
    sendMail,
    getDefaultFrom,
    isConfigured
  };
}

module.exports = { createMailer };
