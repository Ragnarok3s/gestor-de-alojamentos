const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const minMax = require('dayjs/plugin/minMax');

require('dayjs/locale/pt');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(minMax);
dayjs.locale('pt');

module.exports = dayjs;
