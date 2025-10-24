'use strict';

const { registerCalendarController } = require('../../controllers/backoffice/calendar-controller');

function registerCalendar(app, context) {
  return registerCalendarController(app, context);
}

module.exports = { registerCalendar };
