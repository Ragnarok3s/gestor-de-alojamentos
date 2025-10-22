const { DatabaseSync } = require('node:sqlite');

class SqliteStatement {
  constructor(statement) {
    this._statement = statement;
  }

  run(...params) {
    return this._statement.run(...params);
  }

  get(...params) {
    return this._statement.get(...params);
  }

  all(...params) {
    return this._statement.all(...params);
  }

  iterate(...params) {
    return this._statement.iterate(...params);
  }
}

class SqliteCompatDatabase {
  constructor(filename, options = {}) {
    const openOptions = { ...options };
    this._db = new DatabaseSync(filename, openOptions);
  }

  pragma(statement) {
    return this._db.prepare(`PRAGMA ${statement}`).all();
  }

  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return new SqliteStatement(stmt);
  }

  exec(sql) {
    this._db.exec(sql);
  }

  transaction(fn) {
    return (...args) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this._db.exec('ROLLBACK');
        } catch (rollbackError) {
          // Ignore rollback errors to keep behaviour similar to better-sqlite3.
        }
        throw error;
      }
    };
  }

  close() {
    this._db.close();
  }
}

module.exports = SqliteCompatDatabase;
