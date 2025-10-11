const { ValidationError } = require('./errors');

function normalizeResponseText(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    throw new ValidationError('Escreve uma resposta antes de enviar.');
  }
  if (value.length > 1000) {
    throw new ValidationError('Resposta demasiado longa (máx. 1000 caracteres).');
  }
  return value;
}

function createReviewService({ db, dayjs }) {
  const listStmt = db.prepare(
    `SELECT * FROM reviews ORDER BY created_at DESC`
  );

  const filterByRatingStmt = db.prepare(
    `SELECT * FROM reviews WHERE rating <= ? ORDER BY created_at DESC`
  );

  const findReviewStmt = db.prepare('SELECT * FROM reviews WHERE id = ?');

  const updateResponseStmt = db.prepare(
    `UPDATE reviews
     SET response_text = ?,
         response_author_id = ?,
         responded_at = ?,
         updated_at = ?
     WHERE id = ?`
  );

  function listReviews({ onlyNegative = false } = {}) {
    const rows = onlyNegative ? filterByRatingStmt.all(3) : listStmt.all();
    return rows.map(row => ({
      ...row,
      responded: !!row.responded_at
    }));
  }

  function respondToReview(reviewId, text, userId) {
    const review = findReviewStmt.get(reviewId);
    if (!review) {
      throw new ValidationError('Avaliação não encontrada.');
    }
    const responseText = normalizeResponseText(text);
    const now = dayjs().format('YYYY-MM-DDTHH:mm:ss');
    updateResponseStmt.run(responseText, userId || null, now, now, reviewId);
    return {
      ...review,
      response_text: responseText,
      response_author_id: userId || null,
      responded_at: now,
      updated_at: now
    };
  }

  return {
    listReviews,
    respondToReview,
    normalizeResponseText
  };
}

module.exports = {
  createReviewService
};
