module.exports = function customParseFormatPlugin(options, _Dayjs, dayjs) {
  dayjs.p.customParseFormat = true;
  if (typeof dayjs.__setParseTwoDigitYear === 'function' && options && Object.prototype.hasOwnProperty.call(options, 'parseTwoDigitYear')) {
    dayjs.__setParseTwoDigitYear(options.parseTwoDigitYear);
  }
};
