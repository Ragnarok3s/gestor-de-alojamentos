'use strict';

function createPoliciesHandler({ db, esc }) {
  if (!db) {
    throw new Error('createPoliciesHandler requer db.');
  }

  const selectPolicy = db.prepare(
    `SELECT checkin_from, checkout_until, pets_allowed, pets_fee, cancellation_policy, parking_info, children_policy, payment_methods
       FROM property_policies WHERE property_id = ?`
  );
  const selectProperty = db.prepare(
    `SELECT name FROM properties WHERE id = ?`
  );

  function handle({ propertyId }) {
    const policy = propertyId ? selectPolicy.get(propertyId) : null;
    const property = propertyId ? selectProperty.get(propertyId) : null;
    const pieces = [];

    if (property) {
      pieces.push(`<p>${esc(property.name)} mantém um check-in padrão a partir das ${esc(policy && policy.checkin_from ? policy.checkin_from : '15:00')} e check-out até às ${esc(policy && policy.checkout_until ? policy.checkout_until : '11:00')}.</p>`);
    } else {
      pieces.push('<p>O check-in começa às 15:00 e o check-out termina às 11:00.</p>');
    }

    if (policy && typeof policy.pets_allowed !== 'undefined') {
      if (policy.pets_allowed) {
        const feeText = policy.pets_fee != null ? ` (taxa adicional de € ${Number(policy.pets_fee).toFixed(2)})` : '';
        pieces.push(`<p>Aceitamos animais de estimação sob pedido${feeText}.</p>`);
      } else {
        pieces.push('<p>No momento não é possível alojar animais dentro da propriedade.</p>');
      }
    }

    if (policy && policy.cancellation_policy) {
      pieces.push(`<p>${policy.cancellation_policy}</p>`);
    }

    if (policy && policy.payment_methods) {
      pieces.push(`<p>Métodos de pagamento disponíveis: ${esc(policy.payment_methods)}.</p>`);
    }

    if (!pieces.length) {
      pieces.push('<p>Posso partilhar a política completa após confirmar a propriedade desejada.</p>');
    }

    return {
      html: pieces.join(''),
      confidence: 0.6,
    };
  }

  return { handle };
}

module.exports = { createPoliciesHandler };
