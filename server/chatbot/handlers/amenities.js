'use strict';

function createAmenitiesHandler({ db, esc }) {
  if (!db) {
    throw new Error('createAmenitiesHandler requer db.');
  }

  const selectUnitFeatures = db.prepare(
    `SELECT u.name, u.features, p.name AS property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.name
      LIMIT 6`
  );

  function handle() {
    const rows = selectUnitFeatures.all();
    if (!rows.length) {
      return {
        html: '<p>Cada unidade inclui cozinha equipada, Wi-Fi rápido e amenities de hotel. Posso verificar a disponibilidade se indicar datas.</p>',
        confidence: 0.5,
      };
    }

    const items = rows.map(row => {
      const features = row.features ? row.features.split(',').map(f => f.trim()).filter(Boolean).slice(0, 3) : [];
      const featureText = features.length ? ` · ${esc(features.join(', '))}` : '';
      return `<li><strong>${esc(row.name)}</strong> (${esc(row.property_name)})${featureText}</li>`;
    }).join('');

    return {
      html: `<p>As nossas unidades contam com Wi-Fi, cozinha equipada e conforto de hotel.</p><ul class="chatbot-list">${items}</ul>`,
      confidence: 0.55,
    };
  }

  return { handle };
}

module.exports = { createAmenitiesHandler };
