const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || '');
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      const index = (value >>> (bits - 5)) & 31;
      output += BASE32_ALPHABET[index];
      bits -= 5;
    }
  }
  if (bits > 0) {
    const index = (value << (5 - bits)) & 31;
    output += BASE32_ALPHABET[index];
  }
  return output;
}

function decodeBase32(str) {
  if (!str) return Buffer.alloc(0);
  const input = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < input.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(input[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits > 0) {
    output.push((value << (8 - bits)) & 0xff);
  }
  return Buffer.from(output);
}

function randomBase32(length = 32) {
  const bytes = crypto.randomBytes(Math.ceil((length * 5) / 8));
  const encoded = encodeBase32(bytes);
  return encoded.slice(0, length);
}

function hotp(secret, counter, digits = 6) {
  const key = decodeBase32(secret);
  const buf = Buffer.alloc(8);
  const counterBig = BigInt(counter);
  buf.writeBigUInt64BE(counterBig);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const divisor = 10 ** Math.max(6, Math.min(10, digits));
  return String(code % divisor).padStart(digits, '0');
}

function totp(secret, { time = Date.now(), step = 30, digits = 6, epoch = 0 } = {}) {
  const counter = Math.floor((time - epoch) / (step * 1000));
  return hotp(secret, counter, digits);
}

function timingSafeEqual(expected, provided) {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyTotp(secret, token, { window = 1, step = 30, digits = 6, epoch = 0, time = Date.now() } = {}) {
  if (!secret || !token) return { valid: false };
  const normalized = String(token).trim().replace(/\s+/g, '');
  if (!/^\d{4,10}$/.test(normalized)) {
    return { valid: false };
  }
  const counter = Math.floor((time - epoch) / (step * 1000));
  const maxWindow = Math.max(0, Math.min(8, Number(window) || 0));
  for (let offset = -maxWindow; offset <= maxWindow; offset += 1) {
    const expected = hotp(secret, counter + offset, digits);
    if (timingSafeEqual(expected, normalized)) {
      return { valid: true, delta: offset, token: expected };
    }
  }
  return { valid: false };
}

function generateRecoveryCodes(count = 8) {
  const total = Math.max(4, Math.min(16, Number(count) || 0)) || 8;
  const codes = [];
  for (let i = 0; i < total; i += 1) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(raw);
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toLowerCase()).digest('hex');
}

function otpauthUrl({ secret, label, issuer }) {
  if (!secret) return '';
  const params = new URLSearchParams({ secret });
  if (issuer) params.set('issuer', issuer);
  const safeLabel = encodeURIComponent(label || 'Conta');
  return `otpauth://totp/${safeLabel}?${params.toString()}`;
}

module.exports = {
  BASE32_ALPHABET,
  encodeBase32,
  decodeBase32,
  randomBase32,
  hotp,
  totp,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  otpauthUrl,
  timingSafeEqual
};
