const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const dayjs = require('../config/dayjs');

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

function ensureColumn(db, table, name, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
}

function seedDatabase(db) {
  const countProps = db.prepare('SELECT COUNT(*) AS c FROM properties').get().c;
  if (countProps === 0) {
    const insertProperty = db.prepare('INSERT INTO properties(name, location, description) VALUES (?,?,?)');
    const insertUnit = db.prepare(
      'INSERT INTO units(property_id, name, capacity, base_price_cents, description) VALUES (?,?,?,?,?)'
    );
    const pr1 = insertProperty
      .run('Casas de Pousadouro', 'Rio Douro', 'Arquitetura tradicional, interiores contemporâneos')
      .lastInsertRowid;
    const pr2 = insertProperty
      .run('Prazer da Natureza', 'Âncora, Portugal', 'Hotel & SPA perto da praia')
      .lastInsertRowid;
    insertUnit.run(pr1, 'Quarto Duplo', 2, 8500, 'Acolhedor e funcional');
    insertUnit.run(pr1, 'Quarto Familiar', 4, 15500, 'Ideal para famílias');
    insertUnit.run(pr2, 'Suite Vista Jardim', 2, 12000, 'Vista jardim e varanda');
  }

  try {
    const rateCount = db.prepare('SELECT COUNT(*) AS c FROM rates').get().c;
    if (!rateCount) {
      const year = dayjs().year();
      const unitsAll = db.prepare('SELECT id, base_price_cents FROM units').all();
      const insertRate = db.prepare(
        'INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)'
      );
      unitsAll.forEach((unit) => {
        insertRate.run(
          unit.id,
          `${year}-06-01`,
          `${year}-09-01`,
          Math.round(unit.base_price_cents * 1.2),
          Math.round(unit.base_price_cents * 1.2),
          2
        );
        insertRate.run(
          unit.id,
          `${year}-12-20`,
          `${year + 1}-01-05`,
          Math.round(unit.base_price_cents * 1.3),
          Math.round(unit.base_price_cents * 1.3),
          3
        );
      });
    }
  } catch (error) {
    // ignore seed errors
  }

  const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (usersCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run('admin', hash, 'admin');
    console.log('Admin default: admin / admin123 (muda em /admin/utilizadores).');
  }
}

function initializeDatabase() {
  const db = new Database('booking_engine.db');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  try {
    ensureColumn(db, 'bookings', 'guest_nationality', 'TEXT');
    ensureColumn(db, 'bookings', 'guest_phone', 'TEXT');
    ensureColumn(db, 'bookings', 'agency', 'TEXT');
    ensureColumn(db, 'bookings', 'adults', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(db, 'bookings', 'children', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'bookings', 'internal_notes', 'TEXT');
    ensureColumn(db, 'units', 'features', 'TEXT');
    ensureColumn(db, 'bookings', 'external_ref', 'TEXT');
  } catch (error) {
    console.error('Erro ao aplicar migrações leves:', error.message);
  }
  seedDatabase(db);
  return db;
}

module.exports = {
  initializeDatabase,
};
