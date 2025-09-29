/**
 * Booking Engine - Front + Backoffice + Auth + Mapa (mensal)
 * Node.js (Express) + better-sqlite3 + bcryptjs + dayjs + Tailwind (CDN)
 * Uploads (multer) + galeria + exportação Excel do calendário + Booking Management + Audit Log
 */

const express = require('express');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
require('dayjs/locale/pt');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const path = require('path');
const ExcelJS = require('exceljs');
dayjs.extend(minMax);
dayjs.locale('pt');

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  internal_notes TEXT
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
`;
db.exec(schema);

// === AUDIT TABLE ===
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,              -- CREATE|UPDATE|DELETE|CANCEL|LOGIN|LOGOUT|UPLOAD
    entity TEXT NOT NULL,              -- booking|unit|rate|block|property|user|image|session
    entity_id INTEGER,
    before_json TEXT,
    after_json  TEXT,
    meta_json   TEXT,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
`);

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
} catch (_) {}

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
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run('admin', hash, 'admin');
  console.log('Admin default: admin / admin123 (muda em /admin/utilizadores).');
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

// ===================== Utils =====================
const html = String.raw;
const eur = (c) => (c / 100).toFixed(2);
const capitalizeMonth = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
const esc = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// === Audit helpers ===
function toJsonSafe(obj) {
  try { return obj ? JSON.stringify(obj) : null; } catch { return null; }
}
function sanitizeEntitySnapshot(entity, row) {
  if (!row) return row;
  if (entity === 'user') {
    const { password_hash, ...safe } = row;
    return safe;
  }
  return row;
}
function auditLog({ req, action, entity, entity_id = null, before = null, after = null, meta = null }) {
  const user = req?.user || null;
  const ip = (req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').toString().slice(0,255);
  const ua = (req?.headers?.['user-agent'] || '').toString().slice(0,255);
  const before_s = toJsonSafe(sanitizeEntitySnapshot(entity, before));
  const after_s  = toJsonSafe(sanitizeEntitySnapshot(entity, after));
  const meta_s   = toJsonSafe(meta || { route: req?.originalUrl });

  db.prepare(`
    INSERT INTO audit_logs(user_id, action, entity, entity_id, before_json, after_json, meta_json, ip, user_agent)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(user ? user.id : null, action, entity, entity_id, before_s, after_s, meta_s, ip, ua);
}
function withAudit({ req, entity, id, action, selectSql, mutate }) {
  const before = selectSql ? db.prepare(selectSql).get(id) : null;
  const result = mutate();
  const after  = selectSql ? db.prepare(selectSql).get(id) : null;
  auditLog({ req, action, entity, entity_id:id, before, after });
  return result;
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
  req.user = { id: sess.user_id, username: sess.username, role: sess.role };
  next();
}
function requireAdmin(req,res,next){
  const sess = getSession(req.cookies.adm);
  if (!sess) return res.redirect('/login?next='+encodeURIComponent(req.originalUrl));
  if (sess.role !== 'admin') return res.status(403).send('Sem permissão');
  req.user = { id: sess.user_id, username: sess.username, role: sess.role };
  next();
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
      <style>/* ... estilos (iguais ao teu) ... */</style>
      <script>/* ... scripts galeria + helpers (iguais ao teu) ... */</script>
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
              ${hasUser ? `<a class="${navClass('calendar')}" href="/calendar">Mapa de reservas</a>` : ``}
              <a class="${navClass('backoffice')}" href="/admin">Backoffice</a>
              ${hasUser ? `<a class="${navClass('bookings')}" href="/admin/bookings">Reservas</a>` : ``}
              ${user && user.role === 'admin' ? `<a class="${navClass('users')}" href="/admin/utilizadores">Utilizadores</a>` : ''}
              ${user && user.role === 'admin' ? `<a class="${navClass('audit')}" href="/admin/audit">Audit Log</a>` : ''}
              ${hasUser ? `<a class="${navClass('export')}" href="/admin/export">Exportar Excel</a>` : ``}
            </nav>
            <div class="nav-actions">
              ${user
                ? `<form method="post" action="/logout" class="logout-form">
                     <button type="submit">Log-out</button>
                   </form>`
                : `<a class="login-link" href="/login">Iniciar sessão</a>`}
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
  const token = createSession(u.id);
  const secure = !!process.env.FORCE_SECURE_COOKIE || (!!process.env.SSL_KEY_PATH && !!process.env.SSL_CERT_PATH);
  res.cookie('adm', token, { httpOnly: true, sameSite: 'lax', secure });
  // AUDIT: login
  auditLog({ req, action:'LOGIN', entity:'session', entity_id:null, before:null, after:null, meta:{ username } });
  res.redirect(nxt || '/admin');
});
app.post('/logout', (req,res)=>{
  // AUDIT: logout (antes de destruir sessão)
  auditLog({ req, action:'LOGOUT', entity:'session', entity_id:null, before:null, after:null });
  destroySession(req.cookies.adm);
  res.clearCookie('adm');
  res.redirect('/');
});

// ===================== Front Office =====================
// (página /, /search — tal como o teu, sem alterações de auditoria)

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
    // AUDIT: create booking (snapshot after)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    auditLog({ req, action:'CREATE', entity:'booking', entity_id:id, before:null, after:booking, meta:{ route:'/book' } });
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
    body: `
      <div class="card p-6">
        <h1 class="text-2xl font-semibold mb-2">Reserva confirmada</h1>
        <p class="text-slate-600 mb-6">Obrigado, ${b.guest_name}. Enviámos um email de confirmação para ${b.guest_email} (mock).</p>
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
        <div class="mt-6"><a class="btn btn-primary" href="/">Nova pesquisa</a></div>
      </div>
    `
  }));
});

// ===================== Calendário (privado) =====================
app.get('/calendar', requireLogin, (req, res) => {
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

  res.send(layout({
    title: 'Mapa de Reservas',
    user: req.user,
    activeNav: 'calendar',
    body: `
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
        <a class="btn btn-primary ml-auto" href="/admin/export">Exportar Excel</a>
      </div>
      <div class="space-y-6">
        ${units.map(u => unitCalendarCard(u, month)).join('')}
      </div>
    `
  }));
});

function unitCalendarCard(u, month) {
  const monthStart = month.startOf('month');
  const daysInMonth = month.daysInMonth();
  const weekdayOfFirst = (monthStart.day() + 6) % 7;
  const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

  const entries = db.prepare(
    `SELECT 'B' as t, checkin as s, checkout as e, (guest_name || ' (' || adults || 'A+' || children || 'C)') as label, status
       FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
     UNION ALL
     SELECT 'X' as t, start_date as s, end_date as e, 'BLOQUEADO' as label, 'BLOCK' as status
       FROM blocks WHERE unit_id = ?`
  ).all(u.id, u.id);

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayIndexInMonth = i - weekdayOfFirst + 1;
    const inMonth = dayIndexInMonth >= 1 && dayIndexInMonth <= daysInMonth;
    const d = inMonth
      ? monthStart.date(dayIndexInMonth)
      : (i < weekdayOfFirst
          ? monthStart.subtract(weekdayOfFirst - i, 'day')
          : monthStart.add(dayIndexInMonth - daysInMonth, 'day'));

    const date = d.format('YYYY-MM-DD');
    const nextDate = d.add(1, 'day').format('YYYY-MM-DD');

    const hit = entries.find(en => overlaps(en.s, en.e, date, nextDate));
    let cls = !inMonth ? 'bg-slate-100 text-slate-400' : 'bg-emerald-500 text-white'; // livre
    if (hit) {
      if (hit.status === 'BLOCK') cls = 'bg-red-600 text-white';
      else if (hit.status === 'PENDING') cls = 'bg-amber-400 text-black';
      else cls = 'bg-rose-500 text-white'; // CONFIRMED
    }

    const title = hit ? ` title="${(hit.label || '').replace(/"/g, "'")}"` : '';
    cells.push(`<div class="h-12 sm:h-14 flex items-center justify-center rounded ${cls} text-xs sm:text-sm"${title}>${d.date()}</div>`);
  }

  const weekdayHeader = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']
    .map(w => `<div class="text-center text-xs text-slate-500 py-1">${w}</div>`)
    .join('');
  return `
    <div class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <div>
          <div class="text-sm text-slate-500">${u.property_name}</div>
          <h3 class="text-lg font-semibold">${u.name}</h3>
        </div>
        <a class="text-slate-600 hover:text-slate-900" href="/admin/units/${u.id}">Gerir</a>
      </div>
      <div class="grid grid-cols-7 gap-1 mb-1">${weekdayHeader}</div>
      <div class="grid grid-cols-7 gap-1">${cells.join('')}</div>
    </div>
  `;
}

// ===================== Export Excel (privado) =====================
app.get('/admin/export', requireLogin, (req,res)=>{
  const ymDefault = dayjs().format('YYYY-MM');
  res.send(layout({
    title: 'Exportar Mapa (Excel)',
    user: req.user,
    activeNav: 'export',
    body: `
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

// Excel estilo Gantt + tabela de detalhes (com auditoria do download)
app.get('/admin/export/download', requireLogin, async (req, res) => {
  const ym = String(req.query.ym || '').trim();
  const months = Math.min(12, Math.max(1, Number(req.query.months || 1)));
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).send('Parâmetro ym inválido (YYYY-MM)');
  const start = dayjs(ym + '-01');
  if (!start.isValid()) return res.status(400).send('Data inválida.');

  // AUDIT: export
  auditLog({ req, action:'EXPORT', entity:'excel', entity_id:null, meta:{ ym, months } });

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
      'Ref','Nome','Agência','País','Nr Hóspedes','Nr Noites','Data entrada','Data saída','Tlm','Email',
      'Nr Quartos','Hora Check-in','Outras Informações','Valor total a pagar','Pré-pagamento 30%','A pagar no check-out',
      'Fatura','Data Pré-Pagamento','Dados pagamento','Dados faturação'
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
    const defaultDetailWidths = [6,24,14,8,12,10,12,12,14,30,10,12,24,16,16,16,10,16,22,22];
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
        } else if ([5,6,11].includes(colNumber)) {
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

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ===================== Backoffice (protegido) =====================
app.get('/admin', requireLogin, (req, res) => {
  const props = db.prepare('SELECT * FROM properties ORDER BY name').all();
  const units = db.prepare(
    `SELECT u.*, p.name as property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.name`
  ).all();
  const recentBookings = db.prepare(
    `SELECT b.*, u.name as unit_name, p.name as property_name
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
       JOIN properties p ON p.id = u.property_id
      ORDER BY b.created_at DESC
      LIMIT 10`
  ).all();

  res.send(layout({
    title: 'Backoffice',
    user: req.user,
    activeNav: 'backoffice',
    body: `
      <h1 class="text-2xl font-semibold mb-6">Backoffice</h1>

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

app.post('/admin/properties/create', requireLogin, (req, res) => {
  const { name, location, description } = req.body;
  const r = db.prepare('INSERT INTO properties(name, location, description) VALUES (?, ?, ?)').run(name, location, description);
  auditLog({ req, action:'CREATE', entity:'property', entity_id:r.lastInsertRowid, before:null, after:{ id:r.lastInsertRowid, name, location, description } });
  res.redirect('/admin');
});

app.post('/admin/properties/:id/delete', requireLogin, (req, res) => {
  const id = req.params.id;
  const before = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  if (!before) return res.status(404).send('Propriedade não encontrada');
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  auditLog({ req, action:'DELETE', entity:'property', entity_id:id, before, after:null });
  res.redirect('/admin');
});

app.get('/admin/properties/:id', requireLogin, (req, res) => {
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
    body: `
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

app.post('/admin/units/create', requireLogin, (req, res) => {
  let { property_id, name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
  const features = parseFeaturesInput(features_raw);
  const r = db.prepare('INSERT INTO units(property_id, name, capacity, base_price_cents, features) VALUES (?, ?, ?, ?, ?)')
    .run(property_id, name, Number(capacity), cents, JSON.stringify(features));
  auditLog({ req, action:'CREATE', entity:'unit', entity_id:r.lastInsertRowid, before:null, after:{ id:r.lastInsertRowid, property_id, name, capacity:Number(capacity), base_price_cents:cents, features } });
  res.redirect('/admin');
});

app.get('/admin/units/:id', requireLogin, (req, res) => {
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
  const images = db.prepare('SELECT * FROM unit_images WHERE unit_id = ? ORDER BY position, id').all(u.id);

  res.send(layout({
    title: `${esc(u.property_name)} – ${esc(u.name)}`,
    user: req.user,
    activeNav: 'backoffice',
    body: `
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
            <button class="btn btn-primary">Carregar imagens</button>
          </form>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            ${images.map(img => `
              <div class="relative border rounded overflow-hidden">
                <img src="/uploads/units/${u.id}/${img.file}" alt="${esc(img.alt||'')}" class="w-full h-32 object-cover"/>
                <form method="post" action="/admin/images/${img.id}/delete" onsubmit="return confirm('Remover imagem?');" class="absolute top-1 right-1">
                  <button class="bg-rose-600 text-white text-xs px-2 py-1 rounded">X</button>
                </form>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    `
  }));
});

app.post('/admin/units/:id/update', requireLogin, (req, res) => {
  const id = req.params.id;
  const before = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!before) return res.status(404).send('Unidade não encontrada');
  const { name, capacity, base_price_eur, features_raw } = req.body;
  const cents = Math.round(parseFloat(String(base_price_eur||'0').replace(',', '.'))*100);
  const features = parseFeaturesInput(features_raw);
  db.prepare('UPDATE units SET name = ?, capacity = ?, base_price_cents = ?, features = ? WHERE id = ?')
    .run(name, Number(capacity), cents, JSON.stringify(features), id);
  const after = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  auditLog({ req, action:'UPDATE', entity:'unit', entity_id:id, before, after });
  res.redirect(`/admin/units/${id}`);
});

app.post('/admin/units/:id/delete', requireLogin, (req, res) => {
  const id = req.params.id;
  const before = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!before) return res.status(404).send('Unidade não encontrada');
  db.prepare('DELETE FROM units WHERE id = ?').run(id);
  auditLog({ req, action:'DELETE', entity:'unit', entity_id:id, before, after:null });
  res.redirect('/admin');
});

app.post('/admin/units/:id/block', requireLogin, (req, res) => {
  const { start_date, end_date } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');

  const conflicts = db.prepare(
    `SELECT 1 FROM bookings WHERE unit_id = ? AND status IN ('CONFIRMED','PENDING')
      AND NOT (checkout <= ? OR checkin >= ?)`
  ).all(req.params.id, start_date, end_date);
  if (conflicts.length)
    return res.status(409).send('As datas incluem reservas existentes');

  const r = db.prepare('INSERT INTO blocks(unit_id, start_date, end_date) VALUES (?, ?, ?)').run(req.params.id, start_date, end_date);
  auditLog({ req, action:'CREATE', entity:'block', entity_id:r.lastInsertRowid, before:null, after:{ id:r.lastInsertRowid, unit_id:Number(req.params.id), start_date, end_date } });
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/blocks/:blockId/delete', requireLogin, (req, res) => {
  const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(req.params.blockId);
  if (!block) return res.status(404).send('Bloqueio não encontrado');
  db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.blockId);
  auditLog({ req, action:'DELETE', entity:'block', entity_id:block.id, before:block, after:null });
  res.redirect(`/admin/units/${block.unit_id}`);
});

app.post('/admin/units/:id/rates/create', requireLogin, (req, res) => {
  const { start_date, end_date, price_eur, min_stay } = req.body;
  if (!dayjs(end_date).isAfter(dayjs(start_date)))
    return res.status(400).send('end_date deve ser > start_date');
  const price_cents = Math.round(parseFloat(String(price_eur || '0').replace(',', '.')) * 100);
  if (!(price_cents >= 0)) return res.status(400).send('Preço inválido');
  const r = db.prepare(
    'INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)'
  ).run(req.params.id, start_date, end_date, price_cents, price_cents, min_stay ? Number(min_stay) : 1);
  auditLog({ req, action:'CREATE', entity:'rate', entity_id:r.lastInsertRowid, before:null, after:{ id:r.lastInsertRowid, unit_id:Number(req.params.id), start_date, end_date, price_cents, min_stay:min_stay?Number(min_stay):1 } });
  res.redirect(`/admin/units/${req.params.id}`);
});

app.post('/admin/rates/:rateId/delete', requireLogin, (req, res) => {
  const r = db.prepare('SELECT * FROM rates WHERE id = ?').get(req.params.rateId);
  if (!r) return res.status(404).send('Rate não encontrada');
  db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.rateId);
  auditLog({ req, action:'DELETE', entity:'rate', entity_id:r.id, before:r, after:null });
  res.redirect(`/admin/units/${r.unit_id}`);
});

// Imagens
app.post('/admin/units/:id/images', requireLogin, upload.array('images', 12), (req,res)=>{
  const unitId = req.params.id;
  const files = req.files || [];
  const insert = db.prepare('INSERT INTO unit_images(unit_id,file,alt,position) VALUES (?,?,?,?)');
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) as p FROM unit_images WHERE unit_id = ?').get(unitId).p;
  const created = [];
  files.forEach(f => {
    const r = insert.run(unitId, f.filename, null, ++pos);
    created.push({ id:r.lastInsertRowid, unit_id:Number(unitId), file:f.filename, position:pos });
  });
  auditLog({ req, action:'UPLOAD', entity:'image', entity_id:null, before:null, after:created, meta:{ count:files.length, unit_id:Number(unitId) } });
  res.redirect(`/admin/units/${unitId}`);
});

app.post('/admin/images/:imageId/delete', requireLogin, (req,res)=>{
  const img = db.prepare('SELECT * FROM unit_images WHERE id = ?').get(req.params.imageId);
  if (!img) return res.status(404).send('Imagem não encontrada');
  const filePath = path.join(UPLOAD_UNITS, String(img.unit_id), img.file);
  db.prepare('DELETE FROM unit_images WHERE id = ?').run(img.id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  auditLog({ req, action:'DELETE', entity:'image', entity_id:img.id, before:img, after:null });
  res.redirect(`/admin/units/${img.unit_id}`);
});

// ===================== Booking Management (Admin) =====================
app.get('/admin/bookings', requireLogin, (req, res) => {
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
    body: `
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
                  <a class="underline" href="/admin/bookings/${b.id}">Editar</a>
                  <form method="post" action="/admin/bookings/${b.id}/cancel" style="display:inline" onsubmit="return confirm('Cancelar esta reserva?');">
                    <button class="text-rose-600 ml-2">Cancelar</button>
                  </form>
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

app.get('/admin/bookings/:id', requireLogin, (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as unit_name, u.capacity, u.base_price_cents, p.name as property_name
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = u.property_id
     WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  res.send(layout({
    title: `Editar reserva #${b.id}`,
    user: req.user,
    activeNav: 'bookings',
    body: `
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

        <form method="post" action="/admin/bookings/${b.id}/update" class="grid gap-3">
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
            <label class="text-sm">Anotacoes internas</label>
            <textarea class="input" name="internal_notes" rows="4" placeholder="Notas internas (apenas equipa)">${esc(b.internal_notes || '')}</textarea>
            <p class="text-xs text-slate-500">Nao aparece para o hospede.</p>
          </div>

          <div>
            <label class="text-sm">Estado</label>
            <select name="status" class="input">
              <option value="CONFIRMED" ${b.status==='CONFIRMED'?'selected':''}>CONFIRMED</option>
              <option value="PENDING" ${b.status==='PENDING'?'selected':''}>PENDING</option>
            </select>
          </div>

          <div class="flex items-center gap-3">
            <button class="btn btn-primary">Guardar alterações</button>
            <form method="post" action="/admin/bookings/${b.id}/cancel" onsubmit="return confirm('Cancelar esta reserva?');">
              <button class="btn" style="background:#e11d48;color:#fff;">Cancelar</button>
            </form>
          </div>
        </form>
      </div>
    `
  }));
});

app.post('/admin/bookings/:id/update', requireLogin, (req, res) => {
  const id = req.params.id;
  const b = db.prepare(`
    SELECT b.*, u.capacity, u.base_price_cents
      FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.id = ?
  `).get(id);
  if (!b) return res.status(404).send('Reserva não encontrada');

  const before = { ...b };

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

  db.prepare(`
    UPDATE bookings
       SET checkin = ?, checkout = ?, adults = ?, children = ?, guest_name = ?, guest_email = ?, guest_phone = ?, guest_nationality = ?, agency = ?, internal_notes = ?, status = ?, total_cents = ?
     WHERE id = ?
  `).run(checkin, checkout, adults, children, guest_name, guest_email, guest_phone, guest_nationality, agency, internal_notes, status, q.total_cents, id);

  const after = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  auditLog({ req, action:'UPDATE', entity:'booking', entity_id:id, before, after });
  res.redirect(`/admin/bookings/${id}`);
});

app.post('/admin/bookings/:id/cancel', requireLogin, (req, res) => {
  const id = req.params.id;
  const before = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!before) return res.status(404).send('Reserva não encontrada');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  auditLog({ req, action:'CANCEL', entity:'booking', entity_id:id, before, after:null });
  const back = req.get('referer') || '/admin/bookings';
  res.redirect(back);
});

// (Opcional) Apagar definitivamente por ADMIN
app.post('/admin/bookings/:id/delete', requireAdmin, (req, res) => {
  const id = req.params.id;
  const before = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
});