// Centraliza as operações financeiras do backoffice (receitas, tarifários, regras e extras).
const { registerRatePlans } = require('./finance/ratePlans');
const { registerRateRules } = require('./finance/rateRules');
const { registerExtras } = require('./finance/extras');

function registerFinance(app, context) {
  registerRatePlans(app, context);
  registerRateRules(app, context);
  registerExtras(app, context);
}

module.exports = { registerFinance };
