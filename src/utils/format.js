const dayjs = require('../config/dayjs');

const eur = (cents) => (Number(cents) / 100).toFixed(2);
const capitalizeMonth = (str) => (str ? str.charAt(0).toUpperCase() + str.slice(1) : str);
const esc = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const formatMonthYear = (dateLike) => capitalizeMonth(dayjs(dateLike).format('MMMM YYYY'));

module.exports = {
  eur,
  capitalizeMonth,
  esc,
  formatMonthYear,
};
