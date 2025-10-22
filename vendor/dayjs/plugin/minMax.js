module.exports = function minMaxPlugin(_options, _Dayjs, dayjs) {
  function ensureDayjs(value) {
    const instance = dayjs(value);
    return instance.isValid() ? instance : null;
  }

  function compare(collection, comparator) {
    const valid = collection.map(ensureDayjs).filter(Boolean);
    if (!valid.length) {
      return dayjs(new Date(NaN));
    }
    return valid.reduce((best, candidate) => (comparator(candidate, best) ? candidate : best));
  }

  dayjs.min = function min(...values) {
    return compare(values, (candidate, best) => candidate.valueOf() < best.valueOf());
  };

  dayjs.max = function max(...values) {
    return compare(values, (candidate, best) => candidate.valueOf() > best.valueOf());
  };
};
