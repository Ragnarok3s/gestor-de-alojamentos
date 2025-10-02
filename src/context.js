const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
require('dayjs/locale/pt');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ExcelJS = require('exceljs');

dayjs.extend(minMax);
dayjs.locale('pt');

function createContext() {
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
`;
  db.exec(schema);

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
  } catch (e) {}

  const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (usersCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run('admin', hash, 'admin');
    console.log('Admin default: admin / admin123 (muda em /admin/utilizadores).');
  }

  const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
  const UPLOAD_UNITS = path.join(UPLOAD_ROOT, 'units');

  function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

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

  const html = String.raw;
  const eur = (c) => (c / 100).toFixed(2);
  const capitalizeMonth = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  const esc = (str = '') => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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
  };
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
    if (!dayjs().isBefore(dayjs(row.expires_at))) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return row;
  }

  function destroySession(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  function requireLogin(req, res, next) {
    const sess = getSession(req.cookies.adm);
    if (!sess) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    req.user = { id: sess.user_id, username: sess.username, role: sess.role };
    next();
  }

  function requireAdmin(req, res, next) {
    const sess = getSession(req.cookies.adm);
    if (!sess) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (sess.role !== 'admin') return res.status(403).send('Sem permissão');
    req.user = { id: sess.user_id, username: sess.username, role: sess.role };
    next();
  }

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

  function isWeekendDate(d) {
    const dow = dayjs(d).day();
    return dow === 0 || dow === 6;
  }

  function rateQuote(unit_id, checkin, checkout, base_price_cents) {
    const nights = dateRangeNights(checkin, checkout);
    const rows = db.prepare('SELECT * FROM rates WHERE unit_id = ?').all(unit_id);
    let total = 0; let minStayReq = 1;
    nights.forEach(d => {
      const r = rows.find(x => !dayjs(d).isBefore(x.start_date) && dayjs(d).isBefore(x.end_date));
      if (r) {
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

  function layout({ title = 'Booking Engine', body, user, activeNav = '' }) {
    const hasUser = !!user;
    const isManager = !!(user && (user.role === 'admin' || user.role === 'gestor'));
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
      <style>
        .input { box-sizing:border-box; width:100%; min-width:0; display:block; padding:.5rem .75rem; border-radius:.5rem; border:1px solid #cbd5e1; background:#fff; line-height:1.25rem; }
        .btn  { display:inline-block; padding:.5rem .75rem; border-radius:.5rem; }
        .btn-primary{ background:#0f172a; color:#fff; }
        .btn-muted{ background:#e2e8f0; }
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
        .search-form{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end;background:#f7f6f9;border-radius:28px;padding:32px;border:1px solid rgba(255,166,67,.4);box-shadow:0 24px 42px rgba(15,23,42,.08);}
        .search-field{display:flex;flex-direction:column;gap:10px;text-align:left;}
        .search-field label{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;font-weight:600;color:#9b9ca6;}
        .search-dates{display:flex;gap:14px;flex-wrap:wrap;}
        .search-input{width:100%;border-radius:16px;border:2px solid rgba(255,166,67,.6);padding:14px 16px;background:#fff;font-size:1rem;color:#44454f;transition:border-color .2s ease,box-shadow .2s ease;}
        .search-input:focus{border-color:#ff8c00;outline:none;box-shadow:0 0 0 4px rgba(255,166,67,.2);}
        .search-submit{display:flex;justify-content:flex-end;}
        .search-button{display:inline-flex;align-items:center;justify-content:center;padding:14px 40px;border-radius:999px;border:none;background:linear-gradient(130deg,#ffb347,#ff6b00);color:#fff;font-weight:700;font-size:1.05rem;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;}
        .search-button:hover{transform:translateY(-1px);box-shadow:0 14px 26px rgba(255,107,0,.25);}
        @media (max-width:900px){.topbar-inner{padding:20px 24px 10px;gap:18px;}.nav-link.active::after{bottom:-10px;}.main-content{padding:48px 24px 56px;}.search-form{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));}}
        @media (max-width:680px){.topbar-inner{padding:18px 20px 10px;}.nav-links{gap:18px;}.nav-actions{width:100%;justify-content:flex-end;}.main-content{padding:40px 20px 56px;}.search-form{grid-template-columns:1fr;padding:28px;}.search-dates{flex-direction:column;}.search-submit{justify-content:stretch;}.search-button{width:100%;}}
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
              ${isManager ? `<a class="${navClass('calendar')}" href="/calendar">Mapa de reservas</a>` : ``}
              ${isManager ? `<a class="${navClass('backoffice')}" href="/admin">Backoffice</a>` : ``}
              ${isManager ? `<a class="${navClass('bookings')}" href="/admin/bookings">Reservas</a>` : ``}
              ${user && user.role === 'admin' ? `<a class="${navClass('users')}" href="/admin/utilizadores">Utilizadores</a>` : ''}
            </nav>
            <div class="nav-actions">
              ${user
                ? `<form method="post" action="/logout" class="logout-form">
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

  return {
    db,
    dayjs,
    html,
    eur,
    esc,
    parseFeaturesInput,
    parseFeaturesStored,
    featuresToTextarea,
    featureChipsHtml,
    formatMonthYear,
    dateRangeNights,
    createSession,
    getSession,
    destroySession,
    requireLogin,
    requireAdmin,
    overlaps,
    unitAvailable,
    rateQuote,
    layout,
    upload,
    paths: { UPLOAD_ROOT, UPLOAD_UNITS },
    ExcelJS,
    FEATURE_ICONS,
    FEATURE_ICON_KEYS
  };
}

module.exports = { createContext };
