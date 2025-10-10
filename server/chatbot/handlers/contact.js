'use strict';

function createContactHandler({ db, esc }) {
  if (!db) {
    throw new Error('createContactHandler requer db.');
  }

  const selectDefaultContact = db.prepare(
    `SELECT name, location FROM properties ORDER BY id LIMIT 1`
  );

  function handle() {
    const property = selectDefaultContact.get();
    const name = property ? property.name : 'a nossa equipa';
    return {
      html: `<p>Pode falar com ${esc(name)} através do telefone <strong>+351 910 000 000</strong> ou email <a href="mailto:reservas@exemplo.pt">reservas@exemplo.pt</a>. Se preferir, deixe aqui o seu contacto e ligamos de volta.</p>`,
      confidence: 0.5,
    };
  }

  return { handle };
}

module.exports = { createContactHandler };
