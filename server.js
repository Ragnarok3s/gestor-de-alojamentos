const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
require('dayjs/locale/pt');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');
const multer = require('multer');
const ExcelJS = require('exceljs');
let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.warn('Dependência opcional "sharp" não encontrada; as imagens não serão comprimidas automaticamente até ser instalada.');
}
dayjs.extend(minMax);
dayjs.locale('pt');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const { createContext } = require('./src/context');
const registerFrontoffice = require('./src/frontoffice');
const registerBackoffice = require('./src/backoffice');
const path = require('path');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});

const context = createContext();
// ===================== DB =====================
const db = new Database('booking_engine.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 2,
  base_price_cents INTEGER NOT NULL DEFAULT 10000,
  features TEXT,
  description TEXT,
  UNIQUE(property_id, name)
);

/* Bookings: checkin incluído, checkout exclusivo (YYYY-MM-DD) */
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_nationality TEXT,
  guest_phone TEXT,
  agency TEXT,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,  /* inclusive */
  end_date TEXT NOT NULL,    /* exclusivo */
  weekday_price_cents INTEGER,
  weekend_price_cents INTEGER,
  min_stay INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unit_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  alt TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booking_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
db.exec(schema);

// Migrações leves
function ensureColumn(table, name, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
}
try {
  ensureColumn('bookings', 'guest_nationality', 'TEXT');
  ensureColumn('bookings', 'guest_phone', 'TEXT');
  ensureColumn('bookings', 'agency', 'TEXT');
  ensureColumn('bookings', 'adults', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('bookings', 'children', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('bookings', 'internal_notes', 'TEXT');
  ensureColumn('units', 'features', 'TEXT');
  ensureColumn('bookings', 'external_ref', 'TEXT');
  ensureColumn('bookings', 'updated_at', 'TEXT');
  ensureColumn('blocks', 'updated_at', 'TEXT');
  ensureColumn('unit_images', 'is_primary', 'INTEGER NOT NULL DEFAULT 0');
} catch (_) {}

const bookingColumns = db.prepare('PRAGMA table_info(bookings)').all();
const blockColumns = db.prepare('PRAGMA table_info(blocks)').all();
const hasBookingsUpdatedAt = bookingColumns.some(col => col.name === 'updated_at');
const hasBlocksUpdatedAt = blockColumns.some(col => col.name === 'updated_at');
if (!hasBookingsUpdatedAt) {
  console.warn('Aviso: bookings.updated_at não existe. Volte a executar as migrações para ativar auditoria completa.');
}
if (!hasBlocksUpdatedAt) {
  console.warn('Aviso: blocks.updated_at não existe. Volte a executar as migrações para ativar auditoria completa.');
}

const MASTER_ROLE = 'dev';

const ROLE_LABELS = {
  [MASTER_ROLE]: 'Desenvolvedor',
  rececao: 'Receção',
  gestao: 'Gestão',
  direcao: 'Direção'
};

const ROLE_PERMISSIONS = {
  rececao: new Set([
    'dashboard.view',
    'calendar.view',
    'calendar.reschedule',
    'calendar.cancel',
    'calendar.block.create',
    'calendar.block.delete',
    'bookings.view',
    'bookings.create',
    'bookings.edit',
    'bookings.cancel',
    'bookings.notes',
    'bookings.export',
    'automation.view'
  ]),
  gestao: new Set([
    'dashboard.view',
    'calendar.view',
    'calendar.reschedule',
    'calendar.cancel',
    'calendar.block.create',
    'calendar.block.delete',
    'calendar.block.manage',
    'bookings.view',
    'bookings.create',
    'bookings.edit',
    'bookings.cancel',
    'bookings.notes',
    'bookings.export',
    'properties.manage',
    'rates.manage',
    'gallery.manage',
    'automation.view',
    'automation.export',
    'audit.view'
  ]),
  direcao: new Set([
    'dashboard.view',
    'calendar.view',
    'calendar.reschedule',
    'calendar.cancel',
    'calendar.block.create',
    'calendar.block.delete',
    'calendar.block.manage',
    'bookings.view',
    'bookings.create',
    'bookings.edit',
    'bookings.cancel',
    'bookings.notes',
    'bookings.export',
    'properties.manage',
    'rates.manage',
    'gallery.manage',
    'automation.view',
    'automation.export',
    'audit.view',
    'users.manage',
    'logs.view'
  ])
};

const ALL_PERMISSIONS = new Set();
Object.values(ROLE_PERMISSIONS).forEach(set => {
  if (set && set.forEach) set.forEach(perm => ALL_PERMISSIONS.add(perm));
});
ROLE_PERMISSIONS[MASTER_ROLE] = new Set(ALL_PERMISSIONS);

function normalizeRole(role) {
  const key = String(role || '').toLowerCase();
  if (key === MASTER_ROLE || key === 'developer' || key === 'devmaster') return MASTER_ROLE;
  if (key === 'admin' || key === 'direcao' || key === 'direção') return 'direcao';
  if (key === 'gestor' || key === 'gestao' || key === 'gestão') return 'gestao';
  if (key === 'limpezas' || key === 'rececao' || key === 'receção' || key === 'recepcao' || key === 'recepção') return 'rececao';
  return 'rececao';
}

function buildUserContext(sessRow) {
  const role = normalizeRole(sessRow.role);
  const permissions = new Set(ROLE_PERMISSIONS[role] || []);
  return {
    id: sessRow.user_id,
    username: sessRow.username,
    role,
    role_label: ROLE_LABELS[role] || role,
    permissions
  };
}

function userCan(user, permission) {
  if (!user) return false;
  if (user.role === MASTER_ROLE) return true;
  return !!(user.permissions && user.permissions.has(permission));
}

const rescheduleBookingUpdateStmt = db.prepare(
  hasBookingsUpdatedAt
    ? "UPDATE bookings SET checkin = ?, checkout = ?, total_cents = ?, updated_at = datetime('now') WHERE id = ?"
    : 'UPDATE bookings SET checkin = ?, checkout = ?, total_cents = ? WHERE id = ?'
);
const rescheduleBlockUpdateStmt = db.prepare(
  hasBlocksUpdatedAt
    ? "UPDATE blocks SET start_date = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?"
    : 'UPDATE blocks SET start_date = ?, end_date = ? WHERE id = ?'
);
const insertBlockStmt = db.prepare(
  hasBlocksUpdatedAt
    ? "INSERT INTO blocks(unit_id, start_date, end_date, updated_at) VALUES (?, ?, ?, datetime('now'))"
    : 'INSERT INTO blocks(unit_id, start_date, end_date) VALUES (?, ?, ?)'
);
const adminBookingUpdateStmt = db.prepare(
  (hasBookingsUpdatedAt
    ? `
    UPDATE bookings
       SET checkin = ?, checkout = ?, adults = ?, children = ?, guest_name = ?, guest_email = ?, guest_phone = ?, guest_nationality = ?, agency = ?, internal_notes = ?, status = ?, total_cents = ?, updated_at = datetime('now')
     WHERE id = ?
  `
    : `
    UPDATE bookings
       SET checkin = ?, checkout = ?, adults = ?, children = ?, guest_name = ?, guest_email = ?, guest_phone = ?, guest_nationality = ?, agency = ?, internal_notes = ?, status = ?, total_cents = ?
     WHERE id = ?
  `
  ).trim()
);

function logSessionEvent(userId, action, req) {
  try {
    db.prepare(
      'INSERT INTO session_logs(user_id, action, ip, user_agent) VALUES (?,?,?,?)'
    ).run(userId || null, action, req ? req.ip : null, req ? (req.get('user-agent') || null) : null);
  } catch (err) {
    console.error('Erro ao registar sessão', err.message);
  }
}

function logActivity(actorId, action, entityType, entityId, meta) {
  try {
    db.prepare(
      'INSERT INTO activity_logs(user_id, action, entity_type, entity_id, meta_json) VALUES (?,?,?,?,?)'
    ).run(actorId || null, action, entityType || null, entityId || null, meta ? JSON.stringify(meta) : null);
  } catch (err) {
    console.error('Erro ao registar atividade', err.message);
  }
}

function logChange(actorId, entityType, entityId, action, beforeObj, afterObj) {
  try {
    db.prepare(
      'INSERT INTO change_logs(entity_type, entity_id, action, before_json, after_json, actor_id) VALUES (?,?,?,?,?,?)'
    ).run(
      entityType,
      entityId,
      action,
      beforeObj ? JSON.stringify(beforeObj) : null,
      afterObj ? JSON.stringify(afterObj) : null,
      actorId
    );
    logActivity(actorId, `change:${entityType}:${action}`, entityType, entityId, {
      before: beforeObj || null,
      after: afterObj || null
    });
  } catch (err) {
    console.error('Erro ao registar auditoria', err.message);
  }
}

// ===================== Automação Operacional =====================
const automationStateGetStmt = db.prepare('SELECT value FROM automation_state WHERE key = ?');
const automationStateUpsertStmt = db.prepare(
  "INSERT INTO automation_state(key,value,created_at,updated_at) VALUES (?,?,datetime('now'),datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
);

const selectAutomationUnitsStmt = db.prepare(
  `SELECT u.id, u.name, u.capacity, u.base_price_cents, p.name AS property_name
     FROM units u
     JOIN properties p ON p.id = u.property_id
    ORDER BY u.id`
);
const selectAutomationUpcomingBookingsStmt = db.prepare(
  `SELECT b.*, u.name AS unit_name, u.capacity, u.base_price_cents, u.property_id, p.name AS property_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     JOIN properties p ON p.id = u.property_id
    WHERE b.checkout > ?
      AND b.status IN ('CONFIRMED','PENDING')
    ORDER BY b.unit_id, b.checkin`
);
const selectAutomationBlocksExactStmt = db.prepare(
  'SELECT id FROM blocks WHERE unit_id = ? AND start_date = ? AND end_date = ?'
);
const selectAutomationBlockOverlapStmt = db.prepare(
  'SELECT id FROM blocks WHERE unit_id = ? AND NOT (end_date <= ? OR start_date >= ?)'
);
const selectAutomationBookingOverlapStmt = db.prepare(
  "SELECT id FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING') AND NOT (checkout <= ? OR checkin >= ?)"
);
const selectAutomationCancellationsStmt = db.prepare(
  "SELECT id, entity_id, before_json, created_at FROM change_logs WHERE entity_type = 'booking' AND action = 'cancel' ORDER BY id DESC LIMIT 12"
);
const selectOperationalUnitsStmt = db.prepare(
  `SELECT u.id, u.name, u.capacity, u.base_price_cents, u.features, u.property_id, p.name AS property_name
     FROM units u
     JOIN properties p ON p.id = u.property_id
    ORDER BY p.name, u.name`
);
const selectOperationalBookingsStmt = db.prepare(
  `SELECT b.id, b.unit_id, b.checkin, b.checkout, b.total_cents, b.status,
          u.name AS unit_name, u.capacity, u.features, u.property_id, p.name AS property_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     JOIN properties p ON p.id = u.property_id
    WHERE b.status = 'CONFIRMED'
      AND b.checkout > ?
      AND b.checkin < ?`
);

function readAutomationState(key) {
  const row = automationStateGetStmt.get(key);
  if (!row || row.value == null) return null;
  try {
    return JSON.parse(row.value);
  } catch (_) {
    return null;
  }
}

function writeAutomationState(key, payload) {
  try {
    automationStateUpsertStmt.run(key, JSON.stringify(payload || null));
  } catch (err) {
    console.error('Automação: erro ao guardar estado', err.message);
  }
}

const AUTO_CHAIN_THRESHOLD = 4;
const AUTO_CHAIN_CLEANUP_NIGHTS = 1;
const HOT_DEMAND_THRESHOLD = 0.7;

const AUTOMATION_SEVERITY_STYLES = {
  info: { border: 'border-sky-200', dot: 'text-sky-600', badge: 'bg-sky-100 text-sky-800' },
  warning: { border: 'border-amber-300', dot: 'text-amber-600', badge: 'bg-amber-100 text-amber-800' },
  danger: { border: 'border-rose-300', dot: 'text-rose-600', badge: 'bg-rose-100 text-rose-700' },
  success: { border: 'border-emerald-300', dot: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' }
};

function automationSeverityStyle(severity) {
  return AUTOMATION_SEVERITY_STYLES[severity] || AUTOMATION_SEVERITY_STYLES.info;
}

function formatDateRangeShort(start, endExclusive) {
  const startDay = dayjs(start);
  const endDay = dayjs(endExclusive).subtract(1, 'day');
  if (!endDay.isAfter(startDay)) return startDay.format('DD/MM');
  return `${startDay.format('DD/MM')} → ${endDay.format('DD/MM')}`;
}

function safeJsonParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

function isoWeekStart(dateLike) {
  const d = dayjs(dateLike);
  const diff = (d.day() + 6) % 7;
  return d.subtract(diff, 'day');
}

let automationCache = {
  lastRun: null,
  generatedBlocks: [],
  tariffSuggestions: [],
  notifications: [],
  summaries: { daily: [], weekly: [] },
  revenue: { next7: 0, next30: 0 },
  demandPeaks: [],
  metrics: { checkins48h: 0, longStays: 0, occupancyToday: 0 }
};

function runAutomationSweep(trigger = 'manual') {
  const started = dayjs();
  const today = started.format('YYYY-MM-DD');

  const units = selectAutomationUnitsStmt.all();
  const unitMap = new Map(units.map(u => [u.id, u]));
  const totalUnits = units.length;
  const upcomingActive = selectAutomationUpcomingBookingsStmt.all(today);

  const occupancyMap = new Map();
  const arrivalsMap = new Map();
  const departuresMap = new Map();
  const confirmedBookings = [];
  const longStayBookings = [];

  const horizon7 = started.add(7, 'day');
  const horizon30 = started.add(30, 'day');
  let revenue7 = 0;
  let revenue30 = 0;

  upcomingActive.forEach(b => {
    const isConfirmed = b.status === 'CONFIRMED';
    if (isConfirmed) confirmedBookings.push(b);

    const checkin = dayjs(b.checkin);
    const checkout = dayjs(b.checkout);
    for (let d = checkin; d.isBefore(checkout); d = d.add(1, 'day')) {
      const key = d.format('YYYY-MM-DD');
      let occ = occupancyMap.get(key);
      if (!occ) { occ = { confirmed: 0, pending: 0 }; occupancyMap.set(key, occ); }
      occ[isConfirmed ? 'confirmed' : 'pending'] += 1;
    }

    const arr = arrivalsMap.get(b.checkin) || { confirmed: 0, pending: 0 };
    arr[isConfirmed ? 'confirmed' : 'pending'] += 1;
    arrivalsMap.set(b.checkin, arr);

    const dep = departuresMap.get(b.checkout) || { confirmed: 0, pending: 0 };
    dep[isConfirmed ? 'confirmed' : 'pending'] += 1;
    departuresMap.set(b.checkout, dep);

    if (isConfirmed) {
      if (checkin.isBefore(horizon7) && checkout.isAfter(started)) revenue7 += b.total_cents;
      if (checkin.isBefore(horizon30) && checkout.isAfter(started)) revenue30 += b.total_cents;
      const stayLength = dateRangeNights(b.checkin, b.checkout).length;
      if (stayLength >= 7) longStayBookings.push(b);
    }
  });

  const confirmedByUnit = new Map();
  confirmedBookings.forEach(b => {
    if (!confirmedByUnit.has(b.unit_id)) confirmedByUnit.set(b.unit_id, []);
    confirmedByUnit.get(b.unit_id).push(b);
  });

  const notifications = [];
  const blockEvents = [];

  const automationTransaction = db.transaction(() => {
    units.forEach(u => {
      const unitBookings = confirmedByUnit.get(u.id) || [];
      if (unitBookings.length < AUTO_CHAIN_THRESHOLD) return;

      let chainCount = 1;
      for (let i = 1; i < unitBookings.length; i++) {
        const prev = unitBookings[i - 1];
        const curr = unitBookings[i];
        if (dayjs(curr.checkin).isSame(dayjs(prev.checkout))) {
          chainCount += 1;
        } else {
          chainCount = 1;
        }

        if (chainCount >= AUTO_CHAIN_THRESHOLD) {
          const blockStart = dayjs(curr.checkout).format('YYYY-MM-DD');
          const blockEnd = dayjs(curr.checkout).add(AUTO_CHAIN_CLEANUP_NIGHTS, 'day').format('YYYY-MM-DD');
          if (dayjs(blockEnd).isAfter(dayjs(blockStart))) {
            const key = `auto:block:chain:${u.id}:${blockStart}:${blockEnd}`;
            const existingBlock = selectAutomationBlocksExactStmt.get(u.id, blockStart, blockEnd);
            if (existingBlock) {
              writeAutomationState(key, {
                unit_id: u.id,
                block_id: existingBlock.id,
                start: blockStart,
                end: blockEnd,
                reason: 'chain'
              });
            } else {
              const bookingConflict = selectAutomationBookingOverlapStmt.get(u.id, blockStart, blockEnd);
              const blockConflict = selectAutomationBlockOverlapStmt.get(u.id, blockStart, blockEnd);
              if (!bookingConflict && !blockConflict) {
                const inserted = insertBlockStmt.run(u.id, blockStart, blockEnd);
                writeAutomationState(key, {
                  unit_id: u.id,
                  block_id: inserted.lastInsertRowid,
                  start: blockStart,
                  end: blockEnd,
                  reason: 'chain',
                  created_at: started.toISOString(),
                  trigger
                });
                blockEvents.push({
                  type: 'chain',
                  unit_id: u.id,
                  unit_name: u.name,
                  property_name: u.property_name,
                  start: blockStart,
                  end: blockEnd
                });
                notifications.push({
                  type: 'auto-block',
                  severity: 'info',
                  created_at: started.toISOString(),
                  title: 'Dia de recuperação bloqueado',
                  message: `${u.property_name} · ${u.name}: bloqueio ${formatDateRangeShort(blockStart, blockEnd)} após ${AUTO_CHAIN_THRESHOLD} reservas seguidas.`
                });
              } else {
                notifications.push({
                  type: 'auto-block',
                  severity: 'warning',
                  created_at: started.toISOString(),
                  title: 'Bloqueio por sequência cheia falhou',
                  message: `${u.property_name} · ${u.name}: conflito ao reservar ${formatDateRangeShort(blockStart, blockEnd)} para limpeza.`
                });
              }
            }
          }
          chainCount = 1;
        }
      }
    });

    confirmedBookings.forEach(b => {
      const quote = rateQuote(b.unit_id, b.checkin, b.checkout, b.base_price_cents);
      const stayLength = dateRangeNights(b.checkin, b.checkout).length;
      const minStay = quote.minStayReq || 1;
      if (minStay > stayLength) {
        const extraNights = minStay - stayLength;
        const blockStart = dayjs(b.checkout).format('YYYY-MM-DD');
        const blockEnd = dayjs(b.checkout).add(extraNights, 'day').format('YYYY-MM-DD');
        if (dayjs(blockEnd).isAfter(dayjs(blockStart))) {
          const key = `auto:block:minstay:${b.id}:${blockStart}:${blockEnd}`;
          const existingBlock = selectAutomationBlocksExactStmt.get(b.unit_id, blockStart, blockEnd);
          if (existingBlock) {
            writeAutomationState(key, {
              booking_id: b.id,
              block_id: existingBlock.id,
              start: blockStart,
              end: blockEnd,
              reason: 'minstay'
            });
          } else {
            const bookingConflict = selectAutomationBookingOverlapStmt.get(b.unit_id, blockStart, blockEnd);
            const blockConflict = selectAutomationBlockOverlapStmt.get(b.unit_id, blockStart, blockEnd);
            if (!bookingConflict && !blockConflict) {
              const inserted = insertBlockStmt.run(b.unit_id, blockStart, blockEnd);
              writeAutomationState(key, {
                booking_id: b.id,
                block_id: inserted.lastInsertRowid,
                start: blockStart,
                end: blockEnd,
                reason: 'minstay',
                created_at: started.toISOString(),
                extra_nights: extraNights,
                trigger
              });
              blockEvents.push({
                type: 'minstay',
                unit_id: b.unit_id,
                unit_name: b.unit_name,
                property_name: b.property_name,
                start: blockStart,
                end: blockEnd,
                extra_nights: extraNights
              });
              notifications.push({
                type: 'auto-block',
                severity: 'info',
                created_at: started.toISOString(),
                title: 'Estadia mínima reforçada',
                message: `${b.property_name} · ${b.unit_name}: bloqueadas ${extraNights} noite(s) (${formatDateRangeShort(blockStart, blockEnd)}) após reserva curta.`
              });
            } else {
              notifications.push({
                type: 'auto-block',
                severity: 'warning',
                created_at: started.toISOString(),
                title: 'Não foi possível reforçar estadia mínima',
                message: `${b.property_name} · ${b.unit_name}: conflito ao bloquear ${formatDateRangeShort(blockStart, blockEnd)}.`
              });
            }
          }
        }
      }
    });
  });

  try {
    automationTransaction();
  } catch (err) {
    console.error('Automação: falha ao executar sweep', err);
    notifications.push({
      type: 'automation',
      severity: 'danger',
      created_at: started.toISOString(),
      title: 'Erro no motor de automação',
      message: err.message || 'Erro inesperado ao processar regras automáticas.'
    });
  }

  units.forEach(u => {
    const unitBookings = upcomingActive.filter(b => b.unit_id === u.id);
    for (let i = 1; i < unitBookings.length; i++) {
      const prev = unitBookings[i - 1];
      const curr = unitBookings[i];
      if (dayjs(curr.checkin).isBefore(dayjs(prev.checkout))) {
        notifications.push({
          type: 'overlap',
          severity: 'danger',
          created_at: started.toISOString(),
          title: 'Sobreposição de reservas',
          message: `${u.property_name} · ${u.name}: ${prev.guest_name} (${dayjs(prev.checkin).format('DD/MM')}→${dayjs(prev.checkout).format('DD/MM')}) sobrepõe ${curr.guest_name} (${dayjs(curr.checkin).format('DD/MM')}→${dayjs(curr.checkout).format('DD/MM')}).`
        });
      }
    }
  });

  longStayBookings.forEach(b => {
    notifications.push({
      type: 'long-stay',
      severity: 'success',
      created_at: started.toISOString(),
      title: 'Estadia longa confirmada',
      message: `${b.property_name} · ${b.unit_name}: ${b.guest_name} fica ${dateRangeNights(b.checkin, b.checkout).length} noites (check-in ${dayjs(b.checkin).format('DD/MM')}).`
    });
  });

  const upcomingCheckins = confirmedBookings.filter(b => {
    const diffHours = dayjs(b.checkin).diff(started, 'hour');
    return diffHours >= 0 && diffHours <= 48;
  });
  upcomingCheckins.forEach(b => {
    notifications.push({
      type: 'checkin',
      severity: 'info',
      created_at: started.toISOString(),
      title: 'Check-in próximo',
      message: `${b.property_name} · ${b.unit_name}: ${b.guest_name} chega ${dayjs(b.checkin).format('DD/MM HH:mm')}, contacto ${b.guest_phone || '-'}.`
    });
  });

  const cancellationRows = selectAutomationCancellationsStmt.all();
  cancellationRows.forEach(row => {
    const payload = safeJsonParse(row.before_json);
    if (!payload) return;
    const unitInfo = payload.unit_id ? unitMap.get(payload.unit_id) : null;
    const createdAt = row.created_at || started.toISOString();
    if (createdAt && dayjs(createdAt).isBefore(started.subtract(14, 'day'))) return;
    const title = 'Reserva cancelada';
    const guest = payload.guest_name || 'Reserva';
    const stayRange = payload.checkin && payload.checkout
      ? `${dayjs(payload.checkin).format('DD/MM')}→${dayjs(payload.checkout).format('DD/MM')}`
      : '';
    const unitLabel = unitInfo ? `${unitInfo.property_name} · ${unitInfo.name}` : `Unidade #${payload.unit_id || '?'}`;
    notifications.push({
      type: 'cancel',
      severity: 'info',
      created_at: createdAt,
      title,
      message: `${unitLabel}: ${guest} (${stayRange}) cancelada.`
    });
  });

  const suggestions = [];
  if (totalUnits > 0) {
    const suggestionHorizon = started.add(30, 'day');
    for (let d = dayjs(today); d.isBefore(suggestionHorizon); d = d.add(1, 'day')) {
      const key = d.format('YYYY-MM-DD');
      const occ = occupancyMap.get(key);
      if (!occ) continue;
      const occupancyRate = occ.confirmed / totalUnits;
      if (occupancyRate >= HOT_DEMAND_THRESHOLD) {
        const increase = Math.min(35, Math.max(10, Math.round((occupancyRate - HOT_DEMAND_THRESHOLD) * 100) + 10));
        suggestions.push({
          date: key,
          occupancyRate,
          confirmedCount: occ.confirmed,
          pendingCount: occ.pending,
          suggestedIncreasePct: increase
        });
      }
    }
  }

  suggestions.sort((a, b) => {
    if (b.occupancyRate !== a.occupancyRate) return b.occupancyRate - a.occupancyRate;
    return a.date.localeCompare(b.date);
  });

  const demandPeaks = suggestions.slice(0, 10);
  const tariffSuggestions = suggestions.slice(0, 6);

  const dailySummary = [];
  for (let i = 0; i < 7; i++) {
    const day = dayjs(today).add(i, 'day');
    const key = day.format('YYYY-MM-DD');
    const occ = occupancyMap.get(key) || { confirmed: 0, pending: 0 };
    const arr = arrivalsMap.get(key) || { confirmed: 0, pending: 0 };
    const dep = departuresMap.get(key) || { confirmed: 0, pending: 0 };
    dailySummary.push({
      date: key,
      occupancyRate: totalUnits ? occ.confirmed / totalUnits : 0,
      confirmedCount: occ.confirmed,
      pendingCount: occ.pending,
      arrivalsConfirmed: arr.confirmed,
      arrivalsPending: arr.pending,
      departuresConfirmed: dep.confirmed,
      departuresPending: dep.pending
    });
  }

  const weeklySummary = [];
  const baseWeek = isoWeekStart(today);
  for (let i = 0; i < 4; i++) {
    const startWeek = baseWeek.add(i, 'week');
    const endWeek = startWeek.add(7, 'day');
    let confirmedNights = 0;
    let pendingNights = 0;
    for (let d = startWeek; d.isBefore(endWeek); d = d.add(1, 'day')) {
      const key = d.format('YYYY-MM-DD');
      const occ = occupancyMap.get(key);
      if (occ) {
        confirmedNights += occ.confirmed;
        pendingNights += occ.pending;
      }
    }
    weeklySummary.push({
      start: startWeek.format('YYYY-MM-DD'),
      end: endWeek.format('YYYY-MM-DD'),
      occupancyRate: totalUnits ? confirmedNights / (totalUnits * 7) : 0,
      confirmedNights,
      pendingNights
    });
  }

  const seenNotifications = new Set();
  const uniqueNotifications = [];
  notifications.forEach(n => {
    const key = `${n.type}|${n.title}|${n.message}`;
    if (seenNotifications.has(key)) return;
    seenNotifications.add(key);
    uniqueNotifications.push(n);
  });

  uniqueNotifications.sort((a, b) => {
    const aTime = dayjs(a.created_at || started).valueOf();
    const bTime = dayjs(b.created_at || started).valueOf();
    return bTime - aTime;
  });

  const trimmedNotifications = uniqueNotifications.slice(0, 20);

  const metrics = {
    checkins48h: upcomingCheckins.length,
    longStays: longStayBookings.length,
    occupancyToday: totalUnits ? ((occupancyMap.get(today) || { confirmed: 0 }).confirmed / totalUnits) : 0,
    revenue7,
    revenue30,
    totalUnits,
    totalConfirmed: confirmedBookings.length
  };

  automationCache = {
    lastRun: started.toISOString(),
    generatedBlocks: blockEvents,
    tariffSuggestions,
    notifications: trimmedNotifications,
    summaries: { daily: dailySummary, weekly: weeklySummary },
    revenue: { next7: revenue7, next30: revenue30 },
    demandPeaks,
    metrics
  };

  return automationCache;
}

function ensureAutomationFresh(maxAgeMinutes = 10) {
  if (!automationCache.lastRun) return runAutomationSweep('lazy');
  if (dayjs().diff(dayjs(automationCache.lastRun), 'minute') > maxAgeMinutes) {
    return runAutomationSweep('lazy');
  }
  return automationCache;
}

function parseOperationalFilters(input = {}) {
  const filters = {};
  const monthRaw = input.month ?? input.month_value;
  if (typeof monthRaw === 'string' && /^\d{4}-\d{2}$/.test(monthRaw.trim())) {
    filters.month = monthRaw.trim();
  }
  const propertyRaw = input.propertyId ?? input.property_id;
  if (propertyRaw !== undefined && propertyRaw !== null && String(propertyRaw).trim() !== '') {
    const parsed = Number(propertyRaw);
    if (!Number.isNaN(parsed) && parsed > 0) filters.propertyId = parsed;
  }
  const typeRaw = input.unitType ?? input.unit_type;
  if (typeof typeRaw === 'string' && typeRaw.trim()) {
    filters.unitType = typeRaw.trim();
  }
  return filters;
}

function computeOperationalDashboard(rawFilters = {}) {
  const filters = parseOperationalFilters(rawFilters);
  const todayMonth = dayjs().format('YYYY-MM');
  const monthValue = filters.month || todayMonth;
  let monthStart = dayjs(`${monthValue}-01`);
  if (!monthStart.isValid()) {
    monthStart = dayjs().startOf('month');
  }
  const rangeStart = monthStart.startOf('month');
  const rangeEnd = rangeStart.add(1, 'month');
  const rangeNights = Math.max(1, rangeEnd.diff(rangeStart, 'day'));
  const propertyId = filters.propertyId || null;
  const unitTypeFilter = filters.unitType || null;

  const unitsRaw = selectOperationalUnitsStmt.all();
  const units = unitsRaw.map(u => ({ ...u, unit_type: deriveUnitType(u) }));
  const filteredUnits = units.filter(u => {
    if (propertyId && u.property_id !== propertyId) return false;
    if (unitTypeFilter && u.unit_type !== unitTypeFilter) return false;
    return true;
  });

  const summary = {
    occupancyRate: 0,
    revenueCents: 0,
    averageNights: 0,
    bookingsCount: 0,
    occupiedNights: 0,
    availableNights: filteredUnits.length * rangeNights,
    totalUnits: filteredUnits.length
  };

  const response = {
    month: rangeStart.format('YYYY-MM'),
    monthLabel: capitalizeMonth(rangeStart.format('MMMM YYYY')),
    range: {
      start: rangeStart.format('YYYY-MM-DD'),
      end: rangeEnd.format('YYYY-MM-DD'),
      nights: rangeNights
    },
    summary,
    topUnits: [],
    filters: {
      propertyId,
      propertyLabel: null,
      unitType: unitTypeFilter || null,
      unitTypeLabel: unitTypeFilter || null
    }
  };

  if (!filteredUnits.length) {
    if (propertyId) {
      const propertyUnit = units.find(u => u.property_id === propertyId);
      if (propertyUnit) response.filters.propertyLabel = propertyUnit.property_name;
    }
    return response;
  }

  response.filters.propertyLabel = propertyId ? filteredUnits[0].property_name || null : null;

  const unitIds = new Set(filteredUnits.map(u => u.id));
  const statsByUnit = new Map(filteredUnits.map(u => [u.id, { unit: u, occupiedNights: 0, revenueCents: 0, bookings: 0 }]));
  const bookings = selectOperationalBookingsStmt.all(rangeStart.format('YYYY-MM-DD'), rangeEnd.format('YYYY-MM-DD'));

  let occupiedNightsTotal = 0;
  let revenueCentsTotal = 0;
  let nightsAccumulator = 0;
  let bookingsCount = 0;

  bookings.forEach(b => {
    if (!unitIds.has(b.unit_id)) return;
    const checkin = dayjs(b.checkin);
    const checkout = dayjs(b.checkout);
    const overlapStart = dayjs.max(checkin, rangeStart);
    const overlapEnd = dayjs.min(checkout, rangeEnd);
    const overlapNights = Math.max(0, overlapEnd.diff(overlapStart, 'day'));
    if (overlapNights <= 0) return;
    const totalNights = Math.max(1, checkout.diff(checkin, 'day'));
    const revenueShare = Math.round((b.total_cents * overlapNights) / totalNights);

    occupiedNightsTotal += overlapNights;
    revenueCentsTotal += revenueShare;
    nightsAccumulator += overlapNights;
    bookingsCount += 1;

    const stat = statsByUnit.get(b.unit_id);
    if (stat) {
      stat.occupiedNights += overlapNights;
      stat.revenueCents += revenueShare;
      stat.bookings += 1;
    }
  });

  summary.occupiedNights = occupiedNightsTotal;
  summary.revenueCents = revenueCentsTotal;
  summary.bookingsCount = bookingsCount;
  summary.averageNights = bookingsCount ? nightsAccumulator / bookingsCount : 0;
  summary.occupancyRate = summary.availableNights > 0 ? occupiedNightsTotal / summary.availableNights : 0;

  const sortedUnits = Array.from(statsByUnit.values())
    .map(stat => ({
      id: stat.unit.id,
      unitName: stat.unit.name,
      propertyName: stat.unit.property_name,
      unitType: stat.unit.unit_type,
      occupancyRate: rangeNights > 0 ? stat.occupiedNights / rangeNights : 0,
      occupiedNights: stat.occupiedNights,
      revenueCents: stat.revenueCents,
      bookingsCount: stat.bookings
    }))
    .sort((a, b) => {
      if (b.occupancyRate !== a.occupancyRate) return b.occupancyRate - a.occupancyRate;
      if (b.bookingsCount !== a.bookingsCount) return b.bookingsCount - a.bookingsCount;
      if (b.revenueCents !== a.revenueCents) return b.revenueCents - a.revenueCents;
      return a.unitName.localeCompare(b.unitName, 'pt', { sensitivity: 'base' });
    });

  response.topUnits = sortedUnits.slice(0, 5);
  return response;
}

try {
  runAutomationSweep('startup');
} catch (err) {
  console.error('Automação: falha inicial', err);
}

setInterval(() => {
  try {
    runAutomationSweep('interval');
  } catch (err) {
    console.error('Automação: falha periódica', err);
  }
}, 30 * 60 * 1000);

// Seeds
const countProps = db.prepare('SELECT COUNT(*) AS c FROM properties').get().c;
if (countProps === 0) {
  const ip = db.prepare('INSERT INTO properties(name, location, description) VALUES (?,?,?)');
  const iu = db.prepare('INSERT INTO units(property_id, name, capacity, base_price_cents, description) VALUES (?,?,?,?,?)');
  const pr1 = ip.run('Casas de Pousadouro', 'Rio Douro', 'Arquitetura tradicional, interiores contemporâneos').lastInsertRowid;
  const pr2 = ip.run('Prazer da Natureza', 'Âncora, Portugal', 'Hotel & SPA perto da praia').lastInsertRowid;
  iu.run(pr1, 'Quarto Duplo', 2, 8500, 'Acolhedor e funcional');
  iu.run(pr1, 'Quarto Familiar', 4, 15500, 'Ideal para famílias');
  iu.run(pr2, 'Suite Vista Jardim', 2, 12000, 'Vista jardim e varanda');
}
try {
  const rc = db.prepare('SELECT COUNT(*) AS c FROM rates').get().c;
  if (!rc) {
    const year = dayjs().year();
    const unitsAll = db.prepare('SELECT id, base_price_cents FROM units').all();
    const ins = db.prepare('INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)');
    unitsAll.forEach(u => {
      ins.run(u.id, `${year}-06-01`, `${year}-09-01`, Math.round(u.base_price_cents*1.2), Math.round(u.base_price_cents*1.2), 2);
      ins.run(u.id, `${year}-12-20`, `${year+1}-01-05`, Math.round(u.base_price_cents*1.3), Math.round(u.base_price_cents*1.3), 3);
    });
  }
} catch(e) {}
const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (usersCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run('admin', hash, 'direcao');
  console.log('Admin default: admin / admin123 (muda em /admin/utilizadores).');
}

const masterUser = db.prepare('SELECT id FROM users WHERE username = ?').get('dev');
if (!masterUser) {
  const devHash = bcrypt.hashSync('dev123', 10);
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run('dev', devHash, MASTER_ROLE);
  console.log('Utilizador mestre: dev / dev123 (pode alterar em /admin/utilizadores).');
}

// ===================== Uploads =====================
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const UPLOAD_UNITS = path.join(UPLOAD_ROOT, 'units');
function ensureDir(p){ if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(UPLOAD_ROOT);
ensureDir(UPLOAD_UNITS);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const unitId = req.params.id || req.body.unit_id;
    if (!unitId) return cb(new Error('unit_id em falta'));
    const dir = path.join(UPLOAD_UNITS, String(unitId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('Tipo de imagem inválido'), ok);
  }
});
app.use('/uploads', express.static(UPLOAD_ROOT, { fallthrough: false }));

async function compressImage(filePath) {
  if (!sharp) return;
  try {
    const metadata = await sharp(filePath).metadata();
    let pipeline = sharp(filePath)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
    if (metadata.format === 'png') {
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true });
    } else if (metadata.format === 'webp') {
      pipeline = pipeline.webp({ quality: 80, effort: 4 });
    } else {
      pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:4:4' });
    }
    const buffer = await pipeline.toBuffer();
    await fsp.writeFile(filePath, buffer);
  } catch (err) {
    console.warn('Compressão de imagem falhou para', filePath, '-', err.message);
  }
}

// ===================== Utils =====================
const html = String.raw;
const eur = (c) => (c / 100).toFixed(2);
const capitalizeMonth = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

function wantsJson(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  if ((req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest') return true;
  return accept.includes('application/json') || accept === '*/*';
}
const esc = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function formatAuditValue(val) {
  if (val === undefined || val === null || val === '') return '<span class="text-slate-400">—</span>';
  if (typeof val === 'object') return `<code>${esc(JSON.stringify(val))}</code>`;
  return esc(String(val));
}

function renderAuditDiff(beforeJson, afterJson) {
  let beforeObj = null;
  let afterObj = null;
  try { beforeObj = beforeJson ? JSON.parse(beforeJson) : null; } catch (_) {}
  try { afterObj = afterJson ? JSON.parse(afterJson) : null; } catch (_) {}
  const keys = Array.from(new Set([
    ...(beforeObj ? Object.keys(beforeObj) : []),
    ...(afterObj ? Object.keys(afterObj) : [])
  ])).sort();
  if (!keys.length) return '<div class="text-xs text-slate-500">Sem detalhes</div>';
  const rows = keys.map(key => {
    const beforeVal = beforeObj ? beforeObj[key] : undefined;
    const afterVal = afterObj ? afterObj[key] : undefined;
    const changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
    const cls = changed ? 'text-emerald-700' : 'text-slate-600';
    return `<tr class="${cls}">
      <td class="font-semibold pr-2 align-top">${esc(key)}</td>
      <td class="pr-2 align-top">${formatAuditValue(beforeVal)}</td>
      <td class="pr-2 align-top">→</td>
      <td class="align-top">${formatAuditValue(afterVal)}</td>
    </tr>`;
  }).join('');
  return `<table class="w-full text-xs border-separate border-spacing-y-1">${rows}</table>`;
}

function formatJsonSnippet(json) {
  if (!json) return '<span class="text-slate-400">—</span>';
  try {
    const parsed = JSON.parse(json);
    const pretty = JSON.stringify(parsed, null, 2);
    return `<pre class="text-xs whitespace-pre-wrap bg-slate-900/5 rounded p-2">${esc(pretty)}</pre>`;
  } catch (_) {
    return `<code class="text-xs">${esc(json)}</code>`;
  }
}

const FEATURE_ICONS = {
  bed: 'Camas',
  kitchen: 'Kitchenette',
  ac: 'Ar condicionado',
  bath: 'Casa de banho',
  wifi: 'Wi-Fi',
  pool: 'Piscina',
  car: 'Estacionamento',
  coffee: 'Café',
  sun: 'Terraço'
}
const FEATURE_ICON_KEYS = Object.keys(FEATURE_ICONS);

const UNIT_TYPE_ICON_HINTS = new Set([
  'apartment',
  'building',
  'cabin',
  'castle',
  'condo',
  'home',
  'hotel',
  'house',
  'hut',
  'key',
  'loft',
  'room',
  'suite',
  'tent',
  'villa'
]);
const UNIT_TYPE_LABEL_REGEX = /(suite|suíte|apart|apartamento|quarto|room|t\d|studio|estúdio|villa|casa|loft|bungal|cabana|chalet|dúplex|duplex|penthouse|family|familiar)/i;

function parseFeaturesInput(raw) {
  if (!raw) return [];
  const iconRegex = /^[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?$/i;
  return String(raw)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      let icon = null;
      let label = '';
      const pipeParts = line.split('|');
      if (pipeParts.length > 1) {
        const candidate = pipeParts.shift().trim();
        if (iconRegex.test(candidate)) {
          icon = candidate.toLowerCase();
        } else {
          pipeParts.unshift(candidate);
        }
        label = pipeParts.join('|').trim();
      } else {
        const tokens = line.split(/\s+/).filter(Boolean);
        if (tokens.length === 1 && iconRegex.test(tokens[0])) {
          icon = tokens[0].toLowerCase();
        } else if (tokens.length > 1 && iconRegex.test(tokens[0])) {
          icon = tokens.shift().toLowerCase();
          label = tokens.join(' ').trim();
        } else {
          label = line;
        }
      }
      if (!icon && !label) return null;
      return { icon: icon || null, label };
    })
    .filter(Boolean);
}

function normalizeFeature(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const parsed = parseFeaturesInput(entry);
    return parsed.length ? parsed[0] : null;
  }
  let icon = entry.icon ?? entry.type ?? null;
  let label = entry.label ?? entry.text ?? '';
  icon = icon ? String(icon).trim().toLowerCase() : null;
  label = label ? String(label).trim() : '';
  if (!label) return null;
  return { icon: icon || null, label };
}
function parseFeaturesStored(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeFeature).filter(Boolean);
  const str = String(raw).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed.map(normalizeFeature).filter(Boolean);
  } catch (_) {}
  return parseFeaturesInput(str);
}
function featuresToTextarea(raw) {
  return parseFeaturesStored(raw)
    .map(f => {
      const icon = f.icon ? String(f.icon).toLowerCase() : '';
      const label = f.label ? String(f.label) : '';
      if (icon && label) return `${icon}|${label}`;
      if (icon) return icon;
      return label;
    })
    .join('\n');
}
function featureChipsHtml(features, opts = {}) {
  const items = Array.isArray(features) ? features.map(normalizeFeature).filter(Boolean) : parseFeaturesStored(features);
  if (!items.length) return "";
  const className = opts.className || 'flex flex-wrap gap-2 text-xs text-slate-600';
  const badgeClass = opts.badgeClass || 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full';
  const iconWrap = opts.iconWrapClass || 'inline-flex items-center justify-center text-emerald-700';
  const parts = items.map(f => {
    const key = f.icon ? String(f.icon).toLowerCase() : "";
    const fallback = FEATURE_ICONS[key] || key.replace(/[-_]/g, " ");
    const label = f.label ? esc(f.label) : esc(fallback.replace(/\b\w/g, c => c.toUpperCase()));
    const iconHtml = key ? `<span class="${iconWrap}"><i data-lucide="${key}" class="w-4 h-4"></i></span>` : "";
    const labelHtml = label ? `<span>${label}</span>` : "";
    if (!iconHtml && !labelHtml) return "";
    return `<span class="${badgeClass}">${iconHtml}${labelHtml}</span>`;
  }).filter(Boolean);
  if (!parts.length) return "";
  return `<div class="${className}">${parts.join("")}</div>`;
}

function titleizeWords(str) {
  const raw = String(str || '').trim();
  if (!raw) return raw;
  return raw.replace(/\b([\p{L}])([\p{L}]*)/gu, (_, first, rest) => first.toUpperCase() + rest.toLowerCase());
}

function deriveUnitType(unit = {}) {
  const features = parseFeaturesStored(unit.features);
  for (const feat of features) {
    const icon = feat && feat.icon ? String(feat.icon).toLowerCase() : '';
    const label = feat && feat.label ? String(feat.label).trim() : '';
    if (icon && UNIT_TYPE_ICON_HINTS.has(icon)) {
      if (label) return titleizeWords(label);
      const fallback = FEATURE_ICONS[icon] || icon.replace(/[-_]/g, ' ');
      return titleizeWords(fallback);
    }
    if (label && UNIT_TYPE_LABEL_REGEX.test(label)) {
      return titleizeWords(label);
    }
  }

  const unitName = unit && unit.name ? String(unit.name) : '';
  const nameMatch = unitName.match(UNIT_TYPE_LABEL_REGEX);
  if (nameMatch) return titleizeWords(nameMatch[0]);

  const capacity = Number(unit && unit.capacity) || 0;
  if (capacity <= 2) return 'Estúdio / Casal';
  if (capacity <= 4) return 'Familiar';
  if (capacity <= 6) return 'Grupo médio';
  return 'Grupo grande';
}

const formatMonthYear = (dateLike) => capitalizeMonth(dayjs(dateLike).format('MMMM YYYY'));

function dateRangeNights(ci, co) {
  const start = dayjs(ci), end = dayjs(co);
  const nights = [];
  for (let d = start; d.isBefore(end); d = d.add(1, 'day')) nights.push(d.format('YYYY-MM-DD'));
  return nights;
}
function createSession(userId, days = 7) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = dayjs().add(days, 'day').toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT s.token, s.expires_at, u.id as user_id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!row) return null;
  if (!dayjs().isBefore(dayjs(row.expires_at))) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); return null; }
  return row;
}
function destroySession(token){ if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }

function requireLogin(req,res,next){
  const sess = getSession(req.cookies.adm);
  if (!sess) return res.redirect('/login?next='+encodeURIComponent(req.originalUrl));
  req.user = buildUserContext(sess);
  next();
}
function requireAdmin(req,res,next){
  const sess = getSession(req.cookies.adm);
  if (!sess) return res.redirect('/login?next='+encodeURIComponent(req.originalUrl));
  const user = buildUserContext(sess);
  req.user = user;
  if (!userCan(user, 'users.manage')) {
    return res.status(403).send('Sem permissão');
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      const sess = getSession(req.cookies.adm);
      if (!sess) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
      req.user = buildUserContext(sess);
    }
    if (!userCan(req.user, permission)) {
      if (wantsJson(req)) return res.status(403).json({ ok: false, message: 'Sem permissão' });
      return res.status(403).send('Sem permissão');
    }
    next();
  };
}

function requireAnyPermission(permissions = []) {
  return (req, res, next) => {
    if (!req.user) {
      const sess = getSession(req.cookies.adm);
      if (!sess) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
      req.user = buildUserContext(sess);
    }
    if (!permissions.some(perm => userCan(req.user, perm))) {
      if (wantsJson(req)) return res.status(403).json({ ok: false, message: 'Sem permissão' });
      return res.status(403).send('Sem permissão');
    }
    next();
  };
}

// Disponibilidade / Pricing
function overlaps(aStart, aEnd, bStart, bEnd) {
  const aS = dayjs(aStart), aE = dayjs(aEnd);
  const bS = dayjs(bStart), bE = dayjs(bEnd);
  return aS.isBefore(bE) && aE.isAfter(bS);
}
function unitAvailable(unitId, checkin, checkout) {
  const conflicts = db.prepare(
    `SELECT checkin AS s, checkout AS e FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
     UNION ALL
     SELECT start_date AS s, end_date AS e FROM blocks WHERE unit_id = ?`
  ).all(unitId, unitId);
  return !conflicts.some(c => overlaps(checkin, checkout, c.s, c.e));
}
function isWeekendDate(d){ const dow = dayjs(d).day(); return dow === 0 || dow === 6; }
function rateQuote(unit_id, checkin, checkout, base_price_cents){
  const nights = dateRangeNights(checkin, checkout);
  const rows = db.prepare('SELECT * FROM rates WHERE unit_id = ?').all(unit_id);
  let total = 0; let minStayReq = 1;
  nights.forEach(d => {
    const r = rows.find(x => !dayjs(d).isBefore(x.start_date) && dayjs(d).isBefore(x.end_date));
    if (r){
      minStayReq = Math.max(minStayReq, r.min_stay || 1);
      const price = isWeekendDate(d)
        ? (r.weekend_price_cents ?? r.weekday_price_cents ?? base_price_cents)
        : (r.weekday_price_cents ?? r.weekend_price_cents ?? base_price_cents);
      total += price;
    } else {
      total += base_price_cents;
    }
  });
  return { total_cents: total, nights: nights.length, minStayReq };
}

// ===================== Layout =====================
function layout({ title = 'Booking Engine', body, user, activeNav = '' }) {
  const hasUser = !!user;
  const navClass = (key) => `nav-link${activeNav === key ? ' active' : ''}`;
  const can = (perm) => userCan(user, perm);
  const userPermissions = user ? Array.from(user.permissions || []) : [];
  return html`<!doctype html>
  <html lang="pt">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://unpkg.com/hyperscript.org@0.9.12"></script>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/lucide@latest"></script>
      <style>
        .input { box-sizing:border-box; width:100%; min-width:0; display:block; padding:.5rem .75rem; border-radius:.5rem; border:1px solid #cbd5e1; background:#fff; line-height:1.25rem; }
        .btn  { display:inline-block; padding:.5rem .75rem; border-radius:.5rem; }
        .btn-primary{ background:#0f172a; color:#fff; }
        .btn-muted{ background:#e2e8f0; }
        .btn-light{ background:#f8fafc; color:#0f172a; font-weight:600; }
        .btn-danger{ background:#f43f5e; color:#fff; }
        .btn[disabled]{opacity:.5;cursor:not-allowed;}
        .card{ background:#fff; border-radius: .75rem; box-shadow: 0 1px 2px rgba(16,24,40,.05); }
        body.app-body{margin:0;background:#fafafa;color:#4b4d59;font-family:'Inter','Segoe UI',sans-serif;}
        .app-shell{min-height:100vh;display:flex;flex-direction:column;}
        .topbar{background:#f7f6f9;border-bottom:1px solid #e2e1e8;box-shadow:0 1px 0 rgba(15,23,42,.04);}
        .topbar-inner{max-width:1120px;margin:0 auto;padding:24px 32px 12px;display:flex;flex-wrap:wrap;align-items:center;gap:24px;}
        .brand{display:flex;align-items:center;gap:12px;color:#5f616d;font-weight:600;text-decoration:none;font-size:1.125rem;}
        .brand-logo{width:40px;height:40px;border-radius:14px;background:linear-gradient(130deg,#ffb347,#ff5a91);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;box-shadow:0 10px 20px rgba(255,90,145,.25);}
        .brand-name{letter-spacing:.02em;}
        .nav-links{display:flex;align-items:center;gap:28px;flex-wrap:wrap;}
        .nav-link{position:relative;color:#7a7b88;font-weight:500;text-decoration:none;padding-bottom:6px;transition:color .2s ease;}
        .nav-link:hover{color:#424556;}
        .nav-link.active{color:#2f3140;}
        .nav-link.active::after{content:'';position:absolute;left:0;right:0;bottom:-12px;height:3px;border-radius:999px;background:linear-gradient(90deg,#ff5a91,#ffb347);}
        .nav-actions{margin-left:auto;display:flex;align-items:center;gap:18px;}
        .logout-form{margin:0;}
        .logout-form button,.login-link{background:none;border:none;color:#7a7b88;font-weight:500;cursor:pointer;padding:0;text-decoration:none;}
        .logout-form button:hover,.login-link:hover{color:#2f3140;}
        .nav-accent-bar{height:3px;background:linear-gradient(90deg,#ff5a91,#ffb347);opacity:.55;}
        .main-content{flex:1;max-width:1120px;margin:0 auto;padding:56px 32px 64px;width:100%;}
        .footer{background:#f7f6f9;border-top:1px solid #e2e1e8;color:#8c8d97;font-size:.875rem;}
        .footer-inner{max-width:1120px;margin:0 auto;padding:20px 32px;}
        .search-hero{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:32px;text-align:center;}
        .search-title{font-size:2.25rem;font-weight:600;color:#5a5c68;margin:0;}
        .search-intro{color:#5f616d;font-size:1.05rem;line-height:1.7;margin:0 auto;max-width:720px;}
        .reassurance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px;margin-top:8px;}
        .reassurance-card{background:rgba(255,255,255,.85);border-radius:18px;padding:18px 20px;border:1px solid rgba(148,163,184,.35);display:flex;flex-direction:column;gap:6px;box-shadow:0 18px 32px rgba(148,163,184,.14);}
        .reassurance-icon{width:32px;height:32px;border-radius:999px;background:linear-gradient(130deg,#34d399,#0ea5e9);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;align-self:flex-start;}
        .reassurance-title{font-size:.95rem;font-weight:600;color:#374151;}
        .reassurance-copy{font-size:.85rem;color:#64748b;margin:0;line-height:1.5;}
        .progress-steps{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;margin:0;padding:0;list-style:none;color:#475569;font-size:.95rem;}
        .progress-step{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:#f1f5f9;border:1px solid rgba(148,163,184,.35);font-weight:500;}
        .progress-step.is-active{background:linear-gradient(130deg,#ffb347,#ff6b00);color:#fff;box-shadow:0 12px 22px rgba(255,107,0,.25);}
        .search-form{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end;background:#f7f6f9;border-radius:28px;padding:32px;border:1px solid rgba(255,166,67,.4);box-shadow:0 24px 42px rgba(15,23,42,.08);}
        .search-field{display:flex;flex-direction:column;gap:10px;text-align:left;}
        .search-field label{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;font-weight:600;color:#9b9ca6;}
        .search-dates{display:flex;gap:14px;flex-wrap:wrap;}
        .search-input{width:100%;border-radius:16px;border:2px solid rgba(255,166,67,.6);padding:14px 16px;background:#fff;font-size:1rem;color:#44454f;transition:border-color .2s ease,box-shadow .2s ease;}
        .search-input:focus{border-color:#ff8c00;outline:none;box-shadow:0 0 0 4px rgba(255,166,67,.2);}
        .search-submit{display:flex;justify-content:flex-end;}
        .search-button{display:inline-flex;align-items:center;justify-content:center;padding:14px 40px;border-radius:999px;border:none;background:linear-gradient(130deg,#ffb347,#ff6b00);color:#fff;font-weight:700;font-size:1.05rem;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;}
        .search-button:hover{transform:translateY(-1px);box-shadow:0 14px 26px rgba(255,107,0,.25);}
        .search-button[disabled]{opacity:.6;cursor:not-allowed;box-shadow:none;transform:none;}
        .search-button[data-loading="true"]{position:relative;color:transparent;}
        .search-button[data-loading="true"]::after{content:'A procurar...';color:#fff;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
        .search-button[data-loading="true"]::before{content:'';position:absolute;left:18px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:999px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:spin .8s linear infinite;}
        .inline-feedback{border-radius:18px;padding:14px 18px;text-align:left;font-size:.9rem;display:flex;gap:12px;align-items:flex-start;line-height:1.5;}
        .inline-feedback[data-variant="info"]{background:#ecfeff;border:1px solid #67e8f9;color:#155e75;}
        .inline-feedback[data-variant="success"]{background:#ecfdf3;border:1px solid #4ade80;color:#166534;}
        .inline-feedback[data-variant="warning"]{background:#fef3c7;border:1px solid #fcd34d;color:#92400e;}
        .inline-feedback[data-variant="danger"]{background:#fee2e2;border:1px solid #f87171;color:#991b1b;}
        .inline-feedback strong{font-weight:600;}
        .inline-feedback-icon{width:26px;height:26px;border-radius:999px;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;flex-shrink:0;box-shadow:0 10px 20px rgba(15,23,42,.08);}
        .pill-indicator{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#f1f5f9;font-size:.75rem;font-weight:500;color:#475569;text-transform:uppercase;letter-spacing:.08em;}
        .result-header{display:flex;flex-direction:column;gap:12px;margin-bottom:24px;}
        .result-header .progress-steps{justify-content:flex-start;}
        .calendar-card{position:relative;}
        .calendar-card[data-loading="true"]::after{content:'';position:absolute;inset:0;border-radius:18px;background:rgba(15,23,42,.08);backdrop-filter:blur(1px);}
        .calendar-card[data-loading="true"]::before{content:'';position:absolute;top:50%;left:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:999px;border:3px solid rgba(15,23,42,.25);border-top-color:#0f172a;animation:spin .9s linear infinite;}
        .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;}
        .calendar-cell{position:relative;height:3rem;display:flex;align-items:center;justify-content:center;border-radius:.6rem;font-size:.75rem;user-select:none;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease;}
        @media (min-width:640px){.calendar-cell{height:3.5rem;font-size:.85rem;}}
        .calendar-cell:hover{transform:translateY(-1px);box-shadow:0 8px 14px rgba(15,23,42,.12);}
        .calendar-cell[data-in-month="0"]{cursor:default;}
        .calendar-cell--selection{outline:2px solid rgba(59,130,246,.6);outline-offset:2px;box-shadow:0 0 0 3px rgba(59,130,246,.25);}
        .calendar-cell--preview{outline:2px dashed rgba(16,185,129,.75);outline-offset:2px;}
        .calendar-cell--invalid{outline:2px solid rgba(239,68,68,.75);outline-offset:2px;}
        .calendar-action{position:fixed;z-index:60;transform:translate(-50%,-100%);min-width:260px;}
        .calendar-action[hidden]{display:none;}
        .calendar-action__card{background:#0f172a;color:#fff;padding:18px 20px;border-radius:18px;box-shadow:0 20px 45px rgba(15,23,42,.3);display:grid;gap:12px;}
        .calendar-action__title{font-weight:600;font-size:.95rem;}
        .calendar-action__buttons{display:flex;flex-wrap:wrap;gap:10px;}
        .calendar-action__buttons .btn{flex:1 1 auto;justify-content:center;}
        .calendar-toast{position:fixed;z-index:70;bottom:24px;right:24px;padding:14px 18px;border-radius:16px;font-size:.9rem;font-weight:500;display:flex;align-items:center;gap:12px;box-shadow:0 16px 30px rgba(15,23,42,.18);}
        .calendar-toast[hidden]{display:none;}
        .calendar-toast[data-variant="success"]{background:#ecfdf5;color:#065f46;}
        .calendar-toast[data-variant="info"]{background:#eff6ff;color:#1d4ed8;}
        .calendar-toast[data-variant="danger"]{background:#fee2e2;color:#b91c1c;}
        .calendar-toast__dot{width:10px;height:10px;border-radius:999px;background:currentColor;box-shadow:0 0 0 3px rgba(255,255,255,.6);}
        .calendar-dialog{border:none;border-radius:20px;padding:0;max-width:420px;width:92vw;}
        .calendar-dialog::backdrop{background:rgba(15,23,42,.45);}
        @media (max-width:900px){.topbar-inner{padding:20px 24px 10px;gap:18px;}.nav-link.active::after{bottom:-10px;}.main-content{padding:48px 24px 56px;}.search-form{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));}}
        @media (max-width:680px){.topbar-inner{padding:18px 20px 10px;}.nav-links{gap:18px;}.nav-actions{width:100%;justify-content:flex-end;}.main-content{padding:40px 20px 56px;}.search-form{grid-template-columns:1fr;padding:28px;}.search-dates{flex-direction:column;}.search-submit{justify-content:stretch;}.search-button{width:100%;}.progress-step{width:100%;justify-content:center;}}
        .gallery-flash{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:14px;font-size:.85rem;font-weight:500;background:#f1f5f9;color:#1e293b;box-shadow:0 6px 18px rgba(15,23,42,.08);}
        .gallery-flash[data-variant="success"]{background:#ecfdf5;color:#047857;}
        .gallery-flash[data-variant="info"]{background:#eff6ff;color:#1d4ed8;}
        .gallery-flash[data-variant="danger"]{background:#fee2e2;color:#b91c1c;}
        .gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));grid-auto-rows:140px;gap:14px;}
        .gallery-tile{position:relative;overflow:hidden;border-radius:18px;background:#0f172a;color:#fff;cursor:grab;min-height:100%;box-shadow:0 10px 24px rgba(15,23,42,.16);transition:transform .18s ease,box-shadow .18s ease;}
        .gallery-tile:hover{transform:translateY(-2px);box-shadow:0 18px 36px rgba(15,23,42,.22);}
        .gallery-tile.dragging{opacity:.55;cursor:grabbing;box-shadow:0 20px 40px rgba(15,23,42,.28);}
        .gallery-tile:nth-child(7n+1){grid-column:span 2;grid-row:span 2;}
        .gallery-tile:nth-child(5n+3){grid-column:span 2;}
        .gallery-tile:nth-child(9n+5){grid-row:span 2;}
        .gallery-tile__img{width:100%;height:100%;object-fit:cover;display:block;}
        .gallery-tile__badge{position:absolute;top:12px;left:12px;padding:6px 12px;border-radius:999px;background:rgba(15,23,42,.82);font-size:.7rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;opacity:0;transition:opacity .18s ease;}
        .gallery-tile.is-primary .gallery-tile__badge{opacity:1;}
        .gallery-tile__overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:16px;background:linear-gradient(180deg,rgba(15,23,42,.05) 0%,rgba(15,23,42,.65) 55%,rgba(15,23,42,.9) 100%);opacity:0;transition:opacity .18s ease;}
        .gallery-tile:focus .gallery-tile__overlay,.gallery-tile:hover .gallery-tile__overlay{opacity:1;}
        .gallery-tile__hint{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:rgba(226,232,240,.85);margin-bottom:6px;}
        .gallery-tile__meta{font-size:.75rem;color:rgba(226,232,240,.75);margin-bottom:10px;}
        .gallery-tile__actions{display:flex;flex-wrap:wrap;gap:8px;}
        .gallery-tile__actions .btn{flex:1 1 auto;justify-content:center;padding:.45rem .6rem;font-size:.8rem;}
        .gallery-empty{padding:18px;border-radius:14px;background:#f1f5f9;color:#475569;text-align:center;font-size:.9rem;}
        @media (max-width:900px){.gallery-grid{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));grid-auto-rows:120px;}}
        @media (pointer:coarse){.gallery-tile__overlay{opacity:1;}.gallery-tile{cursor:default;}}
        .gallery-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.9);padding:2rem;z-index:9999;opacity:0;pointer-events:none;transition:opacity .2s ease;}
        .gallery-overlay.show{opacity:1;pointer-events:auto;}
        .gallery-overlay .gallery-inner{position:relative;width:100%;max-width:min(960px,90vw);}
        .gallery-overlay .gallery-image{width:100%;max-height:calc(100vh - 8rem);border-radius:1rem;object-fit:contain;background:#0f172a;}
        .gallery-overlay .gallery-close{position:absolute;top:-2.5rem;right:0;background:none;border:none;color:#fff;font-size:2.25rem;cursor:pointer;line-height:1;}
        .gallery-overlay .gallery-caption{margin-top:1rem;color:#e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:.75rem;font-size:.875rem;}
        .gallery-overlay .gallery-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(15,23,42,.6);border:none;color:#fff;width:2.75rem;height:2.75rem;border-radius:9999px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.75rem;transition:background .2s ease;}
        .gallery-overlay .gallery-nav:hover{background:rgba(15,23,42,.85);}
        .gallery-overlay .gallery-prev{left:-1.5rem;}
        .gallery-overlay .gallery-next{right:-1.5rem;}
        .gallery-overlay .gallery-counter{font-weight:600;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @media (max-width:640px){
          .gallery-overlay{padding:1rem;}
          .gallery-overlay .gallery-close{top:.5rem;right:.5rem;}
          .gallery-overlay .gallery-nav{bottom:1rem;top:auto;transform:none;}
          .gallery-overlay .gallery-prev{left:1rem;}
          .gallery-overlay .gallery-next{right:1rem;}
          .gallery-overlay .gallery-caption{flex-direction:column;align-items:flex-start;}
        }
      </style>
      <script>
        const HAS_USER = ${hasUser ? 'true' : 'false'};
        const USER_PERMISSIONS = new Set(${JSON.stringify(userPermissions)});
        function userCanClient(perm){ return USER_PERMISSIONS.has(perm); }
        function refreshIcons(){
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        }
        if (document.readyState !== 'loading') {
          refreshIcons();
        } else {
          document.addEventListener('DOMContentLoaded', refreshIcons);
        }
        window.addEventListener('load', refreshIcons);
        document.addEventListener('htmx:afterSwap', refreshIcons);
        function syncCheckout(e){
          const ci = e.target.value; const co = document.getElementById('checkout');
          if (co && co.value && co.value <= ci) { co.value = ci; }
          if (co) co.min = ci;
        }
        const FEEDBACK_ICONS = { info: 'ℹ', success: '✓', warning: '!', danger: '!' };
        function renderFeedback(el, variant, headline, detail){
          if (!el) return;
          el.dataset.variant = variant;
          const icon = FEEDBACK_ICONS[variant] || FEEDBACK_ICONS.info;
          const headlineHtml = '<strong>' + headline + '</strong>';
          const message = detail
            ? '<div>' + headlineHtml + '<br/>' + detail + '</div>'
            : '<div>' + headlineHtml + '</div>';
          el.innerHTML = '<span class="inline-feedback-icon">' + icon + '</span>' + message;
        }
        function enhanceSearchForm(){
          const form = document.querySelector('[data-search-form]');
          if (!form || form.dataset.enhanced === 'true') return;
          form.dataset.enhanced = 'true';
          const checkin = form.querySelector('[name="checkin"]');
          const checkout = form.querySelector('[name="checkout"]');
          const adults = form.querySelector('[name="adults"]');
          const children = form.querySelector('[name="children"]');
          const property = form.querySelector('[name="property_id"]');
          const submit = form.querySelector('[data-submit]');
          const feedback = form.querySelector('[data-feedback]');
          const update = () => {
            let variant = 'info';
            let headline = 'Comece por escolher as datas.';
            let detail = 'Escolha check-in e check-out válidos para ver disponibilidade instantânea.';
            let disabled = true;
            if (checkin && checkin.value && (!checkout || !checkout.value)) {
              variant = 'warning';
              headline = 'Falta indicar a data de saída.';
              detail = 'Escolha uma data de check-out posterior ao check-in para avançar.';
            }
            if (checkin && checkout && checkin.value && checkout.value) {
              const ci = new Date(checkin.value);
              const co = new Date(checkout.value);
              if (co <= ci) {
                variant = 'danger';
                headline = 'Verifique as datas selecionadas.';
                detail = 'O check-out deve ser posterior ao check-in. Ajuste as datas para continuar.';
              } else {
                const diff = Math.round((co - ci) / (1000 * 60 * 60 * 24));
                const guestCount = (() => {
                  const ad = adults ? Math.max(1, Number(adults.value || 1)) : 1;
                  const ch = children ? Math.max(0, Number(children.value || 0)) : 0;
                  let label = ad + ' adulto' + (ad > 1 ? 's' : '');
                  if (ch > 0) {
                    label += ' · ' + ch + ' criança' + (ch > 1 ? 's' : '');
                  }
                  return label;
                })();
                variant = 'success';
                headline = 'Perfeito! Disponibilidade pronta a pesquisar.';
                detail = diff + ' noite' + (diff > 1 ? 's' : '') + ' · ' + guestCount + (property && property.value ? ' · ' + property.options[property.selectedIndex].text : '');
                disabled = false;
              }
            }
            if (submit) {
              submit.disabled = disabled;
              if (disabled) submit.removeAttribute('data-loading');
            }
            renderFeedback(feedback, variant, headline, detail);
          };
          [checkin, checkout, adults, children, property]
            .filter(Boolean)
            .forEach(field => {
              field.addEventListener('input', update);
              field.addEventListener('change', update);
            });
          form.addEventListener('submit', () => {
            if (submit) {
              submit.setAttribute('data-loading', 'true');
            }
          });
          update();
        }
        function enhanceBookingForm(){
          const form = document.querySelector('[data-booking-form]');
          if (!form || form.dataset.enhanced === 'true') return;
          form.dataset.enhanced = 'true';
          const feedback = form.querySelector('[data-booking-feedback]');
          const adults = form.querySelector('input[name="adults"]');
          const children = form.querySelector('input[name="children"]');
          const required = Array.from(form.querySelectorAll('[data-required]'));
          const occupancy = form.querySelector('[data-occupancy-summary]');
          const update = () => {
            const missing = required.filter(field => !String(field.value || '').trim());
            if (occupancy) {
              const ad = adults ? Math.max(0, Number(adults.value || 0)) : 0;
              const ch = children ? Math.max(0, Number(children.value || 0)) : 0;
              let summary = ad + ' adulto' + (ad !== 1 ? 's' : '');
              if (ch > 0) summary += ' · ' + ch + ' criança' + (ch !== 1 ? 's' : '');
              occupancy.textContent = summary;
            }
            if (missing.length > 0) {
              const first = missing[0];
              const label = first.getAttribute('placeholder') || first.getAttribute('aria-label') || (first.previousElementSibling ? first.previousElementSibling.textContent.trim() : 'campo obrigatório');
              renderFeedback(feedback, 'warning', 'Ainda falta completar os dados.', 'Preencha ' + label.toLowerCase() + ' para finalizar com segurança.');
            } else {
              renderFeedback(feedback, 'success', 'Tudo pronto para confirmar!', 'Revise os dados e confirme para bloquear imediatamente a estadia.');
            }
          };
          required.forEach(field => {
            field.addEventListener('input', update);
            field.addEventListener('change', update);
          });
          [adults, children]
            .filter(Boolean)
            .forEach(field => {
              field.addEventListener('input', update);
              field.addEventListener('change', update);
            });
          update();
        }
        function initFrontOffice(){
          enhanceSearchForm();
          enhanceBookingForm();
        }
        if (document.readyState !== 'loading') {
          initFrontOffice();
        } else {
          document.addEventListener('DOMContentLoaded', initFrontOffice);
        }
        document.addEventListener('htmx:afterSwap', initFrontOffice);
        if (HAS_USER) {
          window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'm' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
              window.location.href = '/calendar';
            }
          });
        }

        // Lightbox / Galeria
        (function(){
          let overlay;
          let imgEl;
          let captionEl;
          let counterEl;
          let prevBtn;
          let nextBtn;
          const state = { images: [], index: 0 };

          function ensureOverlay() {
            if (overlay) return;
            overlay = document.createElement('div');
            overlay.className = 'gallery-overlay';
            overlay.innerHTML = [
              '<div class="gallery-inner">',
              '  <button type="button" class="gallery-close" data-gallery-close>&times;</button>',
              '  <img class="gallery-image" src="" alt="" />',
              '  <button type="button" class="gallery-nav gallery-prev" data-gallery-prev>&lsaquo;</button>',
              '  <button type="button" class="gallery-nav gallery-next" data-gallery-next>&rsaquo;</button>',
              '  <div class="gallery-caption">',
              '    <span class="gallery-counter"></span>',
              '    <span class="gallery-text"></span>',
              '  </div>',
              '</div>'
            ].join('');
            document.body.appendChild(overlay);
            imgEl = overlay.querySelector('.gallery-image');
            captionEl = overlay.querySelector('.gallery-text');
            counterEl = overlay.querySelector('.gallery-counter');
            prevBtn = overlay.querySelector('[data-gallery-prev]');
            nextBtn = overlay.querySelector('[data-gallery-next]');

            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) {
                closeOverlay();
              }
            });
            overlay.querySelector('[data-gallery-close]').addEventListener('click', (e) => {
              e.stopPropagation();
              closeOverlay();
            });
            prevBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              showPrev();
            });
            nextBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              showNext();
            });
          }

          function openOverlay(images, index) {
            if (!Array.isArray(images) || !images.length) return;
            ensureOverlay();
            state.images = images;
            state.index = Math.min(Math.max(index, 0), images.length - 1);
            renderImage();
            overlay.classList.add('show');
            document.body.classList.add('gallery-open');
          }

          function closeOverlay() {
            if (!overlay) return;
            overlay.classList.remove('show');
            document.body.classList.remove('gallery-open');
          }

          function renderImage() {
            if (!overlay || !state.images.length) return;
            const current = state.images[state.index];
            if (!current) return;
            imgEl.src = current.url;
            imgEl.alt = current.alt || '';
            captionEl.textContent = current.alt || '';
            if (state.images.length > 1) {
              counterEl.textContent = (state.index + 1) + ' / ' + state.images.length;
              prevBtn.style.display = 'flex';
              nextBtn.style.display = 'flex';
            } else {
              counterEl.textContent = '';
              prevBtn.style.display = 'none';
              nextBtn.style.display = 'none';
            }
          }

          function showNext() {
            if (!state.images.length) return;
            state.index = (state.index + 1) % state.images.length;
            renderImage();
          }

          function showPrev() {
            if (!state.images.length) return;
            state.index = (state.index - 1 + state.images.length) % state.images.length;
            renderImage();
          }

          document.addEventListener('click', (e) => {
            const trigger = e.target.closest('[data-gallery-trigger]');
            if (!trigger) return;
            e.preventDefault();
            const payload = trigger.getAttribute('data-gallery-images');
            if (!payload) return;
            let images;
            try {
              images = JSON.parse(payload);
            } catch (_) {
              images = [];
            }
            const index = Number(trigger.getAttribute('data-gallery-index') || 0) || 0;
            openOverlay(images, index);
          });

          document.addEventListener('keydown', (e) => {
            if (!overlay || !overlay.classList.contains('show')) return;
            if (e.key === 'Escape') {
              closeOverlay();
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              showNext();
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              showPrev();
            }
          });
        })();
      </script>
    </head>
    <body class="app-body">
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a href="/" class="brand" aria-label="Booking Engine">
              <span class="brand-logo">BE</span>
              <span class="brand-name">Booking Engine</span>
            </a>
            <nav class="nav-links">
              <a class="${navClass('search')}" href="/search">Pesquisar</a>
              ${can('calendar.view') ? `<a class="${navClass('calendar')}" href="/calendar">Mapa de reservas</a>` : ``}
              ${can('dashboard.view') ? `<a class="${navClass('backoffice')}" href="/admin">Backoffice</a>` : ``}
              ${can('bookings.view') ? `<a class="${navClass('bookings')}" href="/admin/bookings">Reservas</a>` : ``}
              ${can('audit.view') || can('logs.view') ? `<a class="${navClass('audit')}" href="/admin/auditoria">Auditoria</a>` : ``}
              ${can('users.manage') ? `<a class="${navClass('users')}" href="/admin/utilizadores">Utilizadores</a>` : ''}
            </nav>
            <div class="nav-actions">
              ${user
                ? `<div class="pill-indicator">${esc(user.username)} · ${esc(user.role_label)}</div>
                   <form method="post" action="/logout" class="logout-form">
                     <button type="submit">Log-out</button>
                   </form>`
                : `<a class="login-link" href="/login">Login</a>`}
            </div>
          </div>
          <div class="nav-accent-bar"></div>
        </header>
        <main class="main-content">
          ${body}
        </main>
        <footer class="footer">
          <div class="footer-inner">(c) ${new Date().getFullYear()} Booking Engine (demo)</div>
        </footer>
      </div>
    </body>
  </html>`;
}

// ===================== Auth =====================
app.get('/login', (req,res)=>{
  const { error, next: nxt } = req.query;
  res.send(layout({ title: 'Login', body: html`
    <div class="max-w-md mx-auto card p-6">
      <h1 class="text-xl font-semibold mb-4">Login Backoffice</h1>
      ${error ? `<div class="mb-3 text-sm text-rose-600">${error}</div>`: ''}
      <form method="post" action="/login" class="grid gap-3">
        ${nxt ? `<input type="hidden" name="next" value="${nxt}"/>` : ''}
        <input name="username" class="input" placeholder="Utilizador" required />
        <input name="password" type="password" class="input" placeholder="Palavra-passe" required />
        <button class="btn btn-primary">Entrar</button>
      </form>
    </div>
  `}));
});
app.post('/login', (req,res)=>{
  const { username, password, next: nxt } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(String(password), u.password_hash)) return res.redirect('/login?error=Credenciais inválidas');
  const normalizedRole = normalizeRole(u.role);
  if (normalizedRole !== u.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, u.id);
    u.role = normalizedRole;
  }
  const token = createSession(u.id);
  const secure = !!process.env.FORCE_SECURE_COOKIE || (!!process.env.SSL_KEY_PATH && !!process.env.SSL_CERT_PATH);
  res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure });
  logSessionEvent(u.id, 'login', req);
  logActivity(u.id, 'auth:login', null, null, {});
  res.redirect(nxt || '/admin');
});
app.post('/logout', (req,res)=>{
  const sess = getSession(req.cookies.adm);
  if (sess) {
    logSessionEvent(sess.user_id, 'logout', req);
    logActivity(sess.user_id, 'auth:logout', null, null, {});
  }
  destroySession(req.cookies.adm);
  res.clearCookie('adm');
  res.redirect('/');
});

// ===================== Front Office =====================
app.get('/', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;
  const properties = db.prepare('SELECT * FROM properties ORDER BY name').all();
  const canEditBooking = userCan(req.user, 'bookings.edit');
  const canCancelBooking = userCan(req.user, 'bookings.cancel');

  res.send(layout({
    title: 'Reservas',
    user,
    activeNav: 'search',
    body: html`
      <section class="search-hero">
        <span class="pill-indicator">Passo 1 de 3</span>
        <h1 class="search-title">Reservar connosco é simples e seguro</h1>
        <p class="search-intro">Escolha as datas ideais e veja em segundos as unidades disponíveis. Apostamos em clareza total: preços transparentes, mensagens imediatas e confirmações instantâneas.</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step is-active">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step">3. Confirme e relaxe</li>
        </ul>
        <form action="/search" method="get" class="search-form" data-search-form>
          <div class="search-field">
            <label for="checkin">Datas</label>
            <div class="search-dates">
              <input required type="date" id="checkin" name="checkin" class="search-input" onchange="syncCheckout(event)"/>
              <input required type="date" id="checkout" name="checkout" class="search-input"/>
            </div>
          </div>
          <div class="search-field">
            <label for="adults">Adultos</label>
            <input type="number" min="1" id="adults" name="adults" value="2" class="search-input"/>
          </div>
          <div class="search-field">
            <label for="children">Crianças</label>
            <input type="number" min="0" id="children" name="children" value="0" class="search-input"/>
          </div>
          <div class="search-field">
            <label for="property_id">Propriedade</label>
            <select id="property_id" name="property_id" class="search-input">
              <option value="">Todas</option>
              ${properties.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="search-submit">
            <button class="search-button" type="submit" data-submit>Procurar</button>
          </div>
          <div class="inline-feedback" data-feedback data-variant="info" aria-live="polite" role="status">
            <span class="inline-feedback-icon">ℹ</span>
            <div><strong>Comece por escolher as datas.</strong><br/>Escolha check-in e check-out válidos para ver disponibilidade instantânea.</div>
          </div>
        </form>
      </section>
    `
  }));
});

app.get('/search', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { checkin, checkout, property_id } = req.query;
  const adults = Math.max(1, Number(req.query.adults ?? 1));
  const children = Math.max(0, Number(req.query.children ?? 0));
  const totalGuests = adults + children;
  if (!checkin || !checkout) return res.redirect('/');

  const units = db.prepare(
    `SELECT u.*, p.name as property_name FROM units u JOIN properties p ON p.id = u.property_id
     WHERE (? IS NULL OR u.property_id = ?)
       AND u.capacity >= ?
     ORDER BY p.name, u.name`
  ).all(property_id || null, property_id || null, Number(totalGuests));

  const imageStmt = db.prepare(
    'SELECT file, alt FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 4'
  );

  const available = units
    .filter(u => unitAvailable(u.id, checkin, checkout))
    .map(u => {
      const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
      const images = imageStmt.all(u.id).map(img => {
        const rawAlt = img.alt || `${u.property_name} - ${u.name}`;
        return {
          url: `/uploads/units/${u.id}/${img.file}`,
          alt: rawAlt,
          safeAlt: esc(rawAlt)
        };
      });
      const features = parseFeaturesStored(u.features);
      return { ...u, quote, images, features };
    })
    .filter(u => u.quote.nights >= u.quote.minStayReq)
    .sort((a,b)=> a.quote.total_cents - b.quote.total_cents);

  res.send(layout({
    title: 'Resultados',
    user,
    activeNav: 'search',
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Passo 2 de 3</span>
        <h1 class="text-2xl font-semibold">Alojamentos disponíveis</h1>
        <p class="text-slate-600">
          ${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
          · ${adults} adulto(s)${children?` + ${children} criança(s)`:''}
        </p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step is-active">2. Escolha o alojamento</li>
          <li class="progress-step">3. Confirme e relaxe</li>
        </ul>
        <div class="inline-feedback" data-variant="info" aria-live="polite" role="status">
          <span class="inline-feedback-icon">💡</span>
          <div><strong>Selecione a unidade perfeita.</strong><br/>Clique em "Reservar" para confirmar em apenas mais um passo.</div>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        ${available.map(u => {
          const galleryData = esc(JSON.stringify(u.images.map(img => ({ url: img.url, alt: img.alt }))));
          const thumbCount = Math.min(Math.max(u.images.length - 1, 0), 3);
          const gridClass = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'][thumbCount - 1] || '';
          const thumbMarkup = thumbCount > 0
            ? `<div class="grid ${gridClass} gap-2 mb-3">
                ${u.images.slice(1, 1 + thumbCount).map((img, idx) => `
                  <button type="button" class="block overflow-hidden rounded" data-gallery-trigger data-gallery-images="${galleryData}" data-gallery-index="${idx + 1}">
                    <img src="${img.url}" alt="${img.safeAlt}" class="w-full h-20 object-cover" loading="lazy" />
                  </button>
                `).join('')}
              </div>`
            : '';
          const mainImage = u.images.length
            ? `<div class="relative mb-3">
                <button type="button" class="block w-full overflow-hidden rounded-md" data-gallery-trigger data-gallery-images="${galleryData}" data-gallery-index="0">
                  <img src="${u.images[0].url}" alt="${u.images[0].safeAlt}" class="w-full h-48 object-cover" loading="lazy" />
                </button>
                ${u.images.length > 1 ? `<div class="absolute bottom-2 right-2 bg-slate-900/75 text-white text-xs px-2 py-1 rounded">${u.images.length} foto${u.images.length > 1 ? 's' : ''}</div>` : ''}
              </div>
              ${thumbMarkup}`
            : '<div class="h-48 bg-slate-100 rounded flex items-center justify-center text-slate-400 mb-3">Sem fotos disponíveis</div>';
          const featuresHtml = featureChipsHtml(u.features, {
            className: 'flex flex-wrap gap-2 text-xs text-slate-600 mb-3',
            badgeClass: 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full',
            iconWrapClass: 'inline-flex items-center justify-center text-emerald-700'
          });
          return html`
            <div class="card p-4">
              ${mainImage}
              ${featuresHtml}
              <div class="flex items-center justify-between mb-2">
                <div>
                  <div class="text-sm text-slate-500">${u.property_name}</div>
                  <h3 class="text-lg font-semibold">${u.name}</h3>
                </div>
                <div class="text-right">
                  <div class="text-xs text-slate-500">desde/noite</div>
                  <div class="text-xl font-semibold flex items-center justify-end gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(u.base_price_cents)}</div>
                </div>
              </div>
              <p class="text-sm text-slate-600 mb-1">Capacidade: ${u.capacity} - Estadia min.: ${u.quote.minStayReq} noites</p>
              <p class="text-sm text-slate-700 mb-3">Total estadia: <strong class="inline-flex items-center gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(u.quote.total_cents)}</strong></p>
              <a class="btn btn-primary" href="/book/${u.id}?checkin=${checkin}&checkout=${checkout}&adults=${adults}&children=${children}">Reservar</a>
            </div>
          `;
        }).join('')}
      </div>
      ${available.length === 0 ? `<div class="p-6 bg-amber-50 border border-amber-200 rounded-xl">Sem disponibilidade para os critérios selecionados.</div>`: ''}
    `
  }));
});

app.get('/book/:unitId', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { unitId } = req.params;
  const { checkin, checkout } = req.query;
  const adults = Math.max(1, Number(req.query.adults ?? 2));
  const children = Math.max(0, Number(req.query.children ?? 0));
  const totalGuests = adults + children;

  const u = db
    .prepare('SELECT u.*, p.name as property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?')
    .get(unitId);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (!checkin || !checkout) return res.redirect('/');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);
  if (!unitAvailable(u.id, checkin, checkout)) return res.status(409).send('Este alojamento já não tem disponibilidade.');

  const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
  if (quote.nights < quote.minStayReq) return res.status(400).send('Estadia mínima: ' + quote.minStayReq + ' noites');
  const total = quote.total_cents;
  const unitFeaturesBooking = featureChipsHtml(parseFeaturesStored(u.features), { className: 'flex flex-wrap gap-2 text-xs text-slate-600 mt-3', badgeClass: 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full', iconWrapClass: 'inline-flex items-center justify-center text-emerald-700' });

  res.send(layout({
    title: 'Confirmar Reserva',
    user,
    activeNav: 'search',
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Passo 3 de 3</span>
        <h1 class="text-2xl font-semibold">${u.property_name} – ${u.name}</h1>
        <p class="text-slate-600">Último passo antes de garantir a estadia.</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">3. Confirme e relaxe</li>
        </ul>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="card p-4">
          <h2 class="font-semibold mb-3">Detalhes da reserva</h2>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>Check-in: <strong>${dayjs(checkin).format('DD/MM/YYYY')}</strong></li>
            <li>Check-out: <strong>${dayjs(checkout).format('DD/MM/YYYY')}</strong></li>
            <li>Noites: <strong>${quote.nights}</strong></li>
            <li>Hóspedes: <strong data-occupancy-summary>${adults} adulto(s)${children?` + ${children} criança(s)`:''}</strong></li>
            <li>Estadia mínima aplicada: <strong>${quote.minStayReq} noites</strong></li>
            <li>Total: <strong class="inline-flex items-center gap-1"><i data-lucide="euro" class="w-4 h-4"></i>${eur(total)}</strong></li>
          </ul>
          ${unitFeaturesBooking}
        </div>
        <form class="card p-4" method="post" action="/book" data-booking-form>
          <h2 class="font-semibold mb-3">Dados do hóspede</h2>
          <p class="text-sm text-slate-500 mb-3">Confirmamos a reserva assim que estes dados forem submetidos. Usamos esta informação apenas para contacto com o hóspede.</p>
          <input type="hidden" name="unit_id" value="${u.id}" />
          <input type="hidden" name="checkin" value="${checkin}" />
          <input type="hidden" name="checkout" value="${checkout}" />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="text-sm">Adultos</label>
              <input required type="number" min="1" name="adults" value="${adults}" class="input"/>
            </div>
            <div>
              <label class="text-sm">Crianças</label>
              <input required type="number" min="0" name="children" value="${children}" class="input"/>
            </div>
          </div>
          <div class="inline-feedback mt-4" data-booking-feedback data-variant="info" aria-live="polite" role="status">
            <span class="inline-feedback-icon">ℹ</span>
            <div><strong>Preencha os dados do hóspede.</strong><br/>Os campos abaixo permitem-nos enviar a confirmação personalizada.</div>
          </div>
          <div class="grid gap-3 mt-2">
            <input required name="guest_name" class="input" placeholder="Nome completo" data-required />
            <input required name="guest_nationality" class="input" placeholder="Nacionalidade" data-required />
            <input required name="guest_phone" class="input" placeholder="Telefone/Telemóvel" data-required />
            <input required type="email" name="guest_email" class="input" placeholder="Email" data-required />
            ${user ? `
              <div>
                <label class="text-sm">Agencia</label>
                <input name="agency" class="input" placeholder="Ex: BOOKING" list="agency-options" required data-required />
              </div>
            ` : ''}
            <button class="btn btn-primary">Confirmar Reserva</button>
          </div>
          ${user ? `
            <datalist id="agency-options">
              <option value="BOOKING"></option>
              <option value="EXPEDIA"></option>
              <option value="AIRBNB"></option>
              <option value="DIRECT"></option>
            </datalist>
          ` : ''}
        </form>
      </div>
    `
  }));
});

app.post('/book', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const { unit_id, guest_name, guest_email, guest_nationality, guest_phone, checkin, checkout } = req.body;
  const adults = Math.max(1, Number(req.body.adults ?? 1));
  const children = Math.max(0, Number(req.body.children ?? 0));
  const totalGuests = adults + children;
  const agencyRaw = req.body.agency;
  const agency = agencyRaw ? String(agencyRaw).trim().toUpperCase() : null;
  if (user && !agency) return res.status(400).send('Agencia obrigatória para reservas internas.');
  const agencyValue = agency || 'DIRECT';

  const u = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id);
  if (!u) return res.status(404).send('Unidade não encontrada');
  if (u.capacity < totalGuests) return res.status(400).send(`Capacidade máx. da unidade: ${u.capacity}.`);

  const trx = db.transaction(() => {
    const conflicts = db.prepare(
      `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING') AND NOT (checkout <= ? OR checkin >= ?)
       UNION ALL
       SELECT 1 FROM blocks WHERE unit_id = ? AND NOT (end_date <= ? OR start_date >= ?)`
    ).all(unit_id, checkin, checkout, unit_id, checkin, checkout);
    if (conflicts.length > 0) throw new Error('conflict');

    const quote = rateQuote(u.id, checkin, checkout, u.base_price_cents);
    if (quote.nights < quote.minStayReq) throw new Error('minstay:'+quote.minStayReq);
    const total = quote.total_cents;

    const stmt = db.prepare(
      `INSERT INTO bookings(unit_id, guest_name, guest_email, guest_nationality, guest_phone, agency, adults, children, checkin, checkout, total_cents, status, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const r = stmt.run(unit_id, guest_name, guest_email, guest_nationality || null, guest_phone || null,
                       agencyValue, adults, children, checkin, checkout, total, 'CONFIRMED', null);
    return r.lastInsertRowid;
  });

  try {
    const id = trx();
    res.redirect(`/booking/${id}`);
  } catch (e) {
    if (e.message === 'conflict') return res.status(409).send('Datas indisponíveis. Tente novamente.');
    if (e.message && e.message.startsWith('minstay:')) return res.status(400).send('Estadia mínima: ' + e.message.split(':')[1] + ' noites');
    console.error(e);
    res.status(500).send('Erro ao criar reserva');
  }
});

app.get('/booking/:id', (req, res) => {
  const sess = getSession(req.cookies.adm);
  const user = sess ? { id: sess.user_id, username: sess.username, role: sess.role } : undefined;

  const b = db.prepare(
    `SELECT b.*, u.name as unit_name, p.name as property_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?`
  ).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  res.send(layout({
    title: 'Reserva Confirmada',
    user,
    activeNav: 'search',
    body: html`
      <div class="result-header">
        <span class="pill-indicator">Reserva finalizada</span>
        <h1 class="text-2xl font-semibold">Reserva confirmada</h1>
        <p class="text-slate-600">Enviámos a confirmação para ${b.guest_email}. Obrigado por reservar connosco!</p>
        <ul class="progress-steps" aria-label="Passos da reserva">
          <li class="progress-step">1. Defina datas</li>
          <li class="progress-step">2. Escolha o alojamento</li>
          <li class="progress-step is-active">3. Confirme e relaxe</li>
        </ul>
      </div>
      <div class="card p-6 space-y-6">
        <div class="inline-feedback" data-variant="success" aria-live="polite" role="status">
          <span class="inline-feedback-icon">✓</span>
          <div><strong>Reserva garantida!</strong><br/>A unidade ficou bloqueada para si e pode preparar a chegada com tranquilidade.</div>
        </div>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <div class="font-semibold">${b.property_name} – ${b.unit_name}</div>
            <div>Hóspede: <strong>${b.guest_name}</strong> ${b.guest_nationality?`<span class="text-slate-500">(${b.guest_nationality})</span>`:''}</div>
            <div>Contacto: <strong>${b.guest_phone || '-'}</strong> &middot; <strong>${b.guest_email}</strong></div>
            <div>Ocupação: <strong>${b.adults} adulto(s)${b.children?` + ${b.children} criança(s)`:''}</strong></div>
            ${b.agency ? `<div>Agencia: <strong>${b.agency}</strong></div>` : ''}
            <div>Check-in: <strong>${dayjs(b.checkin).format('DD/MM/YYYY')}</strong></div>
            <div>Check-out: <strong>${dayjs(b.checkout).format('DD/MM/YYYY')}</strong></div>
            <div>Noites: ${dateRangeNights(b.checkin, b.checkout).length}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Total</div>
            <div class="text-3xl font-semibold">€ ${eur(b.total_cents)}</div>
            <div class="text-xs text-slate-500">Status: ${b.status}</div>
          </div>
        </div>
        <div class="mt-2"><a class="btn btn-primary" href="/">Nova pesquisa</a></div>
      </div>
    `
  }));
});

// ===================== Calendário (privado) =====================
app.get('/calendar', requireLogin, requirePermission('calendar.view'), (req, res) => {
  const ym = req.query.ym; // YYYY-MM
  const base = ym ? dayjs(ym + '-01') : dayjs().startOf('month');
  const month = base.startOf('month');
  const prev = month.subtract(1, 'month').format('YYYY-MM');
  const next = month.add(1, 'month').format('YYYY-MM');

  const units = db.prepare(
    'SELECT u.*, p.name as property_name ' +
    'FROM units u JOIN properties p ON p.id = u.property_id ' +
    'ORDER BY p.name, u.name'
  ).all();
  const canExportCalendar = userCan(req.user, 'bookings.export');

  res.send(layout({
    title: 'Mapa de Reservas',
    user: req.user,
    activeNav: 'calendar',
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Mapa de Reservas</h1>
      <div class="flex items-center justify-between mb-4">
        <a class="btn btn-muted" href="/calendar?ym=${prev}">Mês anterior: ${formatMonthYear(prev + '-01')}</a>
        <div class="text-slate-600">Mês de ${formatMonthYear(month)}</div>
        <a class="btn btn-muted" href="/calendar?ym=${next}">Mês seguinte: ${formatMonthYear(next + '-01')}</a>
      </div>
      <div class="text-sm mb-3 flex gap-3 items-center">
        <span class="inline-block w-3 h-3 rounded bg-emerald-500"></span> Livre
        <span class="inline-block w-3 h-3 rounded bg-rose-500"></span> Ocupado
        <span class="inline-block w-3 h-3 rounded bg-amber-400"></span> Pendente
        <span class="inline-block w-3 h-3 rounded bg-red-600"></span> Bloqueado
        <span class="inline-block w-3 h-3 rounded bg-slate-200 ml-3"></span> Fora do mês
        ${canExportCalendar ? `<a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>` : ''}
      </div>
      <div class="space-y-6" data-calendar data-month="${month.format('YYYY-MM')}" data-calendar-fetch="/calendar/unit/:id/card">
        ${units.map(u => unitCalendarCard(u, month)).join('')}
      </div>
      <div class="calendar-action" data-calendar-action hidden></div>
      <div class="calendar-toast" data-calendar-toast hidden><span class="calendar-toast__dot"></span><span data-calendar-toast-message></span></div>
      <script>
        (function(){
          const root = document.querySelector('[data-calendar]');
          if (!root) return;
          const actionEl = document.querySelector('[data-calendar-action]');
          const toastEl = document.querySelector('[data-calendar-toast]');
          const toastMessage = toastEl ? toastEl.querySelector('[data-calendar-toast-message]') : null;
          const fetchTemplate = root.getAttribute('data-calendar-fetch');
          const month = root.getAttribute('data-month');
          let actionCtx = null;
          let dragCtx = null;
          let selectionCtx = null;
          let toastTimer = null;
          const CAN_RESCHEDULE = userCanClient('calendar.reschedule');
          const CAN_CANCEL_CALENDAR = userCanClient('calendar.cancel');
          const CAN_CREATE_BLOCK = userCanClient('calendar.block.create');
          const CAN_DELETE_BLOCK = userCanClient('calendar.block.delete');
          const CAN_MANAGE_BLOCK = userCanClient('calendar.block.manage');
          const CAN_VIEW_BOOKING = userCanClient('bookings.view');

          function isPrimaryPointer(e) {
            if (e.pointerType === 'mouse') {
              return typeof e.button === 'number' ? e.button === 0 : e.isPrimary !== false;
            }
            return true;
          }

          function parseDate(str) {
            if (!str) return null;
            const parts = str.split('-').map(Number);
            if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
            return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
          }

          function toISO(date) {
            return date.toISOString().slice(0, 10);
          }

          function shiftDate(str, delta) {
            const base = parseDate(str);
            if (!base) return null;
            base.setUTCDate(base.getUTCDate() + delta);
            return toISO(base);
          }

          function diffDays(start, end) {
            const a = parseDate(start);
            const b = parseDate(end);
            if (!a || !b) return 0;
            return Math.round((b - a) / 86400000);
          }

          function formatHuman(str) {
            const date = parseDate(str);
            if (!date) return str;
            return date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
          }

          function clearHighlight(className) {
            root.querySelectorAll('.' + className).forEach(function(cell){
              cell.classList.remove(className);
            });
          }

          function highlightRange(unitId, start, endExclusive, className) {
            clearHighlight(className);
            if (!start || !endExclusive) return;
            const cells = Array.prototype.slice.call(root.querySelectorAll('[data-calendar-cell][data-unit="' + unitId + '"]'));
            cells.forEach(function(cell){
              const date = cell.getAttribute('data-date');
              if (date && date >= start && date < endExclusive) {
                cell.classList.add(className);
              }
            });
          }

          function rangeHasConflicts(unitId, start, endExclusive, currentId, currentKind) {
            const cells = Array.prototype.slice.call(root.querySelectorAll('[data-calendar-cell][data-unit="' + unitId + '"]'));
            return cells.some(function(cell){
              const date = cell.getAttribute('data-date');
              if (!date || date < start || date >= endExclusive) return false;
              const otherId = cell.getAttribute('data-entry-id');
              if (!otherId) return false;
              const otherKind = cell.getAttribute('data-entry-kind');
              if (otherId === currentId && otherKind === currentKind) return false;
              return true;
            });
          }

          function showToast(message, variant) {
            if (!toastEl || !toastMessage) return;
            toastEl.setAttribute('data-variant', variant || 'success');
            toastMessage.textContent = message;
            toastEl.hidden = false;
            if (toastTimer) window.clearTimeout(toastTimer);
            toastTimer = window.setTimeout(function(){ toastEl.hidden = true; }, 3200);
          }

          function hideAction() {
            if (!actionEl) return;
            actionEl.hidden = true;
            actionEl.innerHTML = '';
            actionCtx = null;
          }

          function showAction(config) {
            if (!actionEl) return;
            actionCtx = config;
            actionEl.style.left = config.clientX + 'px';
            actionEl.style.top = (config.clientY - 12) + 'px';
            actionEl.innerHTML = config.html;
            actionEl.hidden = false;
          }

          function refreshUnitCard(unitId) {
            const card = root.querySelector('[data-unit-card="' + unitId + '"]');
            if (!card || !fetchTemplate) return;
            card.setAttribute('data-loading', 'true');
            const url = fetchTemplate.replace(':id', unitId) + '?ym=' + month;
            fetch(url, { headers: { 'X-Requested-With': 'fetch' } })
              .then(function(res){ return res.text(); })
              .then(function(html){
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html.trim();
                const nextCard = wrapper.firstElementChild;
                if (nextCard) {
                  card.replaceWith(nextCard);
                } else {
                  card.removeAttribute('data-loading');
                }
                hideAction();
              })
              .catch(function(){
                card.removeAttribute('data-loading');
                showToast('Não foi possível atualizar o calendário.', 'danger');
                hideAction();
              });
          }

          function submitReschedule(ctx, range) {
            let url;
            let payload;
            if (ctx.entryKind === 'BOOKING') {
              url = '/calendar/booking/' + ctx.entryId + '/reschedule';
              payload = { checkin: range.start, checkout: range.end };
            } else {
              url = '/calendar/block/' + ctx.entryId + '/reschedule';
              payload = { start_date: range.start, end_date: range.end };
            }
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
              .then(function(res){
                return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                  return { res: res, data: data };
                });
              })
              .then(function(result){
                const ok = result.res && result.res.ok && result.data && result.data.ok;
                if (ok) {
                  showToast(result.data.message || 'Atualizado com sucesso', 'success');
                  refreshUnitCard(result.data.unit_id || ctx.unitId);
                } else {
                  showToast(result.data && result.data.message ? result.data.message : 'Não foi possível reagendar.', 'danger');
                  refreshUnitCard(ctx.unitId);
                }
              })
              .catch(function(){
                showToast('Erro de rede ao guardar.', 'danger');
                refreshUnitCard(ctx.unitId);
              });
          }

          function submitBlock(unitId, start, endExclusive) {
            fetch('/calendar/unit/' + unitId + '/block', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ start_date: start, end_date: endExclusive })
            })
              .then(function(res){
                return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                  return { res: res, data: data };
                });
              })
              .then(function(result){
                const ok = result.res && result.res.ok && result.data && result.data.ok;
                if (ok) {
                  showToast(result.data.message || 'Bloqueio criado.', 'success');
                  refreshUnitCard(unitId);
                } else {
                  showToast(result.data && result.data.message ? result.data.message : 'Não foi possível bloquear estas datas.', 'danger');
                  refreshUnitCard(unitId);
                }
              })
              .catch(function(){
                showToast('Erro de rede ao bloquear datas.', 'danger');
                refreshUnitCard(unitId);
              });
          }

          function submitBlockRemoval(blockId, unitId) {
            fetch('/calendar/block/' + blockId, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' }
            })
              .then(function(res){
                return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                  return { res: res, data: data };
                });
              })
              .then(function(result){
                const ok = result.res && result.res.ok && result.data && result.data.ok;
                if (ok) {
                  showToast(result.data.message || 'Bloqueio removido.', 'success');
                  refreshUnitCard(unitId);
                } else {
                  showToast(result.data && result.data.message ? result.data.message : 'Não foi possível remover o bloqueio.', 'danger');
                  refreshUnitCard(unitId);
                }
              })
              .catch(function(){
                showToast('Erro ao remover bloqueio.', 'danger');
                refreshUnitCard(unitId);
              });
          }

          function escapeHtml(str) {
            return String(str == null ? '' : str)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          }

          function formatStatusLabel(status) {
            switch ((status || '').toUpperCase()) {
              case 'CONFIRMED':
                return 'Reserva confirmada';
              case 'PENDING':
                return 'Reserva pendente';
              case 'BLOCK':
                return 'Bloqueio';
              default:
                return status ? 'Estado: ' + status : '';
            }
          }

          function formatGuestSummary(adults, children) {
            const parts = [];
            if (adults > 0) parts.push(adults + ' ' + (adults === 1 ? 'adulto' : 'adultos'));
            if (children > 0) parts.push(children + ' ' + (children === 1 ? 'criança' : 'crianças'));
            return parts.join(' · ');
          }

          function showEntryActions(cell) {
            if (!cell) return;
            const entryId = cell.getAttribute('data-entry-id');
            if (!entryId) return;
            const entryKind = cell.getAttribute('data-entry-kind');
            const status = cell.getAttribute('data-entry-status') || '';
            const guest = cell.getAttribute('data-entry-guest') || '';
            const label = cell.getAttribute('data-entry-label') || '';
            const start = cell.getAttribute('data-entry-start');
            const end = cell.getAttribute('data-entry-end');
            const url = cell.getAttribute('data-entry-url');
            const cancelUrl = cell.getAttribute('data-entry-cancel-url');
            const historyUrl = '/admin/auditoria?entity=' + encodeURIComponent(entryKind === 'BOOKING' ? 'booking' : 'block') + '&id=' + encodeURIComponent(entryId);
            const rect = cell.getBoundingClientRect();
            let html = '<div class="calendar-action__card">';
            if (entryKind === 'BOOKING') {
              const email = cell.getAttribute('data-entry-email') || '';
              const phone = cell.getAttribute('data-entry-phone') || '';
              const adults = Number(cell.getAttribute('data-entry-adults') || '0');
              const children = Number(cell.getAttribute('data-entry-children') || '0');
              const guestSummary = formatGuestSummary(adults, children);
              const nights = diffDays(start, end);
              const statusLabel = formatStatusLabel(status);
              html += '<div class="calendar-action__title">' + escapeHtml(guest || 'Reserva') + '</div>';
              if (statusLabel) {
                html += '<div class="text-xs text-slate-300 uppercase tracking-wide">' + escapeHtml(statusLabel) + '</div>';
              }
              html += '<div class="text-sm text-slate-200">' + formatHuman(start) + ' – ' + formatHuman(shiftDate(end, -1));
              if (nights > 0) {
                html += ' · ' + nights + ' ' + (nights === 1 ? 'noite' : 'noites');
              }
              html += '</div>';
              if (guestSummary) {
                html += '<div class="text-sm text-slate-200">' + escapeHtml(guestSummary) + '</div>';
              }
              if (email || phone) {
                html += '<div class="text-xs text-slate-300 leading-relaxed">';
                if (email) {
                  const mailHref = 'mailto:' + encodeURIComponent(email.trim());
                  html += '<div><span class="text-slate-400 uppercase tracking-wide">Email</span> <a class="text-white underline" href="' + mailHref + '">' + escapeHtml(email) + '</a></div>';
                }
                if (phone) {
                  const telHref = 'tel:' + encodeURIComponent(phone.replace(/\s+/g, ''));
                  html += '<div><span class="text-slate-400 uppercase tracking-wide">Telefone</span> <a class="text-white underline" href="' + telHref + '">' + escapeHtml(phone) + '</a></div>';
                }
                html += '</div>';
              }
              if (label) {
                html += '<div class="text-xs text-slate-300">' + escapeHtml(label) + '</div>';
              }
              const noteCount = Number(cell.getAttribute('data-entry-note-count') || '0');
              const notePreview = cell.getAttribute('data-entry-note-preview') || '';
              const noteMeta = cell.getAttribute('data-entry-note-meta') || '';
              if (noteCount > 0 && notePreview) {
                html += '<div class="text-xs text-slate-200 bg-slate-900/30 rounded-lg p-2 leading-relaxed">';
                html += '<div class="font-semibold">Última nota (' + escapeHtml(noteMeta || noteCount + (noteCount === 1 ? ' nota' : ' notas')) + ')</div>';
                html += '<div class="text-slate-100 whitespace-pre-line mt-1">' + escapeHtml(notePreview) + (notePreview.length >= 180 ? '…' : '') + '</div>';
                if (noteCount > 1) {
                  html += '<div class="mt-1 text-slate-400">' + noteCount + ' notas no total.</div>';
                }
                html += '</div>';
              }
              html += '<div class="calendar-action__buttons">';
              if (url && CAN_VIEW_BOOKING) html += '<a class="btn btn-light" href="' + url + '">Ver detalhes</a>';
              if (CAN_CANCEL_CALENDAR) {
                html += '<button class="btn btn-danger" data-action="cancel-booking" data-cancel-url="' + (cancelUrl || '') + '">Cancelar reserva</button>';
              }
              html += '</div>';
              html += '<a class="text-xs text-slate-200 underline" href="' + historyUrl + '">Ver histórico de alterações</a>';
              if (status !== 'CONFIRMED') {
                html += '<p class="text-xs text-amber-200">Arrastar para reagendar está disponível apenas para reservas confirmadas.</p>';
              } else if (!CAN_RESCHEDULE) {
                html += '<p class="text-xs text-amber-200">Não tem permissões para reagendar arrastando.</p>';
              } else {
                html += '<p class="text-xs text-slate-300">Arrasta para ajustar rapidamente as datas.</p>';
              }
            } else {
              html += '<div class="calendar-action__title">Bloqueio</div>';
              html += '<div class="text-sm text-slate-200">' + formatHuman(start) + ' – ' + formatHuman(shiftDate(end, -1)) + '</div>';
              if (label) {
                html += '<div class="text-xs text-slate-300">' + escapeHtml(label) + '</div>';
              }
              html += '<div class="calendar-action__buttons">';
              html += '<a class="btn btn-muted" href="' + historyUrl + '">Histórico</a>';
              if (CAN_DELETE_BLOCK) {
                html += '<button class="btn btn-danger" data-action="delete-block" data-block-id="' + entryId + '">Remover bloqueio</button>';
              }
              html += '</div>';
              if (CAN_MANAGE_BLOCK) {
                html += '<p class="text-xs text-slate-300">Clique e arrasta para mover o bloqueio.</p>';
              } else {
                html += '<p class="text-xs text-amber-200">Não tem permissões para mover este bloqueio.</p>';
              }
            }
            html += '</div>';
            showAction({ html: html, clientX: rect.left + rect.width / 2, clientY: rect.top });
            actionCtx = { type: 'entry', entryId: entryId, entryKind: entryKind, unitId: cell.getAttribute('data-unit'), cancelUrl: cancelUrl };
          }

          function normalizeRange(a, b) {
            if (!a || !b) return { start: a, endExclusive: shiftDate(a, 1), end: b };
            if (a <= b) {
              return { start: a, endExclusive: shiftDate(b, 1), end: b };
            }
            return { start: b, endExclusive: shiftDate(a, 1), end: a };
          }

          function showSelectionActions(ctx) {
            const humanStart = formatHuman(ctx.start);
            const humanEnd = formatHuman(shiftDate(ctx.end, -1));
            const nights = diffDays(ctx.start, ctx.end);
            let html = '<div class="calendar-action__card">';
            html += '<div class="calendar-action__title">' + (nights > 1 ? nights + ' noites selecionadas' : nights + ' noite selecionada') + '</div>';
            html += '<div class="text-sm text-slate-200">' + humanStart + ' – ' + humanEnd + '</div>';
            html += '<div class="calendar-action__buttons">';
            const disableBlock = ctx.conflict || !CAN_CREATE_BLOCK;
            html += '<button class="btn btn-primary" data-action="block-range"' + (disableBlock ? ' disabled' : '') + '>Bloquear estas datas</button>';
            html += '<a class="btn btn-light" href="/admin/units/' + ctx.unitId + '">Ver detalhes</a>';
            html += '</div>';
            if (ctx.conflict) {
              html += '<p class="text-xs text-rose-200">Existem reservas nesta seleção.</p>';
            } else if (!CAN_CREATE_BLOCK) {
              html += '<p class="text-xs text-amber-200">Não tem permissões para criar bloqueios.</p>';
            } else {
              html += '<p class="text-xs text-slate-300">Sem reservas nesta seleção.</p>';
            }
            html += '</div>';
            showAction({ html: html, clientX: ctx.clientX, clientY: ctx.clientY });
            actionCtx = { type: 'selection', unitId: ctx.unitId, start: ctx.start, end: ctx.end, conflict: ctx.conflict };
          }

          function onPointerDown(e) {
            if (!isPrimaryPointer(e)) return;
            const cell = e.target.closest('[data-calendar-cell]');
            if (!cell) return;
            if (cell.getAttribute('data-in-month') !== '1') return;
            hideAction();
            const entryId = cell.getAttribute('data-entry-id');
            if (entryId) {
              const entryKind = cell.getAttribute('data-entry-kind');
              const status = cell.getAttribute('data-entry-status') || '';
              const reschedPermission = entryKind === 'BOOKING'
                ? (CAN_RESCHEDULE && status === 'CONFIRMED')
                : CAN_MANAGE_BLOCK;
              dragCtx = {
                entryId: entryId,
                entryKind: entryKind,
                status: status,
                canReschedule: reschedPermission,
                unitId: cell.getAttribute('data-unit'),
                originStart: cell.getAttribute('data-entry-start'),
                originEnd: cell.getAttribute('data-entry-end'),
                anchorDate: cell.getAttribute('data-date'),
                pointerStart: { x: e.clientX, y: e.clientY },
                moved: false,
                preview: null,
                conflict: false
              };
            } else {
              if (!CAN_CREATE_BLOCK) return;
              selectionCtx = {
                unitId: cell.getAttribute('data-unit'),
                startDate: cell.getAttribute('data-date'),
                endDate: cell.getAttribute('data-date'),
                pointerStart: { x: e.clientX, y: e.clientY },
                active: true
              };
              highlightRange(selectionCtx.unitId, selectionCtx.startDate, shiftDate(selectionCtx.startDate, 1), 'calendar-cell--selection');
            }
          }

          function onPointerMove(e) {
            if (dragCtx) {
              if (!dragCtx.canReschedule) return;
              if (!dragCtx.moved) {
                const delta = Math.abs(e.clientX - dragCtx.pointerStart.x) + Math.abs(e.clientY - dragCtx.pointerStart.y);
                if (delta > 5) dragCtx.moved = true;
              }
              if (!dragCtx.moved) return;
              const el = document.elementFromPoint(e.clientX, e.clientY);
              const cell = el && el.closest('[data-calendar-cell][data-unit="' + dragCtx.unitId + '"]');
              if (!cell) return;
              const hoverDate = cell.getAttribute('data-date');
              if (!hoverDate) return;
              const anchorOffset = diffDays(dragCtx.originStart, dragCtx.anchorDate);
              const duration = diffDays(dragCtx.originStart, dragCtx.originEnd);
              const newStart = shiftDate(hoverDate, -anchorOffset);
              const newEnd = shiftDate(newStart, duration);
              dragCtx.preview = { start: newStart, end: newEnd };
              dragCtx.conflict = rangeHasConflicts(dragCtx.unitId, newStart, newEnd, dragCtx.entryId, dragCtx.entryKind);
              highlightRange(dragCtx.unitId, newStart, newEnd, 'calendar-cell--preview');
              if (dragCtx.conflict) {
                highlightRange(dragCtx.unitId, newStart, newEnd, 'calendar-cell--invalid');
              } else {
                clearHighlight('calendar-cell--invalid');
              }
              e.preventDefault();
            } else if (selectionCtx && selectionCtx.active) {
              const targetEl = document.elementFromPoint(e.clientX, e.clientY);
              const targetCell = targetEl && targetEl.closest('[data-calendar-cell][data-unit="' + selectionCtx.unitId + '"]');
              if (!targetCell) return;
              const targetDate = targetCell.getAttribute('data-date');
              if (!targetDate || targetDate === selectionCtx.endDate) return;
              selectionCtx.endDate = targetDate;
              const range = normalizeRange(selectionCtx.startDate, selectionCtx.endDate);
              highlightRange(selectionCtx.unitId, range.start, range.endExclusive, 'calendar-cell--selection');
            }
          }

          function onPointerUp(e) {
            if (dragCtx) {
              const preview = dragCtx.preview;
              const wasDragging = dragCtx.moved;
              const conflict = dragCtx.conflict;
              if (!wasDragging) {
                clearHighlight('calendar-cell--preview');
                clearHighlight('calendar-cell--invalid');
                dragCtx = null;
                return;
              }
              clearHighlight('calendar-cell--preview');
              clearHighlight('calendar-cell--invalid');
              const changed = preview && (preview.start !== dragCtx.originStart || preview.end !== dragCtx.originEnd);
              const ctxCopy = dragCtx;
              dragCtx = null;
              if (preview && !conflict && changed) {
                submitReschedule(ctxCopy, preview);
              } else if (conflict) {
                showToast('As novas datas entram em conflito com outra ocupação.', 'danger');
                refreshUnitCard(ctxCopy.unitId);
              }
            } else if (selectionCtx && selectionCtx.active) {
              const range = normalizeRange(selectionCtx.startDate, selectionCtx.endDate);
              clearHighlight('calendar-cell--selection');
              const conflict = rangeHasConflicts(selectionCtx.unitId, range.start, range.endExclusive);
              showSelectionActions({
                unitId: selectionCtx.unitId,
                start: range.start,
                end: range.endExclusive,
                conflict: conflict,
                clientX: e.clientX,
                clientY: e.clientY
              });
              selectionCtx = null;
            }
          }

          function onDoubleClick(e) {
            if (e.button !== 0) return;
            const cell = e.target.closest('[data-calendar-cell]');
            if (!cell) return;
            if (cell.getAttribute('data-in-month') !== '1') return;
            const entryId = cell.getAttribute('data-entry-id');
            if (!entryId) return;
            dragCtx = null;
            hideAction();
            showEntryActions(cell);
          }

          function onActionClick(e) {
            const target = e.target.closest('[data-action]');
            if (!target || !actionCtx) return;
            const action = target.getAttribute('data-action');
            if (action === 'block-range' && actionCtx.type === 'selection') {
              if (!CAN_CREATE_BLOCK) return;
              e.preventDefault();
              hideAction();
              submitBlock(actionCtx.unitId, actionCtx.start, actionCtx.end);
            }
            if (action === 'delete-block' && actionCtx.type === 'entry') {
              if (!CAN_DELETE_BLOCK) return;
              e.preventDefault();
              hideAction();
              submitBlockRemoval(target.getAttribute('data-block-id'), actionCtx.unitId);
            }
            if (action === 'cancel-booking' && actionCtx.type === 'entry' && actionCtx.entryKind === 'BOOKING') {
              if (!CAN_CANCEL_CALENDAR) return;
              e.preventDefault();
              const proceed = window.confirm('Cancelar esta reserva?');
              if (!proceed) return;
              const cancelUrl = target.getAttribute('data-cancel-url') || actionCtx.cancelUrl || ('/calendar/booking/' + actionCtx.entryId + '/cancel');
              const unitId = actionCtx.unitId;
              fetch(cancelUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
              })
                .then(function(res){
                  return res.json().catch(function(){ return { ok: false, message: 'Erro inesperado' }; }).then(function(data){
                    return { res: res, data: data };
                  });
                })
                .then(function(result){
                  const ok = result.res && result.res.ok && result.data && result.data.ok;
                  if (ok) {
                    showToast(result.data.message || 'Reserva cancelada.', 'info');
                    refreshUnitCard(unitId);
                  } else {
                    showToast(result.data && result.data.message ? result.data.message : 'Não foi possível cancelar.', 'danger');
                    refreshUnitCard(unitId);
                  }
                })
                .catch(function(){
                  showToast('Erro ao cancelar a reserva.', 'danger');
                  refreshUnitCard(unitId);
                });
            }
          }

          function onDocumentClick(e) {
            if (!actionEl || actionEl.hidden) return;
            if (!actionEl.contains(e.target)) hideAction();
          }

          function onKeyDown(e) {
            if (e.key === 'Escape') {
              clearHighlight('calendar-cell--selection');
              clearHighlight('calendar-cell--preview');
              clearHighlight('calendar-cell--invalid');
              hideAction();
              dragCtx = null;
              selectionCtx = null;
            }
          }

          root.addEventListener('pointerdown', onPointerDown);
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          root.addEventListener('dblclick', onDoubleClick);
          if (actionEl) actionEl.addEventListener('click', onActionClick);
          document.addEventListener('click', onDocumentClick);
          document.addEventListener('keydown', onKeyDown);
        })();
      </script>
    `
  }));
});

app.get('/calendar/unit/:id/card', requireLogin, requirePermission('calendar.view'), (req, res) => {
  const ym = req.query.ym;
  const month = (ym ? dayjs(ym + '-01') : dayjs().startOf('month')).startOf('month');
  const unit = db.prepare(`
    SELECT u.*, p.name as property_name
      FROM units u JOIN properties p ON p.id = u.property_id
     WHERE u.id = ?
  `).get(req.params.id);
  if (!unit) return res.status(404).send('');
  res.send(unitCalendarCard(unit, month));
});

app.post('/calendar/booking/:id/reschedule', requireLogin, requirePermission('calendar.reschedule'), (req, res) => {
  const id = Number(req.params.id);
  const booking = db.prepare(`
    SELECT b.*, u.base_price_cents
      FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.id = ?
  `).get(id);
  if (!booking) return res.status(404).json({ ok: false, message: 'Reserva não encontrada.' });

  const checkin = req.body && req.body.checkin;
  const checkout = req.body && req.body.checkout;
  if (!checkin || !checkout) return res.status(400).json({ ok: false, message: 'Datas inválidas.' });
  if (!dayjs(checkout).isAfter(dayjs(checkin))) return res.status(400).json({ ok: false, message: 'checkout deve ser > checkin' });

  const conflict = db.prepare(`
    SELECT 1 FROM bookings
     WHERE unit_id = ?
       AND id <> ?
       AND status IN ('CONFIRMED','PENDING')
       AND NOT (checkout <= ? OR checkin >= ?)
     LIMIT 1
  `).get(booking.unit_id, booking.id, checkin, checkout);
  if (conflict) return res.status(409).json({ ok: false, message: 'Conflito com outra reserva.' });

  const blockConflict = db.prepare(`
    SELECT 1 FROM blocks
     WHERE unit_id = ?
       AND NOT (end_date <= ? OR start_date >= ?)
     LIMIT 1
  `).get(booking.unit_id, checkin, checkout);
  if (blockConflict) return res.status(409).json({ ok: false, message: 'As novas datas estão bloqueadas.' });

  const quote = rateQuote(booking.unit_id, checkin, checkout, booking.base_price_cents);
  if (quote.nights < quote.minStayReq)
    return res.status(400).json({ ok: false, message: `Estadia mínima: ${quote.minStayReq} noites.` });

  rescheduleBookingUpdateStmt.run(checkin, checkout, quote.total_cents, booking.id);

  logChange(req.user.id, 'booking', booking.id, 'reschedule',
    { checkin: booking.checkin, checkout: booking.checkout, total_cents: booking.total_cents },
    { checkin, checkout, total_cents: quote.total_cents }
  );

  res.json({ ok: true, message: 'Reserva reagendada.', unit_id: booking.unit_id });
});

app.post('/calendar/booking/:id/cancel', requireLogin, requirePermission('calendar.cancel'), (req, res) => {
  const id = Number(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ ok: false, message: 'Reserva não encontrada.' });

  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  logChange(req.user.id, 'booking', id, 'cancel', {
    checkin: booking.checkin,
    checkout: booking.checkout,
    guest_name: booking.guest_name,
    status: booking.status,
    unit_id: booking.unit_id
  }, null);

  res.json({ ok: true, message: 'Reserva cancelada.', unit_id: booking.unit_id });
});

app.post('/calendar/block/:id/reschedule', requireLogin, requirePermission('calendar.block.manage'), (req, res) => {
  const id = Number(req.params.id);
  const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  if (!block) return res.status(404).json({ ok: false, message: 'Bloqueio não encontrado.' });

  const start = req.body && req.body.start_date;
  const end = req.body && req.body.end_date;
  if (!start || !end) return res.status(400).json({ ok: false, message: 'Datas inválidas.' });
  if (!dayjs(end).isAfter(dayjs(start))) return res.status(400).json({ ok: false, message: 'end_date deve ser > start_date' });

  const bookingConflict = db.prepare(`
    SELECT 1 FROM bookings
     WHERE unit_id = ?
       AND status IN ('CONFIRMED','PENDING')
       AND NOT (checkout <= ? OR checkin >= ?)
     LIMIT 1
  `).get(block.unit_id, start, end);
  if (bookingConflict) return res.status(409).json({ ok: false, message: 'Existem reservas neste período.' });

  const blockConflict = db.prepare(`
    SELECT 1 FROM blocks
     WHERE unit_id = ?
       AND id <> ?
       AND NOT (end_date <= ? OR start_date >= ?)
     LIMIT 1
  `).get(block.unit_id, block.id, start, end);
  if (blockConflict) return res.status(409).json({ ok: false, message: 'Conflito com outro bloqueio.' });

  rescheduleBlockUpdateStmt.run(start, end, block.id);

  logChange(req.user.id, 'block', block.id, 'reschedule',
    { start_date: block.start_date, end_date: block.end_date },
    { start_date: start, end_date: end }
  );

  res.json({ ok: true, message: 'Bloqueio atualizado.', unit_id: block.unit_id });
});

app.post('/calendar/unit/:unitId/block', requireLogin, requirePermission('calendar.block.create'), (req, res) => {
  const unitId = Number(req.params.unitId);
  const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
  if (!unit) return res.status(404).json({ ok: false, message: 'Unidade não encontrada.' });

  const start = req.body && req.body.start_date;
  const end = req.body && req.body.end_date;
  if (!start || !end) return res.status(400).json({ ok: false, message: 'Datas inválidas.' });
  if (!dayjs(end).isAfter(dayjs(start))) return res.status(400).json({ ok: false, message: 'end_date deve ser > start_date' });

  const bookingConflict = db.prepare(`
    SELECT 1 FROM bookings
     WHERE unit_id = ?
       AND status IN ('CONFIRMED','PENDING')
       AND NOT (checkout <= ? OR checkin >= ?)
     LIMIT 1
  `).get(unitId, start, end);
  if (bookingConflict) return res.status(409).json({ ok: false, message: 'Existem reservas nestas datas.' });

  const blockConflict = db.prepare(`
    SELECT 1 FROM blocks
     WHERE unit_id = ?
       AND NOT (end_date <= ? OR start_date >= ?)
     LIMIT 1
  `).get(unitId, start, end);
  if (blockConflict) return res.status(409).json({ ok: false, message: 'Já existe um bloqueio neste período.' });

  const inserted = insertBlockStmt.run(unitId, start, end);

  logChange(req.user.id, 'block', inserted.lastInsertRowid, 'create', null, { start_date: start, end_date: end, unit_id: unitId });

  res.json({ ok: true, message: 'Bloqueio criado.', unit_id: unitId });
});

app.delete('/calendar/block/:id', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
  const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ ok: false, message: 'Bloqueio não encontrado.' });
  db.prepare('DELETE FROM blocks WHERE id = ?').run(block.id);
  logChange(req.user.id, 'block', block.id, 'delete', { start_date: block.start_date, end_date: block.end_date }, null);
  res.json({ ok: true, message: 'Bloqueio removido.', unit_id: block.unit_id });
});

function unitCalendarCard(u, month) {
  const monthStart = month.startOf('month');
  const daysInMonth = month.daysInMonth();
  const weekdayOfFirst = (monthStart.day() + 6) % 7;
  const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

  const rawEntries = db.prepare(
    `SELECT 'BOOKING' as kind, id, checkin as s, checkout as e, guest_name, guest_email, guest_phone, status, adults, children, total_cents, agency
       FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
     UNION ALL
     SELECT 'BLOCK' as kind, id, start_date as s, end_date as e, 'Bloqueio' as guest_name, NULL as guest_email, NULL as guest_phone, 'BLOCK' as status, NULL as adults, NULL as children, NULL as total_cents, NULL as agency
       FROM blocks WHERE unit_id = ?`
  ).all(u.id, u.id).map(row => ({
    ...row,
    label: row.kind === 'BLOCK'
      ? 'Bloqueio de datas'
      : `${row.guest_name || 'Reserva'} (${row.adults || 0}A+${row.children || 0}C)`,
  }));

  const bookingIds = rawEntries.filter(row => row.kind === 'BOOKING').map(row => row.id);
  const noteCounts = new Map();
  const noteLatest = new Map();
  if (bookingIds.length) {
    const placeholders = bookingIds.map(() => '?').join(',');
    const countsStmt = db.prepare(`SELECT booking_id, COUNT(*) AS c FROM booking_notes WHERE booking_id IN (${placeholders}) GROUP BY booking_id`);
    countsStmt.all(...bookingIds).forEach(row => noteCounts.set(row.booking_id, row.c));
    const latestStmt = db.prepare(`
      SELECT bn.booking_id, bn.note, bn.created_at, u.username
        FROM booking_notes bn
        JOIN users u ON u.id = bn.user_id
       WHERE bn.booking_id IN (${placeholders})
       ORDER BY bn.booking_id, bn.created_at DESC
    `);
    latestStmt.all(...bookingIds).forEach(row => {
      if (!noteLatest.has(row.booking_id)) {
        noteLatest.set(row.booking_id, {
          note: row.note,
          username: row.username,
          created_at: row.created_at
        });
      }
    });
  }

  const entries = rawEntries.map(row => {
    if (row.kind === 'BOOKING') {
      const latest = noteLatest.get(row.id) || null;
      const preview = latest && latest.note ? String(latest.note).slice(0, 180) : '';
      const meta = latest ? `${latest.username} · ${dayjs(latest.created_at).format('DD/MM HH:mm')}` : '';
      return {
        ...row,
        label: `${row.guest_name || 'Reserva'} (${row.adults || 0}A+${row.children || 0}C)`,
        note_count: noteCounts.get(row.id) || 0,
        note_preview: preview,
        note_meta: meta
      };
    }
    return {
      ...row,
      label: 'Bloqueio de datas',
      note_count: 0,
      note_preview: '',
      note_meta: ''
    };
  });

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayIndexInMonth = i - weekdayOfFirst + 1;
    const inMonth = dayIndexInMonth >= 1 && dayIndexInMonth <= daysInMonth;
    const d = monthStart.add(i - weekdayOfFirst, 'day');

    const date = d.format('YYYY-MM-DD');
    const nextDate = d.add(1, 'day').format('YYYY-MM-DD');

    const hit = entries.find(en => overlaps(en.s, en.e, date, nextDate));
    const classNames = ['calendar-cell'];
    if (!inMonth) {
      classNames.push('bg-slate-100', 'text-slate-400');
    } else if (!hit) {
      classNames.push('bg-emerald-500', 'text-white');
    } else if (hit.status === 'BLOCK') {
      classNames.push('bg-red-600', 'text-white');
    } else if (hit.status === 'PENDING') {
      classNames.push('bg-amber-400', 'text-black');
    } else {
      classNames.push('bg-rose-500', 'text-white');
    }

    const dataAttrs = [
      'data-calendar-cell',
      `data-unit="${u.id}"`,
      `data-date="${date}"`,
      `data-in-month="${inMonth ? 1 : 0}"`,
    ];

    if (hit) {
      dataAttrs.push(
        `data-entry-id="${hit.id}"`,
        `data-entry-kind="${hit.kind}"`,
        `data-entry-start="${hit.s}"`,
        `data-entry-end="${hit.e}"`,
        `data-entry-status="${hit.status}"`,
        `data-entry-label="${esc(hit.label)}"`
      );
      if (hit.kind === 'BOOKING') {
        dataAttrs.push(
          `data-entry-url="/admin/bookings/${hit.id}"`,
          `data-entry-cancel-url="/calendar/booking/${hit.id}/cancel"`,
          `data-entry-agency="${esc(hit.agency || '')}"`,
          `data-entry-total="${hit.total_cents || 0}"`,
          `data-entry-guest="${esc(hit.guest_name || '')}"`,
          `data-entry-email="${esc(hit.guest_email || '')}"`,
          `data-entry-phone="${esc(hit.guest_phone || '')}"`,
          `data-entry-adults="${hit.adults || 0}"`,
          `data-entry-children="${hit.children || 0}"`,
          `data-entry-note-count="${hit.note_count || 0}"`,
          `data-entry-note-preview="${esc(hit.note_preview || '')}"`,
          `data-entry-note-meta="${esc(hit.note_meta || '')}"`
        );
      }
    }

    const title = hit ? ` title="${(hit.label || '').replace(/"/g, "'")}"` : '';
    cells.push(`<div class="${classNames.join(' ')}" ${dataAttrs.join(' ')}${title}>${d.date()}</div>`);
  }

  const weekdayHeader = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']
    .map(w => `<div class="text-center text-xs text-slate-500 py-1">${w}</div>`)
    .join('');
  return `
    <div class="card p-4 calendar-card" data-unit-card="${u.id}" data-unit-name="${esc(u.name)}">
      <div class="flex items-center justify-between mb-2">
        <div>
          <div class="text-sm text-slate-500">${u.property_name}</div>
          <h3 class="text-lg font-semibold">${u.name}</h3>
        </div>
        <a class="text-slate-600 hover:text-slate-900" href="/admin/units/${u.id}">Gerir</a>
      </div>
      <div class="calendar-grid mb-1">${weekdayHeader}</div>
      <div class="calendar-grid" data-calendar-unit="${u.id}">${cells.join('')}</div>
    </div>
  `;
}

// ===================== Export Excel (privado) =====================
app.get('/admin/export', requireLogin, requirePermission('bookings.export'), (req,res)=>{
  const ymDefault = dayjs().format('YYYY-MM');
  res.send(layout({
    title: 'Exportar Mapa (Excel)',
    user: req.user,
    activeNav: 'export',
    body: html`
      <a class="text-slate-600" href="/calendar">&larr; Voltar ao Mapa</a>
      <h1 class="text-2xl font-semibold mb-4">Exportar Mapa de Reservas (Excel)</h1>
      <form method="get" action="/admin/export/download" class="card p-4 grid gap-3 max-w-md">
        <div>
          <label class="text-sm">Mês inicial</label>
          <input type="month" name="ym" value="${ymDefault}" class="input" required />
        </div>
        <div>
          <label class="text-sm">Quantos meses (1–12)</label>
          <input type="number" min="1" max="12" name="months" value="1" class="input" required />
        </div>
        <button class="btn btn-primary">Descarregar Excel</button>
      </form>
      <p class="text-sm text-slate-500 mt-3">Uma folha por mês. Cada linha = unidade; colunas = dias. Reservas em blocos unidos.</p>
    `
  }));
});

// Excel estilo Gantt + tabela de detalhes
app.get('/admin/export/download', requireLogin, requirePermission('bookings.export'), async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  const months = Math.min(12, Math.max(1, Number(req.query.months || 1)));
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).send('Parâmetro ym inválido (YYYY-MM)');
  const start = dayjs(ym + '-01');
  if (!start.isValid()) return res.status(400).send('Data inválida.');

  const wb = new ExcelJS.Workbook();

  const units = db.prepare(`
    SELECT u.id, u.name as unit_name, p.name as property_name
      FROM units u
      JOIN properties p ON p.id = u.property_id
     ORDER BY p.name, u.name
  `).all();

  const entriesStmt = db.prepare(`
    SELECT * FROM (
      SELECT 'BOOKING' AS kind, b.id, b.checkin, b.checkout, b.guest_name, b.adults, b.children, b.status
        FROM bookings b
       WHERE b.unit_id = ? AND NOT (b.checkout <= ? OR b.checkin >= ?)
      UNION ALL
      SELECT 'BLOCK' AS kind, bl.id, bl.start_date AS checkin, bl.end_date AS checkout,
             'BLOQUEADO' AS guest_name, NULL AS adults, NULL AS children, 'BLOCK' AS status
        FROM blocks bl
       WHERE bl.unit_id = ? AND NOT (bl.end_date <= ? OR bl.start_date >= ?)
    )
    ORDER BY checkin
  `);

  const bookingsMonthStmt = db.prepare(`
    SELECT b.*, u.name AS unit_name, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE NOT (b.checkout <= ? OR b.checkin >= ?)
     ORDER BY b.checkin, b.guest_name
  `);

  const numberToLetters = idx => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let n = idx;
    let label = '';
    do {
      label = alphabet[n % 26] + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  };

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF93C47D' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
  const weekendFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const bookingFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6AA84F' } };
  const pendingFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
  const blockFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };

  const formatGuestCount = (adults, children) => {
    const parts = [];
    if (typeof adults === 'number') parts.push(`${adults}A`);
    if (typeof children === 'number' && children > 0) parts.push(`${children}C`);
    return parts.join('+');
  };

  const allCaps = str => {
    if (!str) return '';
    return str
      .split(' ')
      .map(word => (word ? word[0].toUpperCase() + word.slice(1) : ''))
      .join(' ');
  };

  for (let i = 0; i < months; i++) {
    const month = start.add(i, 'month');
    const sheetName = month.format('YYYY_MM');
    const ws = wb.addWorksheet(sheetName);
    ws.properties.defaultRowHeight = 22;

    const daysInMonth = month.daysInMonth();
    const monthStartObj = month.startOf('month');
    const monthStart = monthStartObj.format('YYYY-MM-DD');
    const monthEndExcl = monthStartObj.endOf('month').add(1, 'day').format('YYYY-MM-DD');
    const monthLabel = month.format("MMM'YY").replace('.', '');

    const dayNames = [''];
    const dayNumbers = [''];
    const weekendColumns = new Set();
    for (let d = 0; d < daysInMonth; d++) {
      const date = monthStartObj.add(d, 'day');
      const dow = date.day();
      const weekday = date.locale('pt').format('ddd');
      const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      dayNames.push(label);
      dayNumbers.push(date.format('DD'));
      if (dow === 0 || dow === 6) weekendColumns.add(d + 2);
    }

    const dayNameRow = ws.addRow(dayNames);
    const dayNumberRow = ws.addRow(dayNumbers);
    dayNameRow.height = 20;
    dayNumberRow.height = 20;

    ws.mergeCells(dayNameRow.number, 1, dayNumberRow.number, 1);
    const monthCell = ws.getCell(dayNameRow.number, 1);
    monthCell.value = monthLabel;
    monthCell.fill = headerFill;
    monthCell.font = headerFont;
    monthCell.alignment = { vertical: 'middle', horizontal: 'center' };

    [dayNameRow, dayNumberRow].forEach(r => {
      r.eachCell((cell, colNumber) => {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        if (weekendColumns.has(colNumber)) cell.fill = weekendFill;
        cell.font = { bold: r === dayNameRow };
      });
    });

    const MIN_DAY_WIDTH = 6.5;
    const MAX_DAY_WIDTH = 20;
    let maxDayWidth = MIN_DAY_WIDTH;

    ws.getColumn(1).width = 28;
    for (let col = 2; col <= daysInMonth + 1; col++) {
      ws.getColumn(col).width = MIN_DAY_WIDTH;
    }

    const bookingsForMonth = bookingsMonthStmt.all(monthStart, monthEndExcl);
    const refByBookingId = new Map();
    bookingsForMonth.forEach((booking, idx) => {
      refByBookingId.set(booking.id, numberToLetters(idx));
    });

    for (const u of units) {
      const nameRow = ws.addRow(['', ...Array(daysInMonth).fill('')]);
      const occRow = ws.addRow(['', ...Array(daysInMonth).fill('')]);
      nameRow.height = 20;
      occRow.height = 24;

      ws.mergeCells(nameRow.number, 1, occRow.number, 1);
      const unitCell = ws.getCell(nameRow.number, 1);
      unitCell.value = u.property_name === u.unit_name
        ? allCaps(u.unit_name)
        : `${allCaps(u.property_name)}\n${allCaps(u.unit_name)}`;
      unitCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      unitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
      unitCell.font = { bold: true, color: { argb: 'FF1F2937' } };

      const entries = entriesStmt.all(u.id, monthStart, monthEndExcl, u.id, monthStart, monthEndExcl);

      for (const entry of entries) {
        const startDate = dayjs.max(dayjs(entry.checkin), monthStartObj);
        const endDateExclusive = dayjs.min(dayjs(entry.checkout), dayjs(monthEndExcl));
        const startOffset = startDate.diff(monthStartObj, 'day');
        const endOffset = endDateExclusive.diff(monthStartObj, 'day');
        const startCol = Math.max(2, startOffset + 2);
        const endCol = Math.min(daysInMonth + 1, endOffset + 1);
        if (endCol < startCol) continue;

        ws.mergeCells(nameRow.number, startCol, nameRow.number, endCol);
        ws.mergeCells(occRow.number, startCol, occRow.number, endCol);

        const nameCell = ws.getCell(nameRow.number, startCol);
        const occCell = ws.getCell(occRow.number, startCol);

        const isBooking = entry.kind === 'BOOKING';
        const ref = isBooking ? refByBookingId.get(entry.id) : null;
        const guestCount = isBooking ? formatGuestCount(entry.adults || 0, entry.children || 0) : '';

        nameCell.value = entry.guest_name;
        nameCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        nameCell.font = { bold: true, color: { argb: 'FF111827' } };

        const occLabel = entry.status === 'BLOCK'
          ? 'BLOQUEADO'
          : `${ref ? `(${ref}) ` : ''}${guestCount}`.trim();

        if (entry.status === 'BLOCK') {
          occCell.fill = blockFill;
          occCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        } else {
          const fill = entry.status === 'PENDING' ? pendingFill : bookingFill;
          const fontColor = entry.status === 'PENDING' ? 'FF1F2937' : 'FFFFFFFF';
          occCell.fill = fill;
          occCell.font = { bold: true, color: { argb: fontColor } };
        }
        occCell.value = occLabel;
        occCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

        const span = endCol - startCol + 1;
        const labelChars = Math.max(String(nameCell.value || '').length, occLabel.length);
        const totalTargetWidth = Math.max(10, Math.min(80, labelChars * 1.1));
        const perColumnWidth = Math.max(MIN_DAY_WIDTH, Math.min(MAX_DAY_WIDTH, totalTargetWidth / span));
        maxDayWidth = Math.max(maxDayWidth, perColumnWidth);
      }

      for (const col of weekendColumns) {
        [nameRow, occRow].forEach(row => {
          const cell = row.getCell(col);
          const empty = cell.value === undefined || cell.value === null || String(cell.value).trim() === '';
          if (empty && !cell.isMerged) {
            cell.fill = weekendFill;
          }
        });
      }
    }

    const finalDayWidth = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, maxDayWidth));
    for (let col = 2; col <= daysInMonth + 1; col++) {
      ws.getColumn(col).width = finalDayWidth;
    }

    ws.addRow([]);

    const detailHeaders = [
      'Ref',
      'Nome',
      'Agência',
      'País',
      'Nr Hóspedes',
      'Nr Noites',
      'Data entrada',
      'Data saída',
      'Tlm',
      'Email',
      'Nr Quartos',
      'Hora Check-in',
      'Outras Informações',
      'Valor total a pagar',
      'Pré-pagamento 30%',
      'A pagar no check-out',
      'Fatura',
      'Data Pré-Pagamento',
      'Dados pagamento',
      'Dados faturação'
    ];

    const detailMonthRow = ws.addRow([monthLabel, ...Array(detailHeaders.length - 1).fill('')]);
    ws.mergeCells(detailMonthRow.number, 1, detailMonthRow.number, detailHeaders.length);
    const detailMonthCell = ws.getCell(detailMonthRow.number, 1);
    detailMonthCell.value = monthLabel;
    detailMonthCell.fill = headerFill;
    detailMonthCell.font = headerFont;
    detailMonthCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const headerRow = ws.addRow(detailHeaders);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 24;

    const currencyColumns = new Set([14, 15, 16]);
    const defaultDetailWidths = [6, 24, 14, 8, 12, 10, 12, 12, 14, 30, 10, 12, 24, 16, 16, 16, 10, 16, 22, 22];
    defaultDetailWidths.forEach((w, idx) => {
      const colIndex = idx + 1;
      const currentWidth = ws.getColumn(colIndex).width || 10;
      ws.getColumn(colIndex).width = Math.max(currentWidth, w);
    });

    bookingsForMonth.forEach((booking, idx) => {
      const ref = refByBookingId.get(booking.id) || numberToLetters(idx);
      const totalCents = booking.total_cents;
      const prepaymentCents = Math.round(totalCents * 0.3);
      const checkoutCents = totalCents - prepaymentCents;
      const nights = dayjs(booking.checkout).diff(dayjs(booking.checkin), 'day');
      const guestCount = (booking.adults || 0) + (booking.children || 0);

      const detailRow = ws.addRow([
        ref,
        booking.guest_name,
        booking.agency || '',
        booking.guest_nationality || '',
        guestCount,
        nights,
        dayjs(booking.checkin).format('DD/MMM'),
        dayjs(booking.checkout).format('DD/MMM'),
        booking.guest_phone || '',
        booking.guest_email || '',
        1,
        '',
        booking.status === 'PENDING' ? 'PENDENTE' : '',
        totalCents / 100,
        prepaymentCents / 100,
        checkoutCents / 100,
        '',
        '',
        '',
        ''
      ]);

      detailRow.eachCell((cell, colNumber) => {
        if (currencyColumns.has(colNumber)) {
          cell.numFmt = '#,##0.00';
          cell.font = { color: { argb: 'FF1F2937' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if ([5, 6, 11].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        }
      });
    });

    ws.eachRow(r => {
      r.eachCell(c => {
        c.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
      });
    });
  }

  const filename =
    months === 1
      ? `mapa_${start.format('YYYY_MM')}.xlsx`
      : `mapa_${start.format('YYYY_MM')}_+${months - 1}m.xlsx`;

  logActivity(req.user.id, 'export:calendar_excel', null, null, { ym, months });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ===================== Backoffice (protegido) =====================
app.get('/admin', requireLogin, requirePermission('dashboard.view'), (req, res) => {
  const props = db.prepare('SELECT * FROM properties ORDER BY name').all();
  const unitsRaw = db.prepare(
    `SELECT u.*, p.name as property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.name`
  ).all();
  const units = unitsRaw.map(u => ({ ...u, unit_type: deriveUnitType(u) }));
  const recentBookings = db.prepare(
    `SELECT b.*, u.name as unit_name, p.name as property_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
       JOIN properties p ON p.id = u.property_id
      ORDER BY b.created_at DESC
      LIMIT 12`
  ).all();

  const automationData = ensureAutomationFresh(5) || automationCache;
  const automationMetrics = automationData.metrics || {};
  const automationNotifications = automationData.notifications || [];
  const automationSuggestions = automationData.tariffSuggestions || [];
  const automationBlocks = automationData.generatedBlocks || [];
  const automationDaily = (automationData.summaries && automationData.summaries.daily) || [];
  const automationWeekly = (automationData.summaries && automationData.summaries.weekly) || [];
  const automationLastRun = automationData.lastRun ? dayjs(automationData.lastRun).format('DD/MM HH:mm') : '—';
  const automationRevenue7 = automationData.revenue ? automationData.revenue.next7 || 0 : 0;
  const totalUnitsCount = automationMetrics.totalUnits || units.length || 0;

  const unitTypeOptions = Array.from(new Set(units.map(u => u.unit_type).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'pt', { sensitivity: 'base' })
  );
  const monthOptions = [];
  const monthBase = dayjs().startOf('month');
  for (let i = 0; i < 12; i++) {
    const m = monthBase.subtract(i, 'month');
    monthOptions.push({ value: m.format('YYYY-MM'), label: capitalizeMonth(m.format('MMMM YYYY')) });
  }
  const defaultMonthValue = monthOptions.length ? monthOptions[0].value : dayjs().format('YYYY-MM');
  const operationalDefault = computeOperationalDashboard({ month: defaultMonthValue });
  const operationalConfig = {
    filters: {
      months: monthOptions,
      properties: props.map(p => ({ id: p.id, name: p.name })),
      unitTypes: unitTypeOptions
    },
    defaults: {
      month: operationalDefault.month,
      propertyId: operationalDefault.filters.propertyId ? String(operationalDefault.filters.propertyId) : '',
      unitType: operationalDefault.filters.unitType || ''
    },
    initialData: operationalDefault
  };
  const operationalConfigJson = esc(JSON.stringify(operationalConfig));

  const notificationsHtml = automationNotifications.length
    ? `<ul class="space-y-3">${automationNotifications.map(n => {
        const styles = automationSeverityStyle(n.severity);
        const ts = n.created_at ? dayjs(n.created_at).format('DD/MM HH:mm') : automationLastRun;
        return `
          <li class="border-l-4 pl-3 ${styles.border} bg-white/40 rounded-sm">
            <div class="text-[11px] text-slate-400">${esc(ts)}</div>
            <div class="text-sm font-semibold text-slate-800">${esc(n.title || '')}</div>
            <div class="text-sm text-slate-600">${esc(n.message || '')}</div>
          </li>`;
      }).join('')}</ul>`
    : '<p class="text-sm text-slate-500">Sem alertas no momento.</p>';

  const suggestionsHtml = automationSuggestions.length
    ? `<ul class="space-y-2">${automationSuggestions.map(s => {
        const occPct = Math.round((s.occupancyRate || 0) * 100);
        const pendLabel = s.pendingCount ? ` <span class=\"text-xs text-slate-500\">(+${s.pendingCount} pend)</span>` : '';
        return `
          <li class="border rounded-lg p-3 bg-slate-50">
            <div class="flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>${dayjs(s.date).format('DD/MM')}</span>
              <span>${occPct}% ocup.</span>
            </div>
            <div class="text-sm text-slate-600">Sugerir +${s.suggestedIncreasePct}% no preço base · ${s.confirmedCount}/${totalUnitsCount} confirmadas${pendLabel}</div>
          </li>`;
      }).join('')}</ul>`
    : '<p class="text-sm text-slate-500">Sem datas de alta procura.</p>';

  const blockEventsHtml = automationBlocks.length
    ? `<ul class="space-y-2">${automationBlocks.slice(-6).reverse().map(evt => {
        const label = evt.type === 'minstay' ? 'Estadia mínima' : 'Sequência cheia';
        const extra = evt.extra_nights ? ` · +${evt.extra_nights} noite(s)` : '';
        return `
          <li class="border rounded-lg p-3 bg-white/40">
            <div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(label)}</div>
            <div class="text-sm font-semibold text-slate-800">${esc(evt.property_name)} · ${esc(evt.unit_name)}</div>
            <div class="text-sm text-slate-600">${esc(formatDateRangeShort(evt.start, evt.end))}${extra}</div>
          </li>`;
      }).join('')}</ul>`
    : '<p class="text-sm text-slate-500">Nenhum bloqueio automático recente.</p>';

  const dailyRows = automationDaily.length
    ? automationDaily.map(d => {
        const occPct = Math.round((d.occupancyRate || 0) * 100);
        const arrLabel = d.arrivalsPending ? `${d.arrivalsConfirmed} <span class=\"text-xs text-slate-500\">(+${d.arrivalsPending} pend)</span>` : String(d.arrivalsConfirmed);
        const depLabel = d.departuresPending ? `${d.departuresConfirmed} <span class=\"text-xs text-slate-500\">(+${d.departuresPending} pend)</span>` : String(d.departuresConfirmed);
        const pendingBadge = d.pendingCount ? `<span class=\"text-xs text-slate-500 ml-1\">(+${d.pendingCount} pend)</span>` : '';
        return `
          <tr class="border-t">
            <td class="py-2 text-sm">${dayjs(d.date).format('DD/MM')}</td>
            <td class="py-2 text-sm">${occPct}%</td>
            <td class="py-2 text-sm">${d.confirmedCount}${pendingBadge}</td>
            <td class="py-2 text-sm">${arrLabel}</td>
            <td class="py-2 text-sm">${depLabel}</td>
          </tr>`;
      }).join('')
    : '<tr><td class="py-2 text-sm text-slate-500" colspan="5">Sem dados para o período.</td></tr>';

  const weeklyRows = automationWeekly.length
    ? automationWeekly.map(w => {
        const occPct = Math.round((w.occupancyRate || 0) * 100);
        const pending = w.pendingNights ? ` <span class=\"text-xs text-slate-500\">(+${w.pendingNights} pend)</span>` : '';
        const endLabel = dayjs(w.end).subtract(1, 'day').format('DD/MM');
        return `
          <tr class="border-t">
            <td class="py-2 text-sm">${dayjs(w.start).format('DD/MM')} → ${endLabel}</td>
            <td class="py-2 text-sm">${occPct}%</td>
            <td class="py-2 text-sm">${w.confirmedNights}${pending}</td>
          </tr>`;
      }).join('')
    : '<tr><td class="py-2 text-sm text-slate-500" colspan="3">Sem dados agregados.</td></tr>';

  const automationCard = html`
      <section class="card p-4 mb-6 space-y-6">
        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-800">Dashboard operacional</h2>
            <p class="text-sm text-slate-600">Transforma os dados de ocupação em decisões imediatas.</p>
            <div class="text-xs text-slate-400 mt-1">Última análise automática: ${automationLastRun}</div>
          </div>
          <form id="operational-filters" class="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full md:w-auto">
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Período</span>
              <select name="month" id="operational-filter-month" class="input">
                ${monthOptions.map(opt => `<option value="${opt.value}"${opt.value === operationalDefault.month ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
              </select>
            </label>
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Propriedade</span>
              <select name="property_id" id="operational-filter-property" class="input">
                <option value="">Todas</option>
                ${props.map(p => {
                  const selected = operationalDefault.filters.propertyId === p.id ? ' selected' : '';
                  return `<option value="${p.id}"${selected}>${esc(p.name)}</option>`;
                }).join('')}
              </select>
            </label>
            <label class="text-xs uppercase tracking-wide text-slate-500 flex flex-col gap-1">
              <span>Tipo de unidade</span>
              <select name="unit_type" id="operational-filter-type" class="input">
                <option value="">Todos</option>
                ${unitTypeOptions.map(type => {
                  const selected = operationalDefault.filters.unitType === type ? ' selected' : '';
                  return `<option value="${esc(type)}"${selected}>${esc(type)}</option>`;
                }).join('')}
              </select>
            </label>
          </form>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3" id="operational-metrics">
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Ocupação atual</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-occupancy">—</div>
            <div class="text-xs text-slate-500">Noites ocupadas vs. disponíveis no período selecionado.</div>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Receita total</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-revenue">—</div>
            <div class="text-xs text-slate-500">Receita proporcional das reservas confirmadas.</div>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
            <div class="text-xs uppercase tracking-wide text-slate-500">Média de noites</div>
            <div class="text-2xl font-semibold text-slate-900" id="operational-average">—</div>
            <div class="text-xs text-slate-500">Duração média das reservas incluídas.</div>
          </div>
          <div class="md:col-span-3 text-xs text-slate-500" id="operational-context">
            <span id="operational-period-label">—</span>
            <span id="operational-filters-label" class="ml-1"></span>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 space-y-6">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Top unidades por ocupação</h3>
                <a id="operational-export" class="btn btn-light border border-slate-200 text-sm" href="#" download>Exportar CSV</a>
              </div>
              <div id="top-units-wrapper" class="space-y-3">
                <p class="text-sm text-slate-500" id="top-units-empty">Sem dados para os filtros atuais.</p>
                <ol id="top-units-list" class="space-y-3 hidden"></ol>
              </div>
              <p class="text-xs text-slate-500 mt-3" id="operational-summary">—</p>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Resumo diário (próximos 7 dias)</h3>
                <span class="text-xs text-slate-400">Atualizado ${automationLastRun}</span>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr class="text-left text-slate-500">
                      <th>Dia</th><th>Ocup.</th><th>Reservas</th><th>Check-in</th><th>Check-out</th>
                    </tr>
                  </thead>
                  <tbody>${dailyRows}</tbody>
                </table>
              </div>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-slate-800">Resumo semanal</h3>
                <span class="text-xs text-slate-400">Atualizado ${automationLastRun}</span>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[320px] text-sm">
                  <thead>
                    <tr class="text-left text-slate-500">
                      <th>Semana</th><th>Ocup.</th><th>Noites confirmadas</th>
                    </tr>
                  </thead>
                  <tbody>${weeklyRows}</tbody>
                </table>
              </div>
            </section>
          </div>

          <div class="space-y-6">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Alertas operacionais</h3>
              ${notificationsHtml}
            </section>
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Sugestões de tarifa</h3>
              ${suggestionsHtml}
            </section>
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Bloqueios automáticos</h3>
              ${blockEventsHtml}
            </section>
          </div>
        </div>
      </section>
      <script type="application/json" id="operational-dashboard-data">${operationalConfigJson}</script>
      <script>
        document.addEventListener('DOMContentLoaded', function () {
          const configEl = document.getElementById('operational-dashboard-data');
          if (!configEl) return;
          let config;
          try {
            config = JSON.parse(configEl.textContent);
          } catch (err) {
            console.error('Dashboard operacional: configuração inválida', err);
            return;
          }
          const form = document.getElementById('operational-filters');
          if (form) form.addEventListener('submit', function (ev) { ev.preventDefault(); });
          const monthSelect = document.getElementById('operational-filter-month');
          const propertySelect = document.getElementById('operational-filter-property');
          const typeSelect = document.getElementById('operational-filter-type');
          const occupancyEl = document.getElementById('operational-occupancy');
          const revenueEl = document.getElementById('operational-revenue');
          const averageEl = document.getElementById('operational-average');
          const periodLabelEl = document.getElementById('operational-period-label');
          const filtersLabelEl = document.getElementById('operational-filters-label');
          const summaryEl = document.getElementById('operational-summary');
          const listEl = document.getElementById('top-units-list');
          const emptyEl = document.getElementById('top-units-empty');
          const wrapperEl = document.getElementById('top-units-wrapper');
          const exportBtn = document.getElementById('operational-export');
          const currencyFormatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
          const percentFormatter = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 });
          const nightsFormatter = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          const dateFormatter = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit' });
          let pendingController = null;

          function escHtml(value) {
            return String(value ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          }

          function slug(value) {
            return String(value || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/gi, '-')
              .replace(/^-+|-+$/g, '')
              .toLowerCase();
          }

          function formatRange(range) {
            if (!range || !range.start || !range.end) return '';
            const startDate = new Date(range.start + 'T00:00:00');
            const endDate = new Date(range.end + 'T00:00:00');
            endDate.setDate(endDate.getDate() - 1);
            return dateFormatter.format(startDate) + ' → ' + dateFormatter.format(endDate);
          }

          function describeFilters(data) {
            if (!data || !data.filters) return '';
            const labels = [];
            if (data.filters.propertyLabel) labels.push(data.filters.propertyLabel);
            if (data.filters.unitType) labels.push(data.filters.unitType);
            return labels.join(' · ');
          }

          function renderTopUnits(units, totalNights) {
            if (!Array.isArray(units) || !units.length) return '';
            const nightsLabel = Math.max(1, Number(totalNights) || 0);
            return units.map((unit, index) => {
              const occPct = percentFormatter.format(unit.occupancyRate || 0);
              const revenueLabel = currencyFormatter.format((unit.revenueCents || 0) / 100);
              const bookingsText = unit.bookingsCount === 1 ? '1 reserva' : (unit.bookingsCount || 0) + ' reservas';
              const nightsText = (unit.occupiedNights || 0) + ' / ' + nightsLabel + ' noites';
              const typeLabel = unit.unitType ? ' · ' + unit.unitType : '';
              return '<li class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">' +
                '<div>' +
                  '<div class="text-sm font-semibold text-slate-800">' + escHtml((index + 1) + '. ' + unit.propertyName + ' · ' + unit.unitName) + '</div>' +
                  '<div class="text-xs text-slate-500">' + escHtml(bookingsText + ' · ' + nightsText + typeLabel) + '</div>' +
                '</div>' +
                '<div class="text-right space-y-1">' +
                  '<div class="text-sm font-semibold text-slate-900">' + occPct + '</div>' +
                  '<div class="text-xs text-slate-500">' + escHtml(revenueLabel) + '</div>' +
                '</div>' +
              '</li>';
            }).join('');
          }

          function buildExportUrl(data) {
            const params = new URLSearchParams();
            const monthVal = data && data.month ? data.month : (monthSelect ? monthSelect.value : '');
            if (monthVal) params.set('month', monthVal);
            if (data && data.filters) {
              if (data.filters.propertyId) params.set('property_id', data.filters.propertyId);
              if (data.filters.unitType) params.set('unit_type', data.filters.unitType);
            }
            return '/admin/automation/export.csv?' + params.toString();
          }

          function buildExportFilename(data) {
            const parts = ['dashboard', data.month || ''];
            if (data.filters) {
              if (data.filters.propertyLabel) {
                parts.push('prop-' + slug(data.filters.propertyLabel));
              } else if (data.filters.propertyId) {
                parts.push('prop-' + data.filters.propertyId);
              }
              if (data.filters.unitType) {
                parts.push('tipo-' + slug(data.filters.unitType));
              }
            }
            return parts.filter(Boolean).join('_') + '.csv';
          }

          function setLoading(state) {
            if (!wrapperEl) return;
            wrapperEl.classList.toggle('opacity-50', state);
          }

          function applyData(data) {
            if (!data) return;
            setLoading(false);
            const summary = data.summary || {};
            if (summary.availableNights > 0) {
              occupancyEl.textContent = percentFormatter.format(summary.occupancyRate || 0);
            } else {
              occupancyEl.textContent = '—';
            }
            revenueEl.textContent = currencyFormatter.format((summary.revenueCents || 0) / 100);
            averageEl.textContent = summary.bookingsCount ? (nightsFormatter.format(summary.averageNights || 0) + ' noites') : '—';
            periodLabelEl.textContent = data.monthLabel + ' · ' + formatRange(data.range);
            const filtersDesc = describeFilters(data);
            filtersLabelEl.textContent = filtersDesc ? 'Filtros: ' + filtersDesc : '';
            const summaryParts = [];
            const bookingsCount = summary.bookingsCount || 0;
            summaryParts.push(bookingsCount === 1 ? '1 reserva confirmada' : bookingsCount + ' reservas confirmadas');
            if (summary.availableNights > 0) {
              summaryParts.push((summary.occupiedNights || 0) + '/' + summary.availableNights + ' noites ocupadas');
            } else {
              summaryParts.push('Sem unidades para o filtro selecionado');
            }
            if (filtersDesc) summaryParts.push(filtersDesc);
            summaryEl.textContent = summaryParts.join(' · ');

            const topUnitsHtml = renderTopUnits(data.topUnits || [], data.range ? data.range.nights : 0);
            if (topUnitsHtml) {
              listEl.innerHTML = topUnitsHtml;
              listEl.classList.remove('hidden');
              emptyEl.classList.add('hidden');
            } else {
              listEl.innerHTML = '';
              listEl.classList.add('hidden');
              emptyEl.classList.remove('hidden');
            }

            if (monthSelect && data.month) monthSelect.value = data.month;
            if (propertySelect) propertySelect.value = data.filters && data.filters.propertyId ? String(data.filters.propertyId) : '';
            if (typeSelect) typeSelect.value = data.filters && data.filters.unitType ? data.filters.unitType : '';

            if (exportBtn) {
              exportBtn.href = buildExportUrl(data);
              exportBtn.setAttribute('download', buildExportFilename(data));
            }
          }

          function requestData() {
            if (!monthSelect) return;
            const params = new URLSearchParams();
            if (monthSelect.value) params.set('month', monthSelect.value);
            if (propertySelect && propertySelect.value) params.set('property_id', propertySelect.value);
            if (typeSelect && typeSelect.value) params.set('unit_type', typeSelect.value);
            setLoading(true);
            if (pendingController) pendingController.abort();
            pendingController = new AbortController();
            fetch('/admin/automation/operational.json?' + params.toString(), { signal: pendingController.signal })
              .then(resp => {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
              })
              .then(data => applyData(data))
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.error('Dashboard operacional: falha ao carregar métricas', err);
                  setLoading(false);
                }
              })
              .finally(() => {
                if (pendingController && pendingController.signal.aborted) return;
                pendingController = null;
              });
          }

          if (config && config.defaults) {
            if (monthSelect && config.defaults.month) monthSelect.value = config.defaults.month;
            if (propertySelect) propertySelect.value = config.defaults.propertyId || '';
            if (typeSelect) typeSelect.value = config.defaults.unitType || '';
          }
          if (config && config.initialData) {
            applyData(config.initialData);
          }
          [monthSelect, propertySelect, typeSelect].forEach(select => {
            if (!select) return;
            select.addEventListener('change', requestData);
          });
          configEl.textContent = '';
        });
      </script>
  `;

  res.send(layout({
    title: 'Backoffice',
    user: req.user,
    activeNav: 'backoffice',
    body: html`
      <h1 class="text-2xl font-semibold mb-6">Backoffice</h1>

      ${automationCard}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section class="card p-4">
          <h2 class="font-semibold mb-3">Propriedades</h2>
          <ul class="space-y-2 mb-3">
            ${props.map(p => `
              <li class="flex items-center justify-between">
                <span>${esc(p.name)}</span>
                <a class="text-slate-600 hover:text-slate-900 underline" href="/admin/properties/${p.id}">Abrir</a>
              </li>`).join('')}
          </ul>
          <form method="post" action="/admin/properties/create" class="grid gap-2">
            <input required name="name" class="input" placeholder="Nome"/>
            <input name="location" class="input" placeholder="Localização"/>
            <textarea name="description" class="input" placeholder="Descrição"></textarea>
            <button class="btn btn-primary">Adicionar Propriedade</button>
          </form>
        </section>

        <section class="card p-4 md:col-span-2">
          <h2 class="font-semibold mb-3">Unidades</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[820px] text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th>Propriedade</th><th>Unidade</th><th>Cap.</th><th>Base €/noite</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${units.map(u => `
                  <tr class="border-t">
                    <td>${esc(u.property_name)}</td>
                    <td>${esc(u.name)}</td>
                    <td>${u.capacity}</td>
                    <td>${eur(u.base_price_cents)}</td>
                    <td><a class="text-slate-600 hover:text-slate-900 underline" href="/admin/units/${u.id}">Gerir</a></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <hr class="my-4"/>
          <form method="post" action="/admin/units/create" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2">
            <select required name="property_id" class="input md:col-span-2">
              ${props.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            </select>
            <input required name="name" class="input md:col-span-2" placeholder="Nome da unidade"/>
            <input required type="number" min="1" name="capacity" class="input" placeholder="Capacidade"/>
            <input required type="number" step="0.01" min="0" name="base_price_eur" class="input" placeholder="Preço base €/noite"/>
            <textarea name="features_raw" class="input md:col-span-6" rows="4" placeholder="Características (uma por linha). Ex: 
bed|3 camas
wifi
kitchen|Kitchenette"></textarea>
            <div class="text-xs text-slate-500 md:col-span-6">
              Ícones Lucide disponíveis: ${FEATURE_ICON_KEYS.join(', ')}. Usa <code>icon|texto</code> ou só o ícone.
            </div>
            <div class="md:col-span-6">
              <button class="btn btn-primary">Adicionar Unidade</button>
            </div>
          </form>
        </section>
      </div>

      <section class="card p-4 mt-6">
        <h2 class="font-semibold mb-3">Reservas recentes</h2>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[980px] text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th>Quando</th><th>Propriedade / Unidade</th><th>Hóspede</th><th>Contacto</th><th>Ocupação</th><th>Datas</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recentBookings.map(b => `
                <tr class="border-t" title="${esc(b.guest_name||'')}">
                  <td>${dayjs(b.created_at).format('DD/MM HH:mm')}</td>
                  <td>${esc(b.property_name)} · ${esc(b.unit_name)}</td>
                  <td>${esc(b.guest_name)}</td>
                  <td>${esc(b.guest_phone||'-')} · ${esc(b.guest_email)}</td>
                  <td>${b.adults}A+${b.children}C</td>
                  <td>${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}</td>
                  <td>€ ${eur(b.total_cents)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `
  }));
});

app.get('/admin/automation/operational.json', requireLogin, requirePermission('automation.view'), (req, res) => {
  const data = computeOperationalDashboard(req.query || {});
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(data));
});

app.get('/admin/automation/export.csv', requireLogin, requirePermission('automation.export'), (req, res) => {
  const filters = parseOperationalFilters(req.query || {});
  const operational = computeOperationalDashboard(filters);
  const automationData = ensureAutomationFresh(5) || automationCache;
  const daily = (automationData.summaries && automationData.summaries.daily) || [];
  const weekly = (automationData.summaries && automationData.summaries.weekly) || [];

  const rows = [];
  rows.push(['Secção', 'Referência', 'Valor']);
  const rangeEnd = dayjs(operational.range.end).subtract(1, 'day');
  const rangeLabel = `${operational.range.start} → ${rangeEnd.isValid() ? rangeEnd.format('YYYY-MM-DD') : operational.range.end}`;
  rows.push(['Filtro', 'Período', `${operational.monthLabel} (${rangeLabel})`]);
  if (operational.filters.propertyLabel) {
    rows.push(['Filtro', 'Propriedade', operational.filters.propertyLabel]);
  }
  if (operational.filters.unitType) {
    rows.push(['Filtro', 'Tipo de unidade', operational.filters.unitType]);
  }
  rows.push(['Métrica', 'Unidades analisadas', operational.summary.totalUnits]);
  rows.push([
    'Métrica',
    'Ocupação período (%)',
    Math.round((operational.summary.occupancyRate || 0) * 100)
  ]);
  rows.push(['Métrica', 'Reservas confirmadas', operational.summary.bookingsCount]);
  rows.push([
    'Métrica',
    'Noites ocupadas',
    operational.summary.availableNights
      ? `${operational.summary.occupiedNights}/${operational.summary.availableNights}`
      : 'Sem unidades'
  ]);
  rows.push([
    'Métrica',
    'Média noites/reserva',
    operational.summary.bookingsCount ? operational.summary.averageNights.toFixed(2) : '0.00'
  ]);
  rows.push(['Financeiro', 'Receita período (€)', eur(operational.summary.revenueCents || 0)]);
  if (operational.topUnits.length) {
    operational.topUnits.forEach((unit, idx) => {
      rows.push([
        'Top unidades',
        `${idx + 1}. ${unit.propertyName} · ${unit.unitName}`,
        `${Math.round((unit.occupancyRate || 0) * 100)}% · ${unit.bookingsCount} reservas · € ${eur(unit.revenueCents || 0)}`
      ]);
    });
  } else {
    rows.push(['Top unidades', '—', 'Sem dados para os filtros selecionados.']);
  }

  rows.push(['', '', '']);
  rows.push([
    'Execução',
    'Última automação',
    automationData.lastRun ? dayjs(automationData.lastRun).format('YYYY-MM-DD HH:mm') : '-'
  ]);
  rows.push(['Receita', 'Próximos 7 dias (€)', eur(automationData.revenue ? automationData.revenue.next7 || 0 : 0)]);
  rows.push(['Receita', 'Próximos 30 dias (€)', eur(automationData.revenue ? automationData.revenue.next30 || 0 : 0)]);
  rows.push(['Métrica', 'Check-ins 48h', (automationData.metrics && automationData.metrics.checkins48h) || 0]);
  rows.push(['Métrica', 'Estadias longas', (automationData.metrics && automationData.metrics.longStays) || 0]);
  rows.push([
    'Métrica',
    'Ocupação hoje (%)',
    Math.round(((automationData.metrics && automationData.metrics.occupancyToday) || 0) * 100)
  ]);

  daily.forEach(d => {
    rows.push([
      'Resumo diário',
      `${dayjs(d.date).format('YYYY-MM-DD')}`,
      `${Math.round((d.occupancyRate || 0) * 100)}% · ${d.confirmedCount} confirmadas`
    ]);
  });

  weekly.forEach(w => {
    const endLabel = dayjs(w.end).subtract(1, 'day').format('YYYY-MM-DD');
    rows.push([
      'Resumo semanal',
      `${dayjs(w.start).format('YYYY-MM-DD')} → ${endLabel}`,
      `${Math.round((w.occupancyRate || 0) * 100)}% · ${w.confirmedNights} noites`
    ]);
  });

  const csv = rows
    .map(cols => cols.map(col => `"${String(col ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const filenameParts = [
    'dashboard',
    operational.month || dayjs().format('YYYY-MM')
  ];
  if (operational.filters.propertyLabel) {
    filenameParts.push(`prop-${slugify(operational.filters.propertyLabel)}`);
  } else if (operational.filters.propertyId) {
    filenameParts.push(`prop-${operational.filters.propertyId}`);
  }
  if (operational.filters.unitType) {
    filenameParts.push(`tipo-${slugify(operational.filters.unitType)}`);
  }
  const filenameBase = filenameParts.filter(Boolean).join('_') || 'dashboard';
  const filename = `${filenameBase}.csv`;

  logActivity(req.user.id, 'export:automation_csv', null, null, filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + csv);
});

app.post('/admin/properties/create', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const { name, location, description } = req.body;
  db.prepare('INSERT INTO properties(name, location, description) VALUES (?, ?, ?)').run(name, location, description);
  res.redirect('/admin');
});

app.post('/admin/properties/:id/delete', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const id = req.params.id;
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
  if (!property) return res.status(404).send('Propriedade não encontrada');
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  res.redirect('/admin');
});

app.get('/admin/properties/:id', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).send('Propriedade não encontrada');

  const units = db.prepare('SELECT * FROM units WHERE property_id = ? ORDER BY name').all(p.id);
  const bookings = db.prepare(
    `SELECT b.*, u.name as unit_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
      WHERE u.property_id = ?
      ORDER BY b.checkin`
  ).all(p.id);

  res.send(layout({
    title: p.name,
    user: req.user,
    activeNav: 'backoffice',
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">${esc(p.name)}</h1>
          <p class="text-slate-600 mt-1">${esc(p.location||'')}</p>
        </div>
        <form method="post" action="/admin/properties/${p.id}/delete" class="shrink-0" onsubmit="return confirm('Tem a certeza que quer eliminar esta propriedade? Isto remove unidades e reservas associadas.');">
          <button type="submit" class="text-rose-600 hover:text-rose-800 underline">Eliminar propriedade</button>
        </form>
      </div>
      <h2 class="font-semibold mb-2">Unidades</h2>
      <ul class="mb-6">
        ${units.map(u => `<li><a class="text-slate-700 underline" href="/admin/units/${u.id}">${esc(u.name)}</a> (cap ${u.capacity})</li>`).join('')}
      </ul>

      <h2 class="font-semibold mb-2">Reservas</h2>
      <ul class="space-y-1">
        ${bookings.length ? bookings.map(b => `
          <li>${esc(b.unit_name)}: ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')} · ${esc(b.guest_name)} (${b.adults}A+${b.children}C)</li>
        `).join('') : '<em>Sem reservas</em>'}
      </ul>
    `
  }));
});

app.post('/admin/units/create', requireLogin, requirePermission('properties.manage'), (req, res) => {
  let { property_id, name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
  const features = parseFeaturesInput(features_raw);
  db.prepare('INSERT INTO units(property_id, name, capacity, base_price_cents, features) VALUES (?, ?, ?, ?, ?)')
    .run(property_id, name, Number(capacity), cents, JSON.stringify(features));
  res.redirect('/admin');
});

app.get('/admin/units/:id', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const u = db.prepare(
    `SELECT u.*, p.name as property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE u.id = ?`
  ).get(req.params.id);
  if (!u) return res.status(404).send('Unidade não encontrada');

  const unitFeatures = parseFeaturesStored(u.features);
  const unitFeaturesTextarea = esc(featuresToTextarea(unitFeatures));
  const unitFeaturesPreview = featureChipsHtml(unitFeatures, {
    className: 'flex flex-wrap gap-2 text-xs text-slate-600 mb-3',
    badgeClass: 'inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2 py-1 rounded-full',
    iconWrapClass: 'inline-flex items-center justify-center text-emerald-700'
  });
  const bookings = db.prepare('SELECT * FROM bookings WHERE unit_id = ? ORDER BY checkin').all(u.id);
  const blocks = db.prepare('SELECT * FROM blocks WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const rates = db.prepare('SELECT * FROM rates WHERE unit_id = ? ORDER BY start_date').all(u.id);
  const images = db.prepare(
    'SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id'
  ).all(u.id);

  res.send(layout({
    title: `${esc(u.property_name)} – ${esc(u.name)}`,
    user: req.user,
    activeNav: 'backoffice',
    body: html`
      <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
      <h1 class="text-2xl font-semibold mb-4">${esc(u.property_name)} - ${esc(u.name)}</h1>
      ${unitFeaturesPreview}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section class="card p-4 md:col-span-2">
          <h2 class="font-semibold mb-3">Reservas</h2>
          <ul class="space-y-1 mb-4">
            ${bookings.length ? bookings.map(b => `
              <li class="flex items-center justify-between gap-3" title="${esc(b.guest_name||'')}">
                <div>
                  ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}
                  - <strong>${esc(b.guest_name)}</strong> ${b.agency ? `[${esc(b.agency)}]` : ''} (${b.adults}A+${b.children}C)
                  <span class="text-slate-500">(&euro; ${eur(b.total_cents)})</span>
                  <span class="ml-2 text-xs rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                    ${b.status}
                  </span>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <a class="text-slate-600 hover:text-slate-900 underline" href="/admin/bookings/${b.id}">Editar</a>
                  <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
                    <button class="text-rose-600">Cancelar</button>
                  </form>
                </div>
              </li>
            `).join('') : '<em>Sem reservas</em>'}
          </ul>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form method="post" action="/admin/units/${u.id}/block" class="grid gap-2 bg-slate-50 p-3 rounded">
              <div class="text-sm text-slate-600">Bloquear datas</div>
              <div class="flex gap-2">
                <input required type="date" name="start_date" class="input"/>
                <input required type="date" name="end_date" class="input"/>
              </div>
              <button class="btn btn-primary">Bloquear</button>
            </form>

            <form method="post" action="/admin/units/${u.id}/rates/create" class="grid gap-2 bg-slate-50 p-3 rounded">
              <div class="text-sm text-slate-600">Adicionar rate</div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-sm">De</label>
                  <input required type="date" name="start_date" class="input"/>
                </div>
                <div>
                  <label class="text-sm">Até</label>
                  <input required type="date" name="end_date" class="input"/>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-sm">€/noite</label>
                  <input required type="number" step="0.01" min="0" name="price_eur" class="input" placeholder="Preço €/noite"/>
                </div>
                <div>
                  <label class="text-sm">Mín. noites</label>
                  <input type="number" min="1" name="min_stay" class="input" placeholder="Mínimo de noites"/>
                </div>
              </div>
              <button class="btn btn-primary">Guardar rate</button>
            </form>
          </div>

          ${blocks.length ? `
            <div class="mt-6">
              <h3 class="font-semibold mb-2">Bloqueios ativos</h3>
              <ul class="space-y-2">
                ${blocks.map(block => `
                  <li class="flex items-center justify-between text-sm">
                    <span>${dayjs(block.start_date).format('DD/MM/YYYY')} &rarr; ${dayjs(block.end_date).format('DD/MM/YYYY')}</span>
                    <form method="post" action="/admin/blocks/${block.id}/delete" onsubmit="return confirm('Desbloquear estas datas?');">
                      <button class="text-rose-600">Desbloquear</button>
                    </form>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
        </section>

        <section class="card p-4">
          <h2 class="font-semibold mb-3">Editar Unidade</h2>
          <form method="post" action="/admin/units/${u.id}/update" class="grid gap-2">
            <label class="text-sm">Nome</label>
            <input name="name" class="input" value="${esc(u.name)}"/>

            <label class="text-sm">Capacidade</label>
            <input type="number" min="1" name="capacity" class="input" value="${u.capacity}"/>

            <label class="text-sm">Preço base €/noite</label>
            <input type="number" step="0.01" name="base_price_eur" class="input" value="${eur(u.base_price_cents)}"/>

            <label class="text-sm">Características</label>
            <textarea name="features_raw" rows="6" class="input">${unitFeaturesTextarea}</textarea>
            <div class="text-xs text-slate-500">Uma por linha no formato <code>icon|texto</code> ou apenas o ícone. Ícones: ${FEATURE_ICON_KEYS.join(', ')}.</div>

            <button class="btn btn-primary">Guardar</button>
          </form>

          <h2 class="font-semibold mt-6 mb-2">Rates</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th>De</th><th>Até</th><th>€/noite (weekday)</th><th>€/noite (weekend)</th><th>Mín</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${rates.map(r => `
                  <tr class="border-t">
                    <td>${dayjs(r.start_date).format('DD/MM/YYYY')}</td>
                    <td>${dayjs(r.end_date).format('DD/MM/YYYY')}</td>
                    <td>€ ${eur(r.weekday_price_cents)}</td>
                    <td>€ ${eur(r.weekend_price_cents)}</td>
                    <td>${r.min_stay || 1}</td>
                    <td>
                      <form method="post" action="/admin/rates/${r.id}/delete" onsubmit="return confirm('Apagar rate?');">
                        <button class="text-rose-600">Apagar</button>
                      </form>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <h2 class="font-semibold mt-6 mb-2">Galeria</h2>
          <form method="post" action="/admin/units/${u.id}/images" enctype="multipart/form-data" class="grid gap-2 bg-slate-50 p-3 rounded">
            <input type="hidden" name="unit_id" value="${u.id}"/>
            <input type="file" name="images" class="input" accept="image/*" multiple required />
            <div class="text-xs text-slate-500">As imagens são comprimidas e redimensionadas automaticamente para otimizar o carregamento.</div>
            <button class="btn btn-primary">Carregar imagens</button>
          </form>
          <div class="mt-4 space-y-3" data-gallery-manager data-unit-id="${u.id}">
            <div class="gallery-flash" data-gallery-flash hidden></div>
            <div class="gallery-grid ${images.length ? '' : 'hidden'}" data-gallery-list>
              ${images.map(img => `
                <article class="gallery-tile${img.is_primary ? ' is-primary' : ''}" data-gallery-tile data-image-id="${img.id}" draggable="true" tabindex="0">
                  <span class="gallery-tile__badge">Principal</span>
                  <img src="/uploads/units/${u.id}/${encodeURIComponent(img.file)}" alt="${esc(img.alt||'')}" loading="lazy" class="gallery-tile__img"/>
                  <div class="gallery-tile__overlay">
                    <div class="gallery-tile__hint">Arraste para reordenar</div>
                    <div class="gallery-tile__meta">
                      <span>${dayjs(img.created_at).format('DD/MM/YYYY')}</span>
                    </div>
                    <div class="gallery-tile__actions">
                      <button type="button" class="btn btn-light" data-gallery-action="primary" ${img.is_primary ? 'disabled' : ''}>${img.is_primary ? 'Em destaque' : 'Tornar destaque'}</button>
                      <button type="button" class="btn btn-danger" data-gallery-action="delete">Remover</button>
                    </div>
                  </div>
                </article>
              `).join('')}
            </div>
            <div class="gallery-empty ${images.length ? 'hidden' : ''}" data-gallery-empty>
              <p class="text-sm text-slate-500">Ainda não existem imagens carregadas para esta unidade.</p>
            </div>
          </div>
        </section>
      </div>

      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const manager = document.querySelector('[data-gallery-manager]');
          if (!manager) return;
          const list = manager.querySelector('[data-gallery-list]');
          const emptyState = manager.querySelector('[data-gallery-empty]');
          const flash = manager.querySelector('[data-gallery-flash]');
          const unitId = manager.getAttribute('data-unit-id');
          let flashTimer = null;
          let dragItem = null;
          let lastOrderKey = list
            ? JSON.stringify(Array.from(list.querySelectorAll('[data-gallery-tile]')).map(el => el.dataset.imageId))
            : '[]';

          function showFlash(message, variant) {
            if (!flash) return;
            flash.textContent = message;
            flash.setAttribute('data-variant', variant || 'info');
            flash.hidden = false;
            if (flashTimer) window.clearTimeout(flashTimer);
            flashTimer = window.setTimeout(() => { flash.hidden = true; }, 2600);
          }

          function syncEmpty() {
            if (!list || !emptyState) return;
            const isEmpty = list.querySelectorAll('[data-gallery-tile]').length === 0;
            list.classList.toggle('hidden', isEmpty);
            emptyState.classList.toggle('hidden', !isEmpty);
          }

          function refreshOrderKey() {
            if (!list) {
              lastOrderKey = '[]';
              return lastOrderKey;
            }
            lastOrderKey = JSON.stringify(Array.from(list.querySelectorAll('[data-gallery-tile]')).map(el => el.dataset.imageId));
            return lastOrderKey;
          }

          function updatePrimary(id) {
            if (!list) return;
            const tiles = list.querySelectorAll('[data-gallery-tile]');
            tiles.forEach(tile => {
              const btn = tile.querySelector('[data-gallery-action="primary"]');
              const isPrimary = tile.dataset.imageId === String(id);
              tile.classList.toggle('is-primary', isPrimary);
              if (btn) {
                btn.disabled = isPrimary;
                btn.textContent = isPrimary ? 'Em destaque' : 'Tornar destaque';
              }
            });
          }

          function request(url, options) {
            const baseHeaders = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
            const merged = Object.assign({}, options || {});
            merged.headers = Object.assign({}, baseHeaders, merged.headers || {});
            return fetch(url, merged).then(resp => {
              if (!resp.ok) {
                return resp.json().catch(() => ({})).then(data => {
                  const message = data && data.message ? data.message : 'Ocorreu um erro inesperado.';
                  throw new Error(message);
                });
              }
              return resp.json().catch(() => ({}));
            });
          }

          function persistOrder() {
            if (!list) return;
            const tiles = Array.from(list.querySelectorAll('[data-gallery-tile]'));
            if (!tiles.length) {
              refreshOrderKey();
              return;
            }
            const payload = tiles.map((tile, index) => ({ id: Number(tile.dataset.imageId), position: index + 1 }));
            const key = JSON.stringify(payload.map(item => item.id));
            if (key === lastOrderKey) return;
            lastOrderKey = key;
            request('/admin/units/' + unitId + '/images/reorder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: payload })
            })
              .then(data => {
                refreshOrderKey();
                showFlash(data && data.message ? data.message : 'Ordem atualizada.', 'success');
                if (data && data.primaryId) updatePrimary(data.primaryId);
              })
              .catch(err => {
                refreshOrderKey();
                showFlash(err.message || 'Não foi possível atualizar a ordem.', 'danger');
              });
          }

          if (list) {
            list.addEventListener('dragstart', event => {
              const tile = event.target.closest('[data-gallery-tile]');
              if (!tile) return;
              dragItem = tile;
              tile.classList.add('dragging');
              event.dataTransfer.effectAllowed = 'move';
              try { event.dataTransfer.setData('text/plain', tile.dataset.imageId); } catch (_) {}
            });

            list.addEventListener('dragover', event => {
              if (!dragItem) return;
              event.preventDefault();
              const target = event.target.closest('[data-gallery-tile]');
              if (!target || target === dragItem) return;
              const rect = target.getBoundingClientRect();
              const after = (event.clientY - rect.top) > rect.height / 2 || (event.clientX - rect.left) > rect.width / 2;
              if (after) {
                target.after(dragItem);
              } else {
                target.before(dragItem);
              }
            });

            list.addEventListener('drop', event => {
              if (!dragItem) return;
              event.preventDefault();
            });

            list.addEventListener('dragend', () => {
              if (!dragItem) return;
              dragItem.classList.remove('dragging');
              dragItem = null;
              syncEmpty();
              persistOrder();
            });
          }

          manager.addEventListener('click', event => {
            const actionBtn = event.target.closest('[data-gallery-action]');
            if (!actionBtn) return;
            const tile = actionBtn.closest('[data-gallery-tile]');
            if (!tile) return;
            const imageId = tile.dataset.imageId;
            const action = actionBtn.getAttribute('data-gallery-action');
            if (action === 'delete') {
              if (!window.confirm('Remover esta imagem da galeria?')) return;
              actionBtn.disabled = true;
              request('/admin/images/' + imageId + '/delete', { method: 'POST' })
                .then(data => {
                  tile.remove();
                  syncEmpty();
                  refreshOrderKey();
                  showFlash(data && data.message ? data.message : 'Imagem removida.', 'info');
                  if (data && data.primaryId) updatePrimary(data.primaryId);
                })
                .catch(err => {
                  actionBtn.disabled = false;
                  showFlash(err.message || 'Não foi possível remover a imagem.', 'danger');
                });
            } else if (action === 'primary') {
              actionBtn.disabled = true;
              request('/admin/images/' + imageId + '/primary', { method: 'POST' })
                .then(data => {
                  updatePrimary(imageId);
                  showFlash(data && data.message ? data.message : 'Imagem definida como destaque.', 'success');
                })
                .catch(err => {
                  actionBtn.disabled = false;
                  showFlash(err.message || 'Não foi possível atualizar a imagem.', 'danger');
                });
            }
          });

          syncEmpty();
        });
      </script>
    `
  }));
});

app.post('/admin/units/:id/update', requireLogin, requirePermission('properties.manage'), (req, res) => {
  const { name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
  const features = parseFeaturesInput(features_raw);
  db.prepare('UPDATE units SET name = ?, capacity = ?, base_price_cents = ?, features = ? WHERE id = ?')
    .run(name, Number(capacity), cents, JSON.stringify(features), req.params.id);
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/units/:id/delete', requireLogin, requirePermission('properties.manage'), (req, res) => {
  db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

app.post('/admin/units/:id/block', requireLogin, requirePermission('calendar.block.create'), (req, res) => {
  const { start_date, end_date } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');

  const conflicts = db.prepare(
    `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
      AND NOT (checkout <= ? OR checkin >= ?)`
  ).all(req.params.id, start_date, end_date);
  if (conflicts.length)
    return res.status(409).send('As datas incluem reservas existentes');

  const inserted = insertBlockStmt.run(req.params.id, start_date, end_date);
  logChange(req.user.id, 'block', inserted.lastInsertRowid, 'create', null, { start_date, end_date, unit_id: Number(req.params.id) });
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/blocks/:blockId/delete', requireLogin, requirePermission('calendar.block.delete'), (req, res) => {
  const block = db.prepare('SELECT unit_id, start_date, end_date FROM blocks WHERE id = ?').get(req.params.blockId);
  if (!block) return res.status(404).send('Bloqueio não encontrado');
  db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.blockId);
  logChange(req.user.id, 'block', Number(req.params.blockId), 'delete', {
    unit_id: block.unit_id,
    start_date: block.start_date,
    end_date: block.end_date
  }, null);
  res.redirect(`/admin/units/${block.unit_id}`);
});

app.post('/admin/units/:id/rates/create', requireLogin, requirePermission('rates.manage'), (req, res) => {
  const { start_date, end_date, price_eur, min_stay } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');
  const price_cents = Math.round(parseFloat(String(price_eur || '0').replace(',', '.')) * 100);
  if (!(price_cents >= 0)) return res.status(400).send('Preço inválido');
  db.prepare(
    'INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)'
  ).run(req.params.id, start_date, end_date, price_cents, price_cents, min_stay ? Number(min_stay) : 1);
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/rates/:rateId/delete', requireLogin, requirePermission('rates.manage'), (req, res) => {
  const r = db.prepare('SELECT unit_id FROM rates WHERE id = ?').get(req.params.rateId);
  if (!r) return res.status(404).send('Rate não encontrada');
  db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.rateId);
  res.redirect(`/admin/units/${r.unit_id}`);
});

// Imagens
app.post('/admin/units/:id/images', requireLogin, requirePermission('gallery.manage'), upload.array('images', 24), async (req, res) => {
  const unitId = Number(req.params.id);
  const files = req.files || [];
  if (!files.length) {
    if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Nenhum ficheiro recebido.' });
    return res.redirect(`/admin/units/${unitId}`);
  }

  const insert = db.prepare('INSERT INTO unit_images(unit_id,file,alt,position) VALUES (?,?,?,?)');
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) as p FROM unit_images WHERE unit_id = ?').get(unitId).p;
  const existingPrimary = db
    .prepare('SELECT id FROM unit_images WHERE unit_id = ? AND is_primary = 1 LIMIT 1')
    .get(unitId);
  const insertedIds = [];

  try {
    for (const file of files) {
      const filePath = path.join(UPLOAD_UNITS, String(unitId), file.filename);
      await compressImage(filePath);
      const inserted = insert.run(unitId, file.filename, null, ++pos);
      insertedIds.push(inserted.lastInsertRowid);
    }

    if (!existingPrimary && insertedIds.length) {
      const primaryId = insertedIds[0];
      db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
        primaryId,
        unitId
      );
    }

    if (wantsJson(req)) {
      const rows = db
        .prepare('SELECT * FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id')
        .all(unitId);
      return res.json({ ok: true, images: rows, primaryId: rows.find(img => img.is_primary)?.id || null });
    }

    res.redirect(`/admin/units/${unitId}`);
  } catch (err) {
    console.error('Falha ao processar upload de imagens', err);
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, message: 'Não foi possível guardar as imagens. Tente novamente.' });
    }
    res.status(500).send('Não foi possível guardar as imagens.');
  }
});

app.post('/admin/images/:imageId/delete', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Imagem não encontrada.' });
    return res.status(404).send('Imagem não encontrada');
  }

  const filePath = path.join(UPLOAD_UNITS, String(img.unit_id), img.file);
  db.prepare('DELETE FROM unit_images WHERE id = ?').run(img.id);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) { console.warn('Não foi possível remover ficheiro físico', err.message); }
  }

  let nextPrimaryId = null;
  if (img.is_primary) {
    const fallback = db
      .prepare(
        'SELECT id FROM unit_images WHERE unit_id = ? ORDER BY is_primary DESC, position, id LIMIT 1'
      )
      .get(img.unit_id);
    if (fallback) {
      db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
        fallback.id,
        img.unit_id
      );
      nextPrimaryId = fallback.id;
    }
  }

  if (wantsJson(req)) {
    return res.json({ ok: true, message: 'Imagem removida.', primaryId: nextPrimaryId });
  }

  res.redirect(`/admin/units/${img.unit_id}`);
});

app.post('/admin/images/:imageId/primary', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Imagem não encontrada.' });
    return res.status(404).send('Imagem não encontrada');
  }

  db.prepare('UPDATE unit_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE unit_id = ?').run(
    img.id,
    img.unit_id
  );

  if (wantsJson(req)) {
    return res.json({ ok: true, primaryId: img.id, message: 'Imagem definida como destaque.' });
  }

  res.redirect(`/admin/units/${img.unit_id}`);
});

app.post('/admin/units/:id/images/reorder', requireLogin, requirePermission('gallery.manage'), (req, res) => {
  const unitId = Number(req.params.id);
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  const ids = order
    .map(item => ({ id: Number(item.id), position: Number(item.position) }))
    .filter(item => item.id && item.position);

  if (!ids.length) {
    return res.json({ ok: true, message: 'Nada para atualizar.', primaryId: null });
  }

  const existingIds = new Set(
    db
      .prepare('SELECT id FROM unit_images WHERE unit_id = ?')
      .all(unitId)
      .map(row => row.id)
  );

  const updates = ids.filter(item => existingIds.has(item.id));
  const updateStmt = db.prepare('UPDATE unit_images SET position = ? WHERE id = ? AND unit_id = ?');
  const runUpdates = db.transaction(items => {
    items.forEach(item => {
      updateStmt.run(item.position, item.id, unitId);
    });
  });

  runUpdates(updates);

  const primaryRow = db
    .prepare('SELECT id FROM unit_images WHERE unit_id = ? AND is_primary = 1 LIMIT 1')
    .get(unitId);

  res.json({ ok: true, message: 'Ordem atualizada.', primaryId: primaryRow ? primaryRow.id : null });
});

// ===================== Booking Management (Admin) =====================
app.get('/admin/bookings', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim(); // '', CONFIRMED, PENDING
  const ym = String(req.query.ym || '').trim();         // YYYY-MM opcional

  const where = [];
  const args = [];

  if (q) {
    where.push(`(b.guest_name LIKE ? OR b.guest_email LIKE ? OR u.name LIKE ? OR p.name LIKE ? OR b.agency LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push(`b.status = ?`);
    args.push(status);
  }
  if (/^\d{4}-\d{2}$/.test(ym)) {
    const startYM = `${ym}-01`;
    const endYM = dayjs(startYM).endOf('month').add(1, 'day').format('YYYY-MM-DD'); // exclusivo
    where.push(`NOT (b.checkout <= ? OR b.checkin >= ?)`);
    args.push(startYM, endYM);
  }

  const sql = `
    SELECT b.*, u.name AS unit_name, p.name AS property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.checkin DESC, b.created_at DESC
      LIMIT 500
  `;
  const rows = db.prepare(sql).all(...args);

  res.send(layout({
    title: 'Reservas',
    user: req.user,
    activeNav: 'bookings',
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Reservas</h1>

      <form method="get" class="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <input class="input md:col-span-2" name="q" placeholder="Procurar por hóspede, email, unidade, propriedade" value="${esc(q)}"/>
        <select class="input" name="status">
          <option value="">Todos os estados</option>
          <option value="CONFIRMED" ${status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
          <option value="PENDING" ${status==='PENDING'?'selected':''}>PENDING</option>
        </select>
        <input class="input" type="month" name="ym" value="${/^\d{4}-\d{2}$/.test(ym)?ym:''}"/>
        <button class="btn btn-primary">Filtrar</button>
      </form>

      <div class="card p-0 overflow-x-auto">
        <table class="w-full min-w-[980px] text-sm">
          <thead>
            <tr class="text-left text-slate-500">
              <th>Check-in</th><th>Check-out</th><th>Propriedade/Unidade</th><th>Agência</th><th>Hóspede</th><th>Ocup.</th><th>Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(b => `
              <tr class="border-t">
                <td>${dayjs(b.checkin).format('DD/MM/YYYY')}</td>
                <td>${dayjs(b.checkout).format('DD/MM/YYYY')}</td>
                <td>${esc(b.property_name)} - ${esc(b.unit_name)}</td>
                <td>${esc(b.agency || '')}</td>
                <td>${esc(b.guest_name)} <span class="text-slate-500">(${esc(b.guest_email)})</span></td>
                <td>${b.adults}A+${b.children}C</td>
                <td>€ ${eur(b.total_cents)}</td>
                <td>
                  <span class="text-xs rounded px-2 py-0.5 ${b.status==='CONFIRMED'?'bg-emerald-100 text-emerald-700':b.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-slate-200 text-slate-700'}">
                    ${b.status}
                  </span>
                </td>
                <td class="whitespace-nowrap">
                  <a class="underline" href="/admin/bookings/${b.id}">${canEditBooking ? 'Editar' : 'Ver'}</a>
                  ${canCancelBooking ? `
                    <form method="post" action="/admin/bookings/${b.id}/cancel" style="display:inline" onsubmit="return confirm('Cancelar esta reserva?');">
                      <button class="text-rose-600 ml-2">Cancelar</button>
                    </form>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length===0?'<div class="p-4 text-slate-500">Sem resultados.</div>':''}
      </div>
    `
  }));
});

app.get('/admin/bookings/:id', requireLogin, requirePermission('bookings.view'), (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as unit_name, u.capacity, u.base_price_cents, p.name as property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const canEditBooking = userCan(req.user, 'bookings.edit');
  const canCancelBooking = userCan(req.user, 'bookings.cancel');
  const canAddNote = userCan(req.user, 'bookings.notes');
  const bookingNotes = db.prepare(`
    SELECT bn.id, bn.note, bn.created_at, u.username
      FROM booking_notes bn
      JOIN users u ON u.id = bn.user_id
     WHERE bn.booking_id = ?
     ORDER BY bn.created_at DESC
  `).all(b.id).map(n => ({
    ...n,
    created_human: dayjs(n.created_at).format('DD/MM/YYYY HH:mm')
  }));

  res.send(layout({
    title: `Editar reserva #${b.id}`,
    user: req.user,
    activeNav: 'bookings',
    body: html`
      <a class="text-slate-600 underline" href="/admin/bookings">&larr; Reservas</a>
      <h1 class="text-2xl font-semibold mb-4">Editar reserva #${b.id}</h1>

      <div class="card p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div class="text-sm text-slate-500">${esc(b.property_name)}</div>
          <div class="font-semibold mb-3">${esc(b.unit_name)}</div>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>Atual: ${dayjs(b.checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(b.checkout).format('DD/MM/YYYY')}</li>
            <li>Ocupação: ${b.adults}A+${b.children}C (cap. ${b.capacity})</li>
            <li>Total atual: € ${eur(b.total_cents)}</li>
          </ul>
          ${b.internal_notes ? `
            <div class="mt-4">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Anotacoes internas</div>
              <div class="text-sm text-slate-700 whitespace-pre-line">${esc(b.internal_notes)}</div>
            </div>
          ` : ''}
        </div>

        <form method="post" action="/admin/bookings/${b.id}/update" class="grid gap-3" id="booking-update-form">
          <fieldset class="grid gap-3" ${canEditBooking ? '' : 'disabled'}>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm">Check-in</label>
                <input required type="date" name="checkin" class="input" value="${b.checkin}"/>
              </div>
              <div>
                <label class="text-sm">Check-out</label>
                <input required type="date" name="checkout" class="input" value="${b.checkout}"/>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm">Adultos</label>
                <input required type="number" min="1" name="adults" class="input" value="${b.adults}"/>
              </div>
              <div>
                <label class="text-sm">Crianças</label>
                <input required type="number" min="0" name="children" class="input" value="${b.children}"/>
              </div>
            </div>

            <input class="input" name="guest_name" value="${esc(b.guest_name)}" placeholder="Nome do hóspede" required />
            <input class="input" type="email" name="guest_email" value="${esc(b.guest_email)}" placeholder="Email" required />
            <input class="input" name="guest_phone" value="${esc(b.guest_phone || '')}" placeholder="Telefone" />
            <input class="input" name="guest_nationality" value="${esc(b.guest_nationality || '')}" placeholder="Nacionalidade" />
            <div>
              <label class="text-sm">Agência</label>
              <input class="input" name="agency" value="${esc(b.agency || '')}" placeholder="Ex: BOOKING" />
            </div>
            <div class="grid gap-1">
              <label class="text-sm">Anotações internas</label>
              <textarea class="input" name="internal_notes" rows="4" placeholder="Notas internas (apenas equipa)">${esc(b.internal_notes || '')}</textarea>
              <p class="text-xs text-slate-500">Não aparece para o hóspede.</p>
            </div>

            <div>
              <label class="text-sm">Estado</label>
              <select name="status" class="input">
                <option value="CONFIRMED" ${b.status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
                <option value="PENDING" ${b.status==='PENDING'?'selected':''}>PENDING</option>
              </select>
            </div>

            <button class="btn btn-primary justify-self-start">Guardar alterações</button>
          </fieldset>
          ${canEditBooking ? '' : '<p class="text-xs text-slate-500">Sem permissões para editar esta reserva.</p>'}
        </form>
        ${canCancelBooking ? `
          <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');" class="self-end">
            <button class="btn btn-danger mt-2">Cancelar reserva</button>
          </form>
        ` : ''}
        <section class="md:col-span-2 card p-4" id="notes">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">Notas internas</h2>
            <span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">${bookingNotes.length} nota${bookingNotes.length === 1 ? '' : 's'}</span>
          </div>
          <div class="mt-3 space-y-3">
            ${bookingNotes.length ? bookingNotes.map(n => `
              <article class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div class="text-xs text-slate-500 mb-1">${esc(n.username)} &middot; ${esc(n.created_human)}</div>
                <div class="text-sm text-slate-700 whitespace-pre-line">${esc(n.note)}</div>
              </article>
            `).join('') : '<p class="text-sm text-slate-500">Sem notas adicionadas pela equipa.</p>'}
          </div>
          ${canAddNote ? `
            <form method="post" action="/admin/bookings/${b.id}/notes" class="mt-4 grid gap-2">
              <label class="text-sm" for="note">Adicionar nova nota</label>
              <textarea class="input" id="note" name="note" rows="3" placeholder="Partilhe contexto para a equipa" required></textarea>
              <button class="btn btn-primary justify-self-start">Gravar nota</button>
            </form>
          ` : '<p class="text-xs text-slate-500 mt-4">Sem permissões para adicionar novas notas.</p>'}
        </section>
      </div>
    `
  }));
});

app.post('/admin/bookings/:id/update', requireLogin, requirePermission('bookings.edit'), (req, res) => {
  const id = req.params.id;
  const b = db.prepare(`
    SELECT b.*, u.capacity, u.base_price_cents
      FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.id = ?
  `).get(id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const checkin = req.body.checkin;
  const checkout = req.body.checkout;
  const internalNotesRaw = req.body.internal_notes;
  const internal_notes = typeof internalNotesRaw === 'string' ? internalNotesRaw.trim() || null : null;
  const adults = Math.max(1, Number(req.body.adults || 1));
  const children = Math.max(0, Number(req.body.children || 0));
  let status = (req.body.status || 'CONFIRMED').toUpperCase();
  if (!['CONFIRMED','PENDING'].includes(status)) status = 'CONFIRMED';
  const guest_name = req.body.guest_name;
  const guest_email = req.body.guest_email;
  const guest_phone = req.body.guest_phone || null;
  const guest_nationality = req.body.guest_nationality || null;
  const agency = req.body.agency ? String(req.body.agency).trim().toUpperCase() : null;

  if (!dayjs(checkout).isAfter(dayjs(checkin))) return res.status(400).send('checkout deve ser > checkin');
  if (adults + children > b.capacity) return res.status(400).send(`Capacidade excedida (máx ${b.capacity}).`);

  const conflict = db.prepare(`
    SELECT 1 FROM bookings 
     WHERE unit_id = ? 
       AND id <> ?
       AND status IN ('CONFIRMED','PENDING')
       AND NOT (checkout <= ? OR checkin >= ?)
     LIMIT 1
  `).get(b.unit_id, id, checkin, checkout);
  if (conflict) return res.status(409).send('Conflito com outra reserva.');

  const q = rateQuote(b.unit_id, checkin, checkout, b.base_price_cents);
  if (q.nights < q.minStayReq) return res.status(400).send(`Estadia mínima: ${q.minStayReq} noites`);

  adminBookingUpdateStmt.run(
    checkin,
    checkout,
    adults,
    children,
    guest_name,
    guest_email,
    guest_phone,
    guest_nationality,
    agency,
    internal_notes,
    status,
    q.total_cents,
    id
  );

  logChange(req.user.id, 'booking', Number(id), 'update',
    {
      checkin: b.checkin,
      checkout: b.checkout,
      adults: b.adults,
      children: b.children,
      status: b.status,
      total_cents: b.total_cents
    },
    { checkin, checkout, adults, children, status, total_cents: q.total_cents }
  );

  res.redirect(`/admin/bookings/${id}`);
});

app.post('/admin/bookings/:id/notes', requireLogin, requirePermission('bookings.notes'), (req, res) => {
  const bookingId = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
  if (!exists) return res.status(404).send('Reserva não encontrada');
  const noteRaw = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!noteRaw) return res.status(400).send('Nota obrigatória.');
  db.prepare('INSERT INTO booking_notes(booking_id, user_id, note) VALUES (?,?,?)').run(bookingId, req.user.id, noteRaw);
  logActivity(req.user.id, 'booking:note_add', 'booking', bookingId, { snippet: noteRaw.slice(0, 200) });
  res.redirect(`/admin/bookings/${bookingId}#notes`);
});

app.post('/admin/bookings/:id/cancel', requireLogin, requirePermission('bookings.cancel'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).send('Reserva não encontrada');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  logChange(req.user.id, 'booking', Number(id), 'cancel', {
    checkin: existing.checkin,
    checkout: existing.checkout,
    guest_name: existing.guest_name,
    status: existing.status,
    unit_id: existing.unit_id
  }, null);
  const back = req.get('referer') || '/admin/bookings';
  res.redirect(back);
});

// (Opcional) Apagar definitivamente
app.post('/admin/bookings/:id/delete', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (existing) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    logChange(req.user.id, 'booking', Number(req.params.id), 'delete', {
      checkin: existing.checkin,
      checkout: existing.checkout,
      unit_id: existing.unit_id,
      guest_name: existing.guest_name
    }, null);
  }
  res.redirect('/admin/bookings');
});

app.get('/admin/auditoria', requireLogin, requireAnyPermission(['audit.view', 'logs.view']), (req, res) => {
  const entityRaw = typeof req.query.entity === 'string' ? req.query.entity.trim().toLowerCase() : '';
  const idRaw = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const canViewAudit = userCan(req.user, 'audit.view');
  const canViewLogs = userCan(req.user, 'logs.view');

  let changeLogs = [];
  if (canViewAudit) {
    const filters = [];
    const params = [];
    if (entityRaw) { filters.push('cl.entity_type = ?'); params.push(entityRaw); }
    const idNumber = Number(idRaw);
    if (idRaw && !Number.isNaN(idNumber)) { filters.push('cl.entity_id = ?'); params.push(idNumber); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    changeLogs = db.prepare(`
      SELECT cl.*, u.username
        FROM change_logs cl
        JOIN users u ON u.id = cl.actor_id
       ${where}
       ORDER BY cl.created_at DESC
       LIMIT 200
    `).all(...params);
  }

  const sessionLogs = canViewLogs
    ? db.prepare(`
        SELECT sl.*, u.username
          FROM session_logs sl
          LEFT JOIN users u ON u.id = sl.user_id
         ORDER BY sl.created_at DESC
         LIMIT 120
      `).all()
    : [];

  const activityLogs = canViewLogs
    ? db.prepare(`
        SELECT al.*, u.username
          FROM activity_logs al
          LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT 200
      `).all()
    : [];

  res.send(layout({
    title: 'Auditoria',
    user: req.user,
    activeNav: 'audit',
    body: html`
      <h1 class="text-2xl font-semibold mb-4">Auditoria e registos internos</h1>
      ${canViewAudit ? `
        <form class="card p-4 mb-6 grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get" action="/admin/auditoria">
          <div class="grid gap-1">
            <label class="text-sm text-slate-600">Entidade</label>
            <select class="input" name="entity">
              <option value="" ${!entityRaw ? 'selected' : ''}>Todas</option>
              <option value="booking" ${entityRaw === 'booking' ? 'selected' : ''}>Reservas</option>
              <option value="block" ${entityRaw === 'block' ? 'selected' : ''}>Bloqueios</option>
            </select>
          </div>
          <div class="grid gap-1">
            <label class="text-sm text-slate-600">ID</label>
            <input class="input" name="id" value="${esc(idRaw)}" placeholder="Opcional" />
          </div>
          <div class="self-end">
            <button class="btn btn-primary w-full">Filtrar</button>
          </div>
        </form>

        <div class="space-y-4">
          ${changeLogs.length ? changeLogs.map(log => html`
            <article class="card p-4 grid gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm text-slate-600">${dayjs(log.created_at).format('DD/MM/YYYY HH:mm')}</div>
                <div class="text-xs uppercase tracking-wide text-slate-500">${esc(log.action)}</div>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span class="pill-indicator">${esc(log.entity_type)} #${log.entity_id}</span>
                <span class="text-slate-500">por ${esc(log.username)}</span>
              </div>
              <div class="bg-slate-50 rounded-lg p-3 overflow-x-auto">${renderAuditDiff(log.before_json, log.after_json)}</div>
            </article>
          `).join('') : `<div class="text-sm text-slate-500">Sem registos para os filtros selecionados.</div>`}
        </div>
      ` : `<div class="card p-4 text-sm text-slate-500">Sem permissões para consultar o histórico de alterações.</div>`}

      ${canViewLogs ? `
        <section class="mt-8 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Logs de sessão</h2>
            <span class="text-xs text-slate-500">Últimos ${sessionLogs.length} registos</span>
          </div>
          <div class="card p-0 overflow-x-auto">
            <table class="w-full min-w-[720px] text-sm">
              <thead class="bg-slate-50 text-slate-500">
                <tr>
                  <th class="text-left px-4 py-2">Quando</th>
                  <th class="text-left px-4 py-2">Utilizador</th>
                  <th class="text-left px-4 py-2">Ação</th>
                  <th class="text-left px-4 py-2">IP</th>
                  <th class="text-left px-4 py-2">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                ${sessionLogs.length ? sessionLogs.map(row => `
                  <tr class="border-t">
                    <td class="px-4 py-2 text-slate-600">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</td>
                    <td class="px-4 py-2">${esc(row.username || '—')}</td>
                    <td class="px-4 py-2">${esc(row.action)}</td>
                    <td class="px-4 py-2">${esc(row.ip || '')}</td>
                    <td class="px-4 py-2 text-slate-500">${esc((row.user_agent || '').slice(0, 120))}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="px-4 py-3 text-slate-500">Sem atividade de sessão registada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>

        <section class="mt-8 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Atividade da aplicação</h2>
            <span class="text-xs text-slate-500">Últimos ${activityLogs.length} eventos</span>
          </div>
          <div class="card p-0 overflow-x-auto">
            <table class="w-full min-w-[820px] text-sm">
              <thead class="bg-slate-50 text-slate-500">
                <tr>
                  <th class="text-left px-4 py-2">Quando</th>
                  <th class="text-left px-4 py-2">Utilizador</th>
                  <th class="text-left px-4 py-2">Ação</th>
                  <th class="text-left px-4 py-2">Entidade</th>
                  <th class="text-left px-4 py-2">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                ${activityLogs.length ? activityLogs.map(row => `
                  <tr class="border-t align-top">
                    <td class="px-4 py-2 text-slate-600">${dayjs(row.created_at).format('DD/MM/YYYY HH:mm')}</td>
                    <td class="px-4 py-2">${esc(row.username || '—')}</td>
                    <td class="px-4 py-2">${esc(row.action)}</td>
                    <td class="px-4 py-2">${row.entity_type ? esc(row.entity_type) + (row.entity_id ? ' #' + row.entity_id : '') : '—'}</td>
                    <td class="px-4 py-2">${formatJsonSnippet(row.meta_json)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="px-4 py-3 text-slate-500">Sem atividade registada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      ` : ''}
    `
  }));
});

// ===================== Utilizadores (admin) =====================
app.get('/admin/utilizadores', requireAdmin, (req,res)=>{
  const users = db.prepare('SELECT id, username, role FROM users ORDER BY username').all().map(u => ({
    ...u,
    role_key: normalizeRole(u.role)
  }));
  res.send(layout({ title:'Utilizadores', user: req.user, activeNav: 'users', body: html`
    <a class="text-slate-600 underline" href="/admin">&larr; Backoffice</a>
    <h1 class="text-2xl font-semibold mb-4">Utilizadores</h1>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section class="card p-4">
        <h2 class="font-semibold mb-3">Criar novo utilizador</h2>
        <form method="post" action="/admin/users/create" class="grid gap-2">
          <input required name="username" class="input" placeholder="Utilizador" />
          <input required type="password" name="password" class="input" placeholder="Password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <select name="role" class="input">
            <option value="rececao">Receção</option>
            <option value="gestao">Gestão</option>
            <option value="direcao">Direção</option>
          </select>
          <button class="btn btn-primary">Criar</button>
        </form>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold mb-3">Alterar password</h2>
        <form method="post" action="/admin/users/password" class="grid gap-2">
          <label class="text-sm">Selecionar utilizador</label>
          <select required name="user_id" class="input">
            ${users.map(u=>`<option value="${u.id}">${esc(u.username)} (${esc(ROLE_LABELS[u.role_key] || u.role_key)})</option>`).join('')}
          </select>
          <input required type="password" name="new_password" class="input" placeholder="Nova password (min 8)" />
          <input required type="password" name="confirm" class="input" placeholder="Confirmar password" />
          <button class="btn btn-primary">Alterar</button>
        </form>
        <p class="text-sm text-slate-500 mt-2">Ao alterar, as sessões desse utilizador são terminadas.</p>
      </section>
    </div>
  `}));
});

app.post('/admin/users/create', requireAdmin, (req,res)=>{
  const { username, password, confirm, role } = req.body;
  if (!username || !password || password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).send('Utilizador já existe.');
  const hash = bcrypt.hashSync(password, 10);
  const roleKey = normalizeRole(role);
  const result = db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run(username, hash, roleKey);
  logActivity(req.user.id, 'user:create', 'user', result.lastInsertRowid, { username, role: roleKey });
  res.redirect('/admin/utilizadores');
});

app.post('/admin/users/password', requireAdmin, (req,res)=>{
  const { user_id, new_password, confirm } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).send('Password inválida (min 8).');
  if (new_password !== confirm) return res.status(400).send('Passwords não coincidem.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).send('Utilizador não encontrado');
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
  logActivity(req.user.id, 'user:password_reset', 'user', Number(user_id), {});
  res.redirect('/admin/utilizadores');
});
registerFrontoffice(app, context);
registerBackoffice(app, context);

// ===================== Debug Rotas + 404 =====================
app.get('/_routes', (req, res) => {
  const router = app._router;
  if (!router || !router.stack) return res.type('text/plain').send('(router não inicializado)');
  const lines = [];
  router.stack.forEach(mw => {
    if (mw.route && mw.route.path) {
      const methods = Object.keys(mw.route.methods).map(m => m.toUpperCase()).join(',');
      lines.push(`${methods} ${mw.route.path}`);
    } else if (mw.name === 'router' && mw.handle && mw.handle.stack) {
      mw.handle.stack.forEach(r => {
        const rt = r.route;
        if (rt && rt.path) {
          const methods = Object.keys(rt.methods).map(m => m.toUpperCase()).join(',');
          lines.push(`${methods} ${rt.path}`);
        }
      });
    }
  });
  res.type('text/plain').send(lines.sort().join('\n') || '(sem rotas)');
});

app.use((req, res) => {
  res.status(404).send(context.layout({ body: '<h1 class="text-xl font-semibold">404</h1><p>Página não encontrada.</p>' }));
});

// ===================== START SERVER =====================
if (!global.__SERVER_STARTED__) {
  const PORT = process.env.PORT || 3000;
  const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
  const SSL_CERT_PATH = process.env.SSL_CERT_PATH;

  if (SSL_KEY_PATH && SSL_CERT_PATH && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
    const options = { key: fs.readFileSync(SSL_KEY_PATH), cert: fs.readFileSync(SSL_CERT_PATH) };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`Booking Engine (HTTPS) https://localhost:${PORT}`);
    });
  } else {
    app.listen(PORT, () => console.log(`Booking Engine (HTTP) http://localhost:${PORT}`));
  }
  global.__SERVER_STARTED__ = true;
}

module.exports = app;
