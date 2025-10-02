const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
require('dayjs/locale/pt');

dayjs.extend(minMax);
dayjs.locale('pt');

module.exports = dayjs;
