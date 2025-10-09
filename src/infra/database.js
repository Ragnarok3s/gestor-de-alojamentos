const Database = require('better-sqlite3');

function createDatabase(databasePath = 'booking_engine.db') {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applySchema(db);
  runLightMigrations(db);
  warnMissingAuditColumns(db);

  return db;
}

function applySchema(db) {
  const schema = `
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  locality TEXT,
  district TEXT,
  address TEXT,
  description TEXT,
  latitude REAL,
  longitude REAL
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 2,
  base_price_cents INTEGER NOT NULL DEFAULT 10000,
  features TEXT,
  description TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  UNIQUE(property_id, name)
);

CREATE TABLE IF NOT EXISTS channel_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_key TEXT NOT NULL,
  source TEXT NOT NULL,
  file_name TEXT,
  original_name TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  summary_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
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
  confirmation_token TEXT,
  source_channel TEXT,
  import_batch_id INTEGER REFERENCES channel_import_batches(id) ON DELETE SET NULL,
  import_source TEXT,
  imported_at TEXT,
  source_payload TEXT,
  import_notes TEXT,
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

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channel_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_key TEXT UNIQUE NOT NULL,
  channel_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT,
  credentials_json TEXT,
  last_synced_at TEXT,
  last_status TEXT,
  last_error TEXT,
  last_summary_json TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
}

function runLightMigrations(db) {
  const listColumns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

  const ensureColumn = (table, name, def) => {
    const cols = listColumns(table);
    if (!cols.includes(name)) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
    }
  };

  const ensureTimestampColumn = (table, name) => {
    const cols = listColumns(table);
    if (cols.includes(name)) return;
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`).run();
    try {
      db.prepare(
        `UPDATE ${table} SET ${name} = datetime('now') WHERE ${name} IS NULL OR ${name} = ''`
      ).run();
    } catch (err) {
      console.warn(`Falha ao normalizar ${table}.${name}:`, err.message);
    }
  };

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
    ensureColumn('bookings', 'confirmation_token', 'TEXT');
    ensureColumn('blocks', 'updated_at', 'TEXT');
    ensureColumn('unit_images', 'is_primary', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('properties', 'locality', 'TEXT');
    ensureColumn('properties', 'district', 'TEXT');
    ensureColumn('properties', 'address', 'TEXT');
    ensureColumn('properties', 'latitude', 'REAL');
    ensureColumn('properties', 'longitude', 'REAL');
    ensureColumn('units', 'address', 'TEXT');
    ensureColumn('units', 'latitude', 'REAL');
    ensureColumn('units', 'longitude', 'REAL');
    ensureColumn('sessions', 'token_hash', 'TEXT');
    ensureColumn('sessions', 'ip', 'TEXT');
    ensureColumn('sessions', 'user_agent', 'TEXT');
    ensureTimestampColumn('sessions', 'created_at');
    ensureTimestampColumn('sessions', 'last_seen_at');
    ensureColumn('email_templates', 'description', 'TEXT');
    ensureColumn('email_templates', 'metadata_json', 'TEXT');
    ensureTimestampColumn('email_templates', 'updated_at');
    ensureColumn('email_templates', 'updated_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    ensureColumn('bookings', 'source_channel', 'TEXT');
    ensureColumn('bookings', 'import_batch_id', 'INTEGER REFERENCES channel_import_batches(id) ON DELETE SET NULL');
    ensureColumn('bookings', 'import_source', 'TEXT');
    ensureColumn('bookings', 'imported_at', 'TEXT');
    ensureColumn('bookings', 'source_payload', 'TEXT');
    ensureColumn('bookings', 'import_notes', 'TEXT');
  } catch (err) {
    console.warn('Falha ao executar migrações ligeiras:', err.message);
  }
}

function warnMissingAuditColumns(db) {
  try {
    if (!tableHasColumn(db, 'bookings', 'updated_at')) {
      console.warn('Aviso: bookings.updated_at não existe. Volte a executar as migrações para ativar auditoria completa.');
    }
    if (!tableHasColumn(db, 'blocks', 'updated_at')) {
      console.warn('Aviso: blocks.updated_at não existe. Volte a executar as migrações para ativar auditoria completa.');
    }
  } catch (err) {
    console.warn('Não foi possível validar colunas de auditoria:', err.message);
  }
}

function tableHasColumn(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(row => row.name === column);
}

module.exports = {
  createDatabase,
  tableHasColumn,
};

