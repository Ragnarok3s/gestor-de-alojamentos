'use strict';

function createKbReindexer({ db }) {
  if (!db) {
    throw new Error('createKbReindexer requer uma instância de base de dados.');
  }

  const selectQAs = db.prepare(
    `SELECT id, locale, property_id, question, answer_template, tags
       FROM kb_qas
      WHERE is_published = 1`
  );
  const selectArticles = db.prepare(
    `SELECT id, locale, property_id, title, body, tags
       FROM kb_articles
      WHERE is_published = 1`
  );
  const deleteIndex = db.prepare('DELETE FROM kb_index');
  const insertIndex = db.prepare(
    `INSERT INTO kb_index(ref, locale, property_id, title, content, tags)
     VALUES (@ref, @locale, @property_id, @title, @content, @tags)`
  );

  function reindexAll() {
    db.transaction(() => {
      deleteIndex.run();
      selectQAs.all().forEach(row => {
        insertIndex.run({
          ref: `QA:${row.id}`,
          locale: row.locale || 'pt',
          property_id: row.property_id || '',
          title: row.question,
          content: row.answer_template,
          tags: row.tags || '[]',
        });
      });
      selectArticles.all().forEach(row => {
        insertIndex.run({
          ref: `ART:${row.id}`,
          locale: row.locale || 'pt',
          property_id: row.property_id || '',
          title: row.title,
          content: row.body,
          tags: row.tags || '[]',
        });
      });
    })();
  }

  return { reindexAll };
}

module.exports = { createKbReindexer };
