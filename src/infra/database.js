const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');

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

CREATE TABLE IF NOT EXISTS property_owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(property_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_property_owners_user ON property_owners(user_id);
CREATE INDEX IF NOT EXISTS idx_property_owners_property ON property_owners(property_id);

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

CREATE TABLE IF NOT EXISTS unit_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lock_type TEXT,
  lock_source TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (lock_source IN ('SYSTEM','OTA')),
  lock_owner_booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_unit_blocks_unit ON unit_blocks(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_blocks_dates ON unit_blocks(unit_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_unit_blocks_booking ON unit_blocks(lock_owner_booking_id);

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

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  guest_name TEXT,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  source TEXT,
  stay_date TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  response_text TEXT,
  response_author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_property ON reviews(property_id);
CREATE INDEX IF NOT EXISTS idx_reviews_unit ON reviews(unit_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_two_factor (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  recovery_codes_json TEXT NOT NULL,
  enabled_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  last_verified_at TEXT,
  enforced INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_two_factor_setup (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  recovery_codes_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS two_factor_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  metadata_json TEXT,
  last_attempt_at TEXT,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_two_factor_challenges_user ON two_factor_challenges(user_id);

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
  metadata_json TEXT,
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

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  is_granted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user ON user_permission_overrides(user_id);

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

CREATE TABLE IF NOT EXISTS owner_financial_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL,
  category TEXT,
  description TEXT,
  document_number TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  issue_date TEXT,
  due_date TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_owner_financial_user ON owner_financial_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_owner_financial_property ON owner_financial_entries(property_id);
CREATE INDEX IF NOT EXISTS idx_owner_financial_unit ON owner_financial_entries(unit_id);

CREATE TABLE IF NOT EXISTS owner_push_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT,
  label TEXT,
  last_active TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, token)
);

CREATE TABLE IF NOT EXISTS owner_push_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_json TEXT,
  unique_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT,
  last_attempt_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_owner_push_notifications_user ON owner_push_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_owner_push_notifications_status ON owner_push_notifications(status);
`;

  db.exec(schema);
}

function runLightMigrations(db) {
  const tableExists = (table) => {
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      return !!row;
    } catch (err) {
      console.warn(`Não foi possível validar a existência da tabela ${table}:`, err.message);
      return false;
    }
  };

  const listColumns = (table) => {
    if (!tableExists(table)) return [];
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  };

  const ensureColumn = (table, name, def) => {
    if (!tableExists(table)) return;
    const cols = listColumns(table);
    if (!cols.includes(name)) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
    }
  };

  const ensureTable = (table, ddl) => {
    if (tableExists(table)) return;
    try {
      db.exec(ddl);
    } catch (err) {
      console.warn(`Falha ao criar tabela ${table}:`, err.message);
    }
  };

  const triggerExists = (name) => {
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name);
      return !!row;
    } catch (err) {
      console.warn(`Não foi possível validar o trigger ${name}:`, err.message);
      return false;
    }
  };

  const ensureTrigger = (name, ddl) => {
    if (triggerExists(name)) return;
    try {
      db.exec(ddl);
    } catch (err) {
      console.warn(`Falha ao criar trigger ${name}:`, err.message);
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
    ensureColumn('session_logs', 'metadata_json', 'TEXT');
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

    ensureTable(
      'unit_blocks',
      `CREATE TABLE IF NOT EXISTS unit_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        lock_type TEXT,
        lock_source TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (lock_source IN ('SYSTEM','OTA')),
        lock_owner_booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_unit_blocks_unit ON unit_blocks(unit_id);
      CREATE INDEX IF NOT EXISTS idx_unit_blocks_dates ON unit_blocks(unit_id, start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_unit_blocks_booking ON unit_blocks(lock_owner_booking_id);`
    );

    ensureColumn('unit_blocks', 'lock_type', 'TEXT');
    ensureColumn(
      'unit_blocks',
      'lock_source',
      "TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (lock_source IN ('SYSTEM','OTA'))"
    );
    ensureColumn(
      'unit_blocks',
      'lock_owner_booking_id',
      'INTEGER REFERENCES bookings(id) ON DELETE SET NULL'
    );

    ensureTable(
      'reviews',
      `CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
        guest_name TEXT,
        rating INTEGER NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        source TEXT,
        stay_date TEXT,
        status TEXT NOT NULL DEFAULT 'published',
        response_text TEXT,
        response_author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        responded_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_property ON reviews(property_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_unit ON reviews(unit_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);`
    );

    ensureColumn('rate_plans', 'min_price', 'REAL DEFAULT NULL');
    ensureColumn('rate_plans', 'max_price', 'REAL DEFAULT NULL');
    ensureColumn('rate_plans', 'rules', "TEXT DEFAULT '{}' CHECK (json_valid(rules))");

    ensureTable(
      'pricing_snapshots',
      `CREATE TABLE IF NOT EXISTS pricing_snapshots (
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        date TEXT NOT NULL,
        suggested REAL NOT NULL,
        reason TEXT NOT NULL,
        inputs TEXT NOT NULL CHECK (json_valid(inputs)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(unit_id, date)
      )`
    );

    ensureTable(
      'user_two_factor',
      `CREATE TABLE IF NOT EXISTS user_two_factor (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL,
        recovery_codes_json TEXT NOT NULL,
        enabled_at TEXT NOT NULL DEFAULT (datetime('now')),
        confirmed_at TEXT,
        last_verified_at TEXT,
        enforced INTEGER NOT NULL DEFAULT 0
      )`
    );

    ensureTable(
      'user_two_factor_setup',
      `CREATE TABLE IF NOT EXISTS user_two_factor_setup (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL,
        recovery_codes_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'two_factor_challenges',
      `CREATE TABLE IF NOT EXISTS two_factor_challenges (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        ip TEXT,
        user_agent TEXT,
        metadata_json TEXT,
        last_attempt_at TEXT,
        used_at TEXT
      )`
    );

    ensureColumn('two_factor_challenges', 'last_attempt_at', 'TEXT');

    ensureTable(
      'owner_financial_entries',
      `CREATE TABLE IF NOT EXISTS owner_financial_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
        entry_type TEXT NOT NULL,
        category TEXT,
        description TEXT,
        document_number TEXT,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        issue_date TEXT,
        due_date TEXT,
        status TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'owner_push_devices',
      `CREATE TABLE IF NOT EXISTS owner_push_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        platform TEXT,
        label TEXT,
        last_active TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, token)
      )`
    );

    ensureTable(
      'owner_push_notifications',
      `CREATE TABLE IF NOT EXISTS owner_push_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        payload_json TEXT,
        unique_key TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        delivered_at TEXT,
        last_attempt_at TEXT
      )`
    );

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_two_factor_challenges_user ON two_factor_challenges(user_id);
       CREATE INDEX IF NOT EXISTS idx_owner_financial_user ON owner_financial_entries(user_id);
       CREATE INDEX IF NOT EXISTS idx_owner_financial_property ON owner_financial_entries(property_id);
       CREATE INDEX IF NOT EXISTS idx_owner_financial_unit ON owner_financial_entries(unit_id);
       CREATE INDEX IF NOT EXISTS idx_owner_push_notifications_user ON owner_push_notifications(user_id);
       CREATE INDEX IF NOT EXISTS idx_owner_push_notifications_status ON owner_push_notifications(status);`
    );

    ensureTable(
      'calendar_price_overrides',
      `CREATE TABLE IF NOT EXISTS calendar_price_overrides (
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        date TEXT NOT NULL,
        price REAL NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(unit_id, date)
      )`
    );

    ensureTable(
      'import_batches',
      `CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        filename TEXT NOT NULL,
        stats TEXT NOT NULL CHECK (json_valid(stats)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'competitor_prices',
      `CREATE TABLE IF NOT EXISTS competitor_prices (
        id TEXT PRIMARY KEY,
        unit_like TEXT NOT NULL,
        date TEXT NOT NULL,
        market_price REAL NOT NULL,
        UNIQUE(unit_like, date)
      )`
    );

    ensureTable(
      'property_policies',
      `CREATE TABLE IF NOT EXISTS property_policies (
        property_id TEXT PRIMARY KEY,
        checkin_from TEXT,
        checkout_until TEXT,
        pets_allowed INTEGER,
        pets_fee REAL,
        cancellation_policy TEXT,
        parking_info TEXT,
        children_policy TEXT,
        payment_methods TEXT,
        quiet_hours TEXT,
        extras TEXT CHECK (extras IS NULL OR json_valid(extras))
      )`
    );

    ensureTable(
      'kb_articles',
      `CREATE TABLE IF NOT EXISTS kb_articles (
        id TEXT PRIMARY KEY,
        property_id TEXT,
        locale TEXT NOT NULL DEFAULT 'pt',
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
        is_published INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id, locale, slug)
      )`
    );

    ensureTable(
      'kb_qas',
      `CREATE TABLE IF NOT EXISTS kb_qas (
        id TEXT PRIMARY KEY,
        property_id TEXT,
        locale TEXT NOT NULL DEFAULT 'pt',
        question TEXT NOT NULL,
        answer_template TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
        confidence_base REAL NOT NULL DEFAULT 0.7,
        is_published INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'kb_synonyms',
      `CREATE TABLE IF NOT EXISTS kb_synonyms (
        id TEXT PRIMARY KEY,
        locale TEXT NOT NULL DEFAULT 'pt',
        canonical TEXT NOT NULL,
        variants TEXT NOT NULL CHECK (json_valid(variants))
      )`
    );

    ensureTable(
      'kb_redirects',
      `CREATE TABLE IF NOT EXISTS kb_redirects (
        id TEXT PRIMARY KEY,
        locale TEXT NOT NULL DEFAULT 'pt',
        pattern TEXT NOT NULL,
        target_slug TEXT NOT NULL
      )`
    );

    ensureTable(
      'kb_feedback',
      `CREATE TABLE IF NOT EXISTS kb_feedback (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        question TEXT NOT NULL,
        answer_given TEXT NOT NULL,
        chosen_kb_id TEXT,
        intent TEXT,
        confidence REAL,
        helpful INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'kb_training_samples',
      `CREATE TABLE IF NOT EXISTS kb_training_samples (
        id TEXT PRIMARY KEY,
        locale TEXT NOT NULL DEFAULT 'pt',
        question TEXT NOT NULL,
        expected_kind TEXT,
        expected_ref TEXT,
        last_accuracy INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'kb_index',
      `CREATE VIRTUAL TABLE IF NOT EXISTS kb_index USING fts5(
        ref,
        locale,
        property_id,
        title,
        content,
        tags,
        tokenize='unicode61'
      )`
    );

    ensureTrigger(
      'kb_articles_ai',
      `CREATE TRIGGER IF NOT EXISTS kb_articles_ai AFTER INSERT ON kb_articles BEGIN
        INSERT INTO kb_index(ref, locale, property_id, title, content, tags)
        VALUES('ART:' || NEW.id, COALESCE(NEW.locale, 'pt'), COALESCE(NEW.property_id, ''), NEW.title, NEW.body, NEW.tags);
      END;`
    );
    ensureTrigger(
      'kb_articles_au',
      `CREATE TRIGGER IF NOT EXISTS kb_articles_au AFTER UPDATE ON kb_articles BEGIN
        DELETE FROM kb_index WHERE ref = 'ART:' || OLD.id;
        INSERT INTO kb_index(ref, locale, property_id, title, content, tags)
        VALUES('ART:' || NEW.id, COALESCE(NEW.locale, 'pt'), COALESCE(NEW.property_id, ''), NEW.title, NEW.body, NEW.tags);
      END;`
    );
    ensureTrigger(
      'kb_articles_ad',
      `CREATE TRIGGER IF NOT EXISTS kb_articles_ad AFTER DELETE ON kb_articles BEGIN
        DELETE FROM kb_index WHERE ref = 'ART:' || OLD.id;
      END;`
    );

    ensureTrigger(
      'kb_qas_ai',
      `CREATE TRIGGER IF NOT EXISTS kb_qas_ai AFTER INSERT ON kb_qas BEGIN
        INSERT INTO kb_index(ref, locale, property_id, title, content, tags)
        VALUES('QA:' || NEW.id, COALESCE(NEW.locale, 'pt'), COALESCE(NEW.property_id, ''), NEW.question, NEW.answer_template, NEW.tags);
      END;`
    );
    ensureTrigger(
      'kb_qas_au',
      `CREATE TRIGGER IF NOT EXISTS kb_qas_au AFTER UPDATE ON kb_qas BEGIN
        DELETE FROM kb_index WHERE ref = 'QA:' || OLD.id;
        INSERT INTO kb_index(ref, locale, property_id, title, content, tags)
        VALUES('QA:' || NEW.id, COALESCE(NEW.locale, 'pt'), COALESCE(NEW.property_id, ''), NEW.question, NEW.answer_template, NEW.tags);
      END;`
    );
    ensureTrigger(
      'kb_qas_ad',
      `CREATE TRIGGER IF NOT EXISTS kb_qas_ad AFTER DELETE ON kb_qas BEGIN
        DELETE FROM kb_index WHERE ref = 'QA:' || OLD.id;
      END;`
    );

    const qaCountRow = db.prepare('SELECT COUNT(1) AS total FROM kb_qas').get();
    if (!qaCountRow.total) {
      const insertQA = db.prepare(
        `INSERT INTO kb_qas (id, property_id, locale, question, answer_template, tags, confidence_base)
         VALUES (@id, @property_id, @locale, @question, @answer_template, @tags, @confidence_base)`
      );
      const seedQAs = [
        {
          question: 'Qual é o horário de check-in e check-out?',
          answer: '<p>O check-in começa às {{checkin_from|15:00}} e o check-out deve acontecer até às {{checkout_until|11:00}}. Se precisar de horários especiais, avise-nos e verificamos a disponibilidade.</p>',
          tags: ['check-in', 'check-out'],
        },
        {
          question: 'Qual é a política de cancelamento?',
          answer: '<p>Cancelamentos gratuitos até 7 dias antes da chegada. Após esse prazo aplicamos a retenção do sinal conforme {{cancellation_policy|a política da propriedade}}.</p>',
          tags: ['cancelamento'],
        },
        {
          question: 'Aceitam animais de estimação?',
          answer: '<p>{{#if pets_allowed}}Aceitamos animais de estimação mediante pedido. Pode haver uma taxa adicional de {{pets_fee|0}}€.{{/if}}{{#unless pets_allowed}}No momento não aceitamos animais dentro das unidades.{{/unless}}</p>',
          tags: ['animais', 'pets'],
        },
        {
          question: 'Existe estacionamento disponível?',
          answer: '<p>{{parking_info|Dispomos de estacionamento privativo gratuito na propriedade.}}</p>',
          tags: ['estacionamento', 'parking'],
        },
        {
          question: 'Aceitam crianças e têm berço?',
          answer: '<p>{{children_policy|Recebemos famílias com crianças. Podemos disponibilizar berço e cadeira elevada mediante pedido antecipado.}}</p>',
          tags: ['criancas', 'berco'],
        },
        {
          question: 'Quais os métodos de pagamento aceites?',
          answer: '<p>Aceitamos {{payment_methods|cartão, MB Way e transferência}}. Para reservas diretas solicitamos um sinal para garantir a estadia.</p>',
          tags: ['pagamento'],
        },
        {
          question: 'Como posso falar convosco?',
          answer: '<p>Estamos disponíveis pelo telefone {{phone|+351 910 000 000}} ou email {{email|reservas@example.com}}. Também pode deixar o contacto aqui e respondemos rapidamente.</p>',
          tags: ['contacto'],
        },
      ];
      const insertSynonym = db.prepare(
        `INSERT INTO kb_synonyms (id, locale, canonical, variants) VALUES (@id, @locale, @canonical, @variants)`
      );
      const selectSynonym = db.prepare(
        `SELECT id FROM kb_synonyms WHERE locale = ? AND canonical = ?`
      );
      const synonymSeeds = [
        ['check-in', ['entrada', 'chegada']],
        ['check-out', ['saida', 'saída', 'partida']],
        ['animais', ['caes', 'cães', 'cao', 'cão', 'pet', 'pets', 'gato', 'animais de estimacao']],
        ['estacionamento', ['parque', 'parking', 'garagem']],
        ['berco', ['cama bebe', 'berço', 'crib']],
        ['ar condicionado', ['ac', 'ar-condicionado']],
        ['preco', ['valor', 'custa', 'tarifa']],
        ['disponivel', ['vaga', 'livre']],
      ];

      db.transaction(() => {
        seedQAs.forEach(item => {
          insertQA.run({
            id: randomUUID(),
            property_id: null,
            locale: 'pt',
            question: item.question,
            answer_template: item.answer,
            tags: JSON.stringify(item.tags || []),
            confidence_base: 0.75,
          });
        });

        synonymSeeds.forEach(([canonical, variants]) => {
          const existing = selectSynonym.get('pt', canonical);
          if (!existing) {
            insertSynonym.run({
              id: randomUUID(),
              locale: 'pt',
              canonical,
              variants: JSON.stringify(variants),
            });
          }
        });
      })();
    }

    ensureTable(
      'automations',
      `CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        trigger TEXT NOT NULL,
        conditions TEXT NOT NULL CHECK (json_valid(conditions)),
        actions TEXT NOT NULL CHECK (json_valid(actions)),
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      )`
    );

    ensureTable(
      'automation_runs',
      `CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        trigger_payload TEXT NOT NULL CHECK (json_valid(trigger_payload)),
        status TEXT NOT NULL,
        result TEXT CHECK (result IS NULL OR json_valid(result)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );

    ensureTable(
      'decision_suggestions',
      `CREATE TABLE IF NOT EXISTS decision_suggestions (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        unit_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL CHECK (json_valid(details)),
        suggested_action TEXT NOT NULL CHECK (json_valid(suggested_action)),
        status TEXT NOT NULL DEFAULT 'OPEN',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        acted_by TEXT
      )`
    );

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

