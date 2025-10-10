'use strict';

function createLocationHandler({ db, esc }) {
  if (!db) {
    throw new Error('createLocationHandler requer db.');
  }

  const selectLocations = db.prepare(
    `SELECT name, location, address
       FROM properties
      ORDER BY name
      LIMIT 6`
  );

  function handle() {
    const rows = selectLocations.all();
    if (!rows.length) {
      return {
        html: '<p>Estamos presentes em várias cidades de Portugal. Diga-me a região favorita e procuro a melhor unidade.</p>',
        confidence: 0.45,
      };
    }

    const items = rows.map(row => {
      const locality = row.location || row.address || 'Localização central';
      return `<li><strong>${esc(row.name)}</strong> · ${esc(locality)}</li>`;
    }).join('');

    return {
      html: `<p>Estas são algumas das nossas localizações:</p><ul class="chatbot-list">${items}</ul>`,
      confidence: 0.55,
    };
  }

  return { handle };
}

module.exports = { createLocationHandler };
