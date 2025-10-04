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

const registerAuthRoutes = require('./src/modules/auth');
const registerFrontoffice = require('./src/modules/frontoffice');
const registerBackoffice = require('./src/modules/backoffice');
const path = require('path');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});

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

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL,
  details TEXT,
  due_date TEXT,
  due_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
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
  direcao: 'Direção',
  limpeza: 'Limpeza'
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
    'automation.view',
    'housekeeping.view',
    'housekeeping.manage',
    'housekeeping.complete'
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
    'audit.view',
    'housekeeping.view',
    'housekeeping.manage',
    'housekeeping.complete'
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
    'logs.view',
    'housekeeping.view',
    'housekeeping.manage',
    'housekeeping.complete'
  ]),
  limpeza: new Set([
    'housekeeping.view',
    'housekeeping.complete'
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
  if (key === 'limpeza' || key === 'limpezas' || key === 'housekeeping') return 'limpeza';
  if (
    key === 'rececao' ||
    key === 'receção' ||
    key === 'recepcao' ||
    key === 'recepção' ||
    key === 'rececionista' ||
    key === 'recepcionista'
  )
    return 'rececao';
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
const UPLOAD_BRANDING = path.join(UPLOAD_ROOT, 'branding');
const paths = { UPLOAD_ROOT, UPLOAD_UNITS, UPLOAD_BRANDING };
function ensureDir(p){ if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(UPLOAD_ROOT);
ensureDir(UPLOAD_UNITS);
ensureDir(UPLOAD_BRANDING);

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

const brandingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDir(UPLOAD_BRANDING);
    cb(null, UPLOAD_BRANDING);
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.png').toLowerCase();
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});

const uploadBrandingAsset = multer({
  storage: brandingStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype || '');
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

function normalizeHexColor(value, fallback = null) {
  if (!value) return fallback;
  const str = String(value).trim();
  const match = str.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return fallback;
  return `#${match[1].toLowerCase()}`;
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function mixColors(hexA, hexB, ratio) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return hexA;
  const t = Math.max(0, Math.min(1, Number(ratio))); 
  return rgbToHex({
    r: a.r * (1 - t) + b.r * t,
    g: a.g * (1 - t) + b.g * t,
    b: a.b * (1 - t) + b.b * t
  });
}

function contrastColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#ffffff';
}

function sanitizeBrandingTheme(raw = {}) {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned = {};

  if (raw.brandName !== undefined) {
    const val = String(raw.brandName || '').trim();
    if (val) cleaned.brandName = val.slice(0, 80);
  }
  if (raw.brandInitials !== undefined) {
    const letters = String(raw.brandInitials || '')
      .replace(/[^\p{L}0-9]/gu, '')
      .toUpperCase()
      .slice(0, 3);
    if (letters) cleaned.brandInitials = letters;
  }
  if (raw.tagline !== undefined) {
    const tagline = String(raw.tagline || '').trim();
    if (tagline) cleaned.tagline = tagline.slice(0, 140);
  }
  if (raw.mode !== undefined) {
    const mode = String(raw.mode).toLowerCase();
    cleaned.mode = mode === 'manual' ? 'manual' : 'quick';
  }
  if (raw.primaryColor !== undefined) {
    const primary = normalizeHexColor(raw.primaryColor, null);
    if (primary) cleaned.primaryColor = primary;
  }
  if (raw.secondaryColor !== undefined) {
    const secondary = normalizeHexColor(raw.secondaryColor, null);
    if (secondary) cleaned.secondaryColor = secondary;
  }
  if (raw.highlightColor !== undefined) {
    const highlight = normalizeHexColor(raw.highlightColor, null);
    if (highlight) cleaned.highlightColor = highlight;
  }
  if (raw.cornerStyle !== undefined) {
    const style = String(raw.cornerStyle || '').toLowerCase();
    if (style === 'square' || style === 'rounded') cleaned.cornerStyle = style;
  }
  if (raw.logoFile !== undefined) {
    const file = String(raw.logoFile || '').trim();
    if (/^[a-f0-9]{16}\.[a-z0-9]+$/i.test(file)) cleaned.logoFile = file;
  }
  if (raw.logoHidden) {
    cleaned.logoHidden = true;
  }
  if (raw.logoAlt !== undefined) {
    const alt = String(raw.logoAlt || '').trim();
    if (alt) cleaned.logoAlt = alt.slice(0, 140);
  }

  return cleaned;
}

function sanitizeSavedTheme(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const theme = sanitizeBrandingTheme(raw.theme || {});
  const name = String(raw.name || '').trim().slice(0, 80);
  if (!name || !Object.keys(theme).length) return null;
  const idSource = raw.id !== undefined ? String(raw.id) : crypto.randomBytes(6).toString('hex');
  return {
    id: idSource.slice(0, 40),
    name,
    theme
  };
}

function sanitizeBrandingStore(raw) {
  const base = {
    global: {},
    properties: {},
    savedThemes: []
  };
  if (!raw || typeof raw !== 'object') return base;

  // Legacy flat structure
  if (raw.brandName !== undefined || raw.accentColor !== undefined || raw.logoFile !== undefined) {
    base.global = sanitizeBrandingTheme(raw);
  }

  if (raw.global !== undefined) {
    base.global = sanitizeBrandingTheme(raw.global);
  }

  if (raw.properties && typeof raw.properties === 'object') {
    Object.entries(raw.properties).forEach(([key, value]) => {
      const id = Number(key);
      if (!Number.isInteger(id) || id <= 0) return;
      const theme = sanitizeBrandingTheme(value);
      if (Object.keys(theme).length) base.properties[id] = theme;
    });
  }

  if (Array.isArray(raw.savedThemes)) {
    base.savedThemes = raw.savedThemes
      .map(entry => sanitizeSavedTheme(entry))
      .filter(Boolean);
  }

  return base;
}

const BRANDING_THEME_DEFAULT = {
  brandName: 'Gestor de Alojamentos',
  brandInitials: 'GA',
  tagline: 'Reservas com confiança e profissionalismo.',
  primaryColor: '#2563eb',
  secondaryColor: '#1d4ed8',
  highlightColor: '#f97316',
  mode: 'quick',
  cornerStyle: 'rounded'
};

let brandingStore = sanitizeBrandingStore(readAutomationState('branding'));

function deriveInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3) || BRANDING_THEME_DEFAULT.brandInitials;
}

function computeBrandingTheme(themeRaw, { fallbackName } = {}) {
  const theme = sanitizeBrandingTheme(themeRaw || {});
  const merged = { ...BRANDING_THEME_DEFAULT, ...theme };
  const brandName = merged.brandName || fallbackName || BRANDING_THEME_DEFAULT.brandName;
  const brandInitials = merged.brandInitials || deriveInitials(brandName);
  const tagline = merged.tagline || BRANDING_THEME_DEFAULT.tagline;
  const mode = merged.mode === 'manual' ? 'manual' : 'quick';

  const primaryColor = merged.primaryColor || BRANDING_THEME_DEFAULT.primaryColor;
  const secondaryColor = mode === 'manual'
    ? (merged.secondaryColor || BRANDING_THEME_DEFAULT.secondaryColor)
    : mixColors(primaryColor, '#1f2937', 0.18);
  const highlightColor = mode === 'manual'
    ? (merged.highlightColor || BRANDING_THEME_DEFAULT.highlightColor)
    : mixColors(primaryColor, '#f97316', 0.35);

  const primaryContrast = contrastColor(primaryColor);
  const primaryHover = mixColors(primaryColor, '#000000', 0.18);
  const primarySoft = mixColors(primaryColor, '#ffffff', 0.82);
  const surface = mixColors(primaryColor, '#ffffff', 0.94);
  const surfaceBorder = mixColors(primaryColor, '#1f2937', 0.12);
  const surfaceRing = mixColors(primaryColor, '#60a5fa', 0.35);
  const surfaceContrast = contrastColor(surface);
  const background = mixColors(primaryColor, '#ffffff', 0.97);
  const mutedText = mixColors(primaryColor, '#475569', 0.35);
  const gradientFrom = secondaryColor;
  const gradientTo = primaryColor;

  const cornerStyle = merged.cornerStyle === 'square' ? 'square' : 'rounded';
  const radius = cornerStyle === 'square' ? '14px' : '24px';
  const radiusSm = cornerStyle === 'square' ? '8px' : '16px';
  const radiusLg = cornerStyle === 'square' ? '24px' : '32px';
  const radiusPill = cornerStyle === 'square' ? '22px' : '999px';

  const logoHidden = !!merged.logoHidden;
  const rawLogoFile = merged.logoFile || null;
  const logoFile = logoHidden ? null : rawLogoFile;
  const logoAlt = merged.logoAlt || brandName;
  const logoPath = logoFile ? `/uploads/branding/${logoFile}` : null;

  return {
    brandName,
    brandInitials,
    tagline,
    primaryColor,
    secondaryColor,
    highlightColor,
    primaryContrast,
    primaryHover,
    primarySoft,
    surface,
    surfaceBorder,
    surfaceRing,
    surfaceContrast,
    background,
    mutedText,
    gradientFrom,
    gradientTo,
    cornerStyle,
    radius,
    radiusSm,
    radiusLg,
    radiusPill,
    mode,
    logoHidden,
    logoFile,
    logoAlt,
    logoPath
  };
}

function computeBranding(state, options = {}) {
  return computeBrandingTheme(state, options);
}

function getBranding({ propertyId = null, propertyName = '' } = {}) {
  const baseTheme = { ...brandingStore.global };
  if (propertyId && brandingStore.properties[propertyId]) {
    Object.assign(baseTheme, brandingStore.properties[propertyId]);
  }
  return computeBranding(baseTheme, { fallbackName: propertyName });
}

function persistBrandingStore(nextStore) {
  brandingStore = sanitizeBrandingStore(nextStore);
  writeAutomationState('branding', brandingStore);
}

function listBrandingThemes(store = brandingStore) {
  const themes = [];
  if (store.global) themes.push(store.global);
  Object.values(store.properties || {}).forEach(theme => themes.push(theme));
  (store.savedThemes || []).forEach(entry => {
    if (entry && entry.theme) themes.push(entry.theme);
  });
  return themes;
}

function isBrandingLogoInUse(fileName, store = brandingStore) {
  if (!fileName) return false;
  return listBrandingThemes(store).some(theme => theme.logoFile === fileName);
}

function cloneBrandingStoreState(store = brandingStore) {
  return {
    global: { ...(store.global || {}) },
    properties: Object.fromEntries(
      Object.entries(store.properties || {}).map(([key, value]) => [Number(key), { ...(value || {}) }])
    ),
    savedThemes: (store.savedThemes || []).map(entry => ({
      id: entry.id,
      name: entry.name,
      theme: { ...((entry && entry.theme) || {}) }
    }))
  };
}


function extractBrandingSubmission(body = {}) {
  const updates = {};
  const clears = new Set();
  const modeRaw = typeof body.mode === 'string' ? body.mode.toLowerCase() : '';
  updates.mode = modeRaw === 'manual' ? 'manual' : 'quick';

  if (body.brand_name !== undefined) {
    const val = String(body.brand_name || '').trim();
    if (val) updates.brandName = val.slice(0, 80);
  }
  if (body.brand_initials !== undefined) {
    const initials = String(body.brand_initials || '')
      .replace(/[^\p{L}0-9]/gu, '')
      .toUpperCase()
      .slice(0, 3);
    if (initials) updates.brandInitials = initials;
    else clears.add('brandInitials');
  }
  if (body.tagline !== undefined) {
    const tagline = String(body.tagline || '').trim();
    if (tagline) updates.tagline = tagline.slice(0, 140);
    else clears.add('tagline');
  }
  if (body.corner_style !== undefined) {
    const style = String(body.corner_style || '').toLowerCase();
    if (style === 'square' || style === 'rounded') updates.cornerStyle = style;
  }

  const primary = normalizeHexColor(body.primary_color, null);
  if (primary) updates.primaryColor = primary;
  const secondary = normalizeHexColor(body.secondary_color, null);
  const highlight = normalizeHexColor(body.highlight_color, null);
  if (updates.mode === 'manual') {
    if (secondary) updates.secondaryColor = secondary;
    if (highlight) updates.highlightColor = highlight;
  } else {
    clears.add('secondaryColor');
    clears.add('highlightColor');
  }

  if (body.logo_alt !== undefined) {
    const alt = String(body.logo_alt || '').trim();
    if (alt) updates.logoAlt = alt.slice(0, 140);
    else clears.add('logoAlt');
  }

  return { updates: sanitizeBrandingTheme(updates), clears, mode: updates.mode };
}

async function removeBrandingLogo(fileName) {
  if (!fileName || isBrandingLogoInUse(fileName)) return;
  const target = path.join(UPLOAD_BRANDING, fileName);
  try {
    await fsp.unlink(target);
  } catch (_) {}
}

const selectPropertyById = db.prepare('SELECT id, name FROM properties WHERE id = ?');

function parsePropertyId(raw) {
  if (raw === undefined || raw === null) return null;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function rememberActiveBrandingProperty(res, propertyId) {
  if (!res || typeof res.cookie !== 'function') return;
  if (propertyId) {
    res.cookie('active_branding_property', String(propertyId), {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
  } else {
    res.clearCookie('active_branding_property');
  }
}

function isSafeRedirectTarget(target) {
  if (typeof target !== 'string') return false;
  if (!target.startsWith('/')) return false;
  if (target.startsWith('//')) return false;
  if (target.includes('\0')) return false;
  try {
    // Validate via URL construction to prevent malformed values
    const parsed = new URL(target, 'https://example.com');
    return parsed.origin === 'https://example.com';
  } catch (_) {
    return false;
  }
}

function resolveBrandingForRequest(req, overrides = {}) {
  let propertyId = null;
  let propertyName = overrides.propertyName || null;

  const explicit = parsePropertyId(overrides.propertyId);
  const requestProp = parsePropertyId(req && req.activeBrandingPropertyId);
  const queryProp = req ? (
    parsePropertyId(req.query ? (req.query.propertyId ?? req.query.property_id ?? req.query.property ?? null) : null)
  ) : null;
  const cookieProp = req && req.cookies ? parsePropertyId(req.cookies.active_branding_property) : null;

  propertyId = explicit || requestProp || queryProp || cookieProp || null;

  if (propertyId && !propertyName) {
    const row = selectPropertyById.get(propertyId);
    if (row) {
      propertyName = row.name;
    } else {
      propertyId = null;
    }
  }

  const branding = getBranding({ propertyId, propertyName });
  if (req) {
    req.brandingPropertyId = propertyId;
    req.brandingPropertyName = propertyName || null;
  }
  return branding;
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

function userHasBackofficeAccess(user) {
  if (!user) return false;
  const normalizedRole = user.role ? normalizeRole(user.role) : null;
  return normalizedRole === MASTER_ROLE || normalizedRole === 'gestao' || normalizedRole === 'direcao';
}

function requireBackofficeAccess(req, res, next) {
  if (!req.user) {
    const sess = getSession(req.cookies.adm);
    if (!sess) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    req.user = buildUserContext(sess);
  }

  if (userHasBackofficeAccess(req.user)) return next();

  if (wantsJson(req)) return res.status(403).json({ ok: false, message: 'Sem permissão' });
  return res.status(403).send('Sem permissão');
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
function layout({ title, body, user, activeNav = '', branding }) {
  const theme = branding || getBranding();
  const pageTitle = title ? `${title} · ${theme.brandName}` : theme.brandName;
  const hasUser = !!user;
  const navClass = (key) => `nav-link${activeNav === key ? ' active' : ''}`;
  const can = (perm) => userCan(user, perm);
  const isHousekeepingOnly = user && user.role === 'limpeza';
  const canAccessBackoffice = userHasBackofficeAccess(user);
  const brandHomeHref = isHousekeepingOnly ? '/limpeza/tarefas' : '/';
  const userPermissions = user ? Array.from(user.permissions || []) : [];
  const brandLogoClass = theme.logoPath ? 'brand-logo has-image' : 'brand-logo';
  const brandLogoContent = theme.logoPath
    ? `<img src="${esc(theme.logoPath)}" alt="${esc(theme.logoAlt)}" class="brand-logo-img" />`
    : `<span class="brand-logo-text">${esc(theme.brandInitials)}</span>`;
  const brandTagline = theme.tagline ? `<span class="brand-tagline">${esc(theme.tagline)}</span>` : '';
  return html`<!doctype html>
  <html lang="pt">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${pageTitle}</title>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://unpkg.com/hyperscript.org@0.9.12"></script>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/lucide@latest"></script>
      <style>
        :root{
          --brand-primary:${theme.primaryColor};
          --brand-primary-contrast:${theme.primaryContrast};
          --brand-primary-hover:${theme.primaryHover};
          --brand-primary-soft:${theme.primarySoft};
          --brand-secondary:${theme.secondaryColor};
          --brand-highlight:${theme.highlightColor};
          --brand-surface:${theme.surface};
          --brand-surface-border:${theme.surfaceBorder};
          --brand-surface-ring:${theme.surfaceRing};
          --brand-surface-contrast:${theme.surfaceContrast};
          --brand-background:${theme.background};
          --brand-muted:${theme.mutedText};
          --brand-radius:${theme.radius};
          --brand-radius-sm:${theme.radiusSm};
          --brand-radius-lg:${theme.radiusLg};
          --brand-radius-pill:${theme.radiusPill};
        }
        .input { box-sizing:border-box; width:100%; min-width:0; display:block; padding:.5rem .75rem; border-radius:.5rem; border:1px solid #cbd5e1; background:#fff; line-height:1.25rem; }
        .btn  { display:inline-block; padding:.5rem .75rem; border-radius:.5rem; }
        .btn-primary{ background:var(--brand-primary); color:var(--brand-primary-contrast); }
        .btn-muted{ background:#e2e8f0; }
        .btn-light{ background:var(--brand-primary-soft); color:#0f172a; font-weight:600; }
        .btn-danger{ background:#f43f5e; color:#fff; }
        .btn[disabled]{opacity:.5;cursor:not-allowed;}
        .card{ background:#fff; border-radius: var(--brand-radius); box-shadow: 0 1px 2px rgba(16,24,40,.05); }
        body.app-body{margin:0;background:var(--brand-background);color:#4b4d59;font-family:'Inter','Segoe UI',sans-serif;}
        .app-shell{min-height:100vh;display:flex;flex-direction:column;}
        .topbar{background:var(--brand-surface);border-bottom:1px solid var(--brand-surface-border);box-shadow:0 1px 0 rgba(15,23,42,.04);}
        .topbar-inner{max-width:1120px;margin:0 auto;padding:24px 32px 12px;display:flex;flex-wrap:wrap;align-items:center;gap:24px;}
        .brand{display:flex;align-items:center;gap:12px;color:#3a3b47;font-weight:600;text-decoration:none;font-size:1.125rem;}
        .brand-logo{width:40px;height:40px;border-radius:var(--brand-radius-sm);background:linear-gradient(130deg,var(--brand-primary),var(--brand-secondary));display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--brand-primary-contrast);box-shadow:0 10px 20px rgba(15,23,42,.18);overflow:hidden;}
        .brand-logo.has-image{box-shadow:none;background:none;padding:0;}
        .brand-logo-img{width:100%;height:100%;object-fit:cover;display:block;}
        .brand-logo-text{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;}
        .brand-name{letter-spacing:.02em;}
        .brand-tagline{display:block;font-size:.75rem;color:#7a7b88;font-weight:500;margin-top:-6px;}
        .nav-links{display:flex;align-items:center;gap:28px;flex-wrap:wrap;}
        .nav-link{position:relative;color:#7a7b88;font-weight:500;text-decoration:none;padding-bottom:6px;transition:color .2s ease;}
        .nav-link:hover{color:#424556;}
        .nav-link.active{color:#2f3140;}
        .nav-link.active::after{content:'';position:absolute;left:0;right:0;bottom:-12px;height:3px;border-radius:999px;background:linear-gradient(90deg,var(--brand-secondary),var(--brand-primary));}
        .nav-actions{margin-left:auto;display:flex;align-items:center;gap:18px;}
        .logout-form{margin:0;}
        .logout-form button,.login-link{background:none;border:none;color:#7a7b88;font-weight:500;cursor:pointer;padding:0;text-decoration:none;}
        .logout-form button:hover,.login-link:hover{color:#2f3140;}
        .nav-accent-bar{height:3px;background:linear-gradient(90deg,var(--brand-secondary),var(--brand-primary));opacity:.55;}
        .main-content{flex:1;max-width:1120px;margin:0 auto;padding:56px 32px 64px;width:100%;}
        .footer{background:var(--brand-surface);border-top:1px solid var(--brand-surface-border);color:#8c8d97;font-size:.875rem;}
        .footer-inner{max-width:1120px;margin:0 auto;padding:20px 32px;}
        .search-hero{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:32px;text-align:center;}
        .search-title{font-size:2.25rem;font-weight:600;color:#30323f;margin:0;}
        .search-intro{color:var(--brand-muted);font-size:1.05rem;line-height:1.7;margin:0 auto;max-width:720px;}
        .reassurance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px;margin-top:8px;}
        .reassurance-card{background:rgba(255,255,255,.9);border-radius:var(--brand-radius-sm);padding:18px 20px;border:1px solid rgba(148,163,184,.35);display:flex;flex-direction:column;gap:6px;box-shadow:0 18px 32px rgba(148,163,184,.14);}
        .reassurance-icon{width:32px;height:32px;border-radius:999px;background:linear-gradient(130deg,var(--brand-secondary),var(--brand-primary));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;align-self:flex-start;}
        .reassurance-title{font-size:.95rem;font-weight:600;color:#374151;}
        .reassurance-copy{font-size:.85rem;color:#64748b;margin:0;line-height:1.5;}
        .confidence-section{max-width:980px;margin:48px auto 0;display:flex;flex-direction:column;gap:16px;text-align:center;}
        .section-title{font-size:1.75rem;font-weight:600;color:#374151;margin:0;}
        .section-title--left{text-align:left;}
        .section-lead{font-size:1rem;color:#4b5563;margin:0 auto;max-width:720px;}
        .branding-section{margin:48px auto 0;max-width:980px;padding:32px;border-radius:var(--brand-radius-lg);background:var(--brand-surface);border:1px solid var(--brand-surface-border);display:grid;gap:24px;text-align:left;}
        .branding-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));}
        .branding-highlight{background:#fff;border-radius:var(--brand-radius-sm);padding:18px;border:1px solid rgba(148,163,184,.25);box-shadow:0 10px 24px rgba(15,23,42,.08);}
        .branding-highlight h3{margin:0 0 8px;font-size:1rem;color:#1f2937;}
        .branding-highlight p{margin:0;font-size:.9rem;color:#475569;line-height:1.5;}
        .branding-actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;}
        .branding-preview{display:flex;align-items:center;gap:18px;padding:18px;border-radius:var(--brand-radius-sm);border:1px solid rgba(148,163,184,.25);background:#fff;}
        .branding-preview-logo{width:52px;height:52px;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(130deg,var(--brand-primary),var(--brand-secondary));color:var(--brand-primary-contrast);font-weight:700;box-shadow:0 10px 20px rgba(15,23,42,.12);}
        .branding-preview-logo img{width:100%;height:100%;object-fit:cover;display:block;}
        .branding-preview-meta{display:flex;flex-direction:column;gap:4px;}
        .branding-tips{margin:0;padding-left:20px;color:#475569;font-size:.9rem;}
        .branding-tips li{margin-bottom:6px;}
        .onboarding-section{max-width:980px;margin:48px auto 0;padding:0 16px;}
        .onboarding-steps{counter-reset:onboarding;list-style:none;padding:0;margin:0;display:grid;gap:16px;}
        .onboarding-steps li{position:relative;padding:18px 20px 18px 54px;border-radius:var(--brand-radius);background:var(--brand-primary-soft);border:1px solid var(--brand-surface-border);}
        .onboarding-steps li::before{counter-increment:onboarding;content:counter(onboarding);position:absolute;left:18px;top:18px;width:28px;height:28px;border-radius:999px;background:var(--brand-primary);color:var(--brand-primary-contrast);display:flex;align-items:center;justify-content:center;font-weight:600;}
        .onboarding-steps strong{display:block;font-size:1rem;color:#1f2937;margin-bottom:6px;}
        .onboarding-steps p{margin:0;color:#475569;font-size:.9rem;line-height:1.55;}
        .onboarding-card{background:#fff;border-radius:var(--brand-radius-lg);padding:24px;border:1px solid rgba(148,163,184,.25);box-shadow:0 16px 32px rgba(15,23,42,.08);}
        .brand-info{display:flex;flex-direction:column;}
        .progress-steps{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;margin:0;padding:0;list-style:none;color:#475569;font-size:.95rem;}
        .progress-step{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:var(--brand-radius-pill);background:#f1f5f9;border:1px solid rgba(148,163,184,.35);font-weight:500;}
        .progress-step.is-active{background:linear-gradient(130deg,var(--brand-secondary),var(--brand-primary));color:#fff;box-shadow:0 12px 22px rgba(15,23,42,.25);}
        .search-form{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end;background:var(--brand-surface);border-radius:var(--brand-radius-lg);padding:32px;border:1px solid var(--brand-surface-border);box-shadow:0 24px 42px rgba(15,23,42,.08);}
        .search-field{display:flex;flex-direction:column;gap:10px;text-align:left;}
        .search-field label{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;font-weight:600;color:#9b9ca6;}
        .search-dates{display:flex;gap:14px;flex-wrap:wrap;}
        .search-input{width:100%;border-radius:var(--brand-radius-sm);border:2px solid var(--brand-surface-border);padding:14px 16px;background:#fff;font-size:1rem;color:#44454f;transition:border-color .2s ease,box-shadow .2s ease;}
        .search-input:focus{border-color:var(--brand-secondary);outline:none;box-shadow:0 0 0 4px var(--brand-surface-ring);}
        .search-submit{display:flex;justify-content:flex-end;}
        .search-button{display:inline-flex;align-items:center;justify-content:center;padding:14px 40px;border-radius:var(--brand-radius-pill);border:none;background:linear-gradient(130deg,var(--brand-primary),var(--brand-secondary));color:var(--brand-primary-contrast);font-weight:700;font-size:1.05rem;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;}
        .search-button:hover{transform:translateY(-1px);box-shadow:0 14px 26px rgba(15,23,42,.18);}
        .search-button[disabled]{opacity:.6;cursor:not-allowed;box-shadow:none;transform:none;}
        .search-button[data-loading="true"]{position:relative;color:transparent;}
        .search-button[data-loading="true"]::after{content:'A procurar...';color:var(--brand-primary-contrast);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
        .search-button[data-loading="true"]::before{content:'';position:absolute;left:18px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:999px;border:2px solid rgba(255,255,255,.35);border-top-color:var(--brand-primary-contrast);animation:spin .8s linear infinite;}
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
        .calendar-card[data-loading="true"]::before{content:'';position:absolute;top:50%;left:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:999px;border:3px solid rgba(15,23,42,.25);border-top-color:var(--brand-primary);animation:spin .9s linear infinite;}
        .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;touch-action:pan-y;}
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
        @media (max-width:680px){.topbar-inner{padding:18px 20px 10px;}.nav-links{gap:18px;}.nav-actions{width:100%;justify-content:flex-end;}.main-content{padding:40px 20px 56px;}.search-form{grid-template-columns:1fr;padding:28px;}.search-dates{flex-direction:column;}.search-submit{justify-content:stretch;}.search-button{width:100%;}.progress-step{width:100%;justify-content:center;}.branding-section{padding:28px;}.confidence-section{gap:12px;}}
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
        .responsive-table{overflow:hidden;}
        .responsive-table table{width:100%;border-collapse:collapse;min-width:0;}
        .responsive-table thead th{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;padding:.65rem .9rem;border-bottom:1px solid rgba(148,163,184,.4);background:rgba(248,250,252,.7);}
        .responsive-table tbody tr{border-top:1px solid rgba(148,163,184,.35);}
        .responsive-table tbody tr:first-child{border-top:none;}
        .responsive-table td{padding:.7rem .9rem;vertical-align:top;font-size:.9rem;color:#1f2937;line-height:1.45;word-break:break-word;}
        .responsive-table td .table-cell-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;}
        .responsive-table td .table-cell-actions form{margin:0;}
        .responsive-table td .table-cell-value{display:block;color:inherit;}
        .responsive-table td .table-cell-muted{color:#64748b;font-size:.8rem;display:block;margin-top:.1rem;}
        @media (max-width:1024px){
          .responsive-table{padding:0;}
          .responsive-table table,
          .responsive-table thead,
          .responsive-table tbody,
          .responsive-table th,
          .responsive-table td,
          .responsive-table tr{display:block;width:100%;}
          .responsive-table thead{display:none;}
          .responsive-table tbody{display:grid;gap:12px;margin:0;padding:16px;}
          .responsive-table tbody tr{border:1px solid var(--brand-surface-border);border-radius:var(--brand-radius);padding:16px;background:#fff;box-shadow:0 10px 22px rgba(15,23,42,.05);}
          .responsive-table td{border:none;padding:8px 0;display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,2fr);gap:12px;align-items:start;}
          .responsive-table td::before{content:attr(data-label);font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.08em;font-size:.7rem;}
          .responsive-table td .table-cell-actions{justify-content:flex-start;}
          .responsive-table td .table-cell-actions form{width:auto;}
          .responsive-table td:last-child{padding-bottom:0;}
        }
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
            <a href="${esc(brandHomeHref)}" class="brand" aria-label="${esc(theme.brandName)}">
              <span class="${brandLogoClass}">${brandLogoContent}</span>
              <span class="brand-info">
                <span class="brand-name">${esc(theme.brandName)}</span>
                ${brandTagline}
              </span>
            </a>
            <nav class="nav-links">
              ${!isHousekeepingOnly ? `<a class="${navClass('search')}" href="/search">Pesquisar</a>` : ''}
              ${can('calendar.view') ? `<a class="${navClass('calendar')}" href="/calendar">Mapa de reservas</a>` : ``}
              ${can('housekeeping.view') ? `<a class="${navClass('housekeeping')}" href="/limpeza/tarefas">Limpezas</a>` : ``}
              ${canAccessBackoffice && can('dashboard.view') ? `<a class="${navClass('backoffice')}" href="/admin">Backoffice</a>` : ``}
              ${canAccessBackoffice && can('bookings.view') ? `<a class="${navClass('bookings')}" href="/admin/bookings">Reservas</a>` : ``}
              ${canAccessBackoffice && (can('audit.view') || can('logs.view')) ? `<a class="${navClass('audit')}" href="/admin/auditoria">Auditoria</a>` : ``}
              ${canAccessBackoffice && can('users.manage') ? `<a class="${navClass('branding')}" href="/admin/identidade-visual">Identidade</a>` : ''}
              ${canAccessBackoffice && can('users.manage') ? `<a class="${navClass('users')}" href="/admin/utilizadores">Utilizadores</a>` : ''}
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
          <div class="footer-inner">(c) ${new Date().getFullYear()} ${esc(theme.brandName)} · Plataforma demo</div>
        </footer>
      </div>
    </body>
  </html>`;
}

// ===================== Front Office =====================
// ===================== Module registration =====================
const context = {
  db,
  dayjs,
  html,
  layout,
  esc,
  eur,
  bcrypt,
  crypto,
  fs,
  fsp,
  path,
  sharp,
  upload,
  uploadBrandingAsset,
  paths,
  ExcelJS,
  brandingStore,
  normalizeRole,
  buildUserContext,
  userCan,
  logSessionEvent,
  logActivity,
  logChange,
  readAutomationState,
  writeAutomationState,
  automationSeverityStyle,
  formatDateRangeShort,
  formatMonthYear,
  safeJsonParse,
  isoWeekStart,
  runAutomationSweep,
  ensureAutomationFresh,
  parseOperationalFilters,
  computeOperationalDashboard,
  ensureDir,
  normalizeHexColor,
  hexToRgb,
  rgbToHex,
  mixColors,
  contrastColor,
  sanitizeBrandingTheme,
  sanitizeSavedTheme,
  sanitizeBrandingStore,
  capitalizeMonth,
  deriveInitials,
  computeBrandingTheme,
  computeBranding,
  getBranding,
  persistBrandingStore,
  listBrandingThemes,
  isBrandingLogoInUse,
  cloneBrandingStoreState,
  extractBrandingSubmission,
  parsePropertyId,
  rememberActiveBrandingProperty,
  isSafeRedirectTarget,
  resolveBrandingForRequest,
  wantsJson,
  formatAuditValue,
  renderAuditDiff,
  formatJsonSnippet,
  parseFeaturesInput,
  normalizeFeature,
  parseFeaturesStored,
  featuresToTextarea,
  featureChipsHtml,
  titleizeWords,
  deriveUnitType,
  dateRangeNights,
  createSession,
  getSession,
  destroySession,
  requireLogin,
  userHasBackofficeAccess,
  requireBackofficeAccess,
  requirePermission,
  requireAnyPermission,
  requireAdmin,
  overlaps,
  unitAvailable,
  rateQuote,
  compressImage,
  removeBrandingLogo,
  selectPropertyById,
  insertBlockStmt,
  adminBookingUpdateStmt,
  rescheduleBookingUpdateStmt,
  rescheduleBlockUpdateStmt,
  automationCache,
  AUTO_CHAIN_THRESHOLD,
  AUTO_CHAIN_CLEANUP_NIGHTS,
  HOT_DEMAND_THRESHOLD,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  MASTER_ROLE,
  FEATURE_ICON_KEYS,
  UNIT_TYPE_ICON_HINTS,
  slugify
};

registerAuthRoutes(app, context);
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
