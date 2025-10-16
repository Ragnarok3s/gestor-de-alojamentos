function setNoIndex(res) {
  if (!res || typeof res.set !== 'function') {
    return;
  }
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

module.exports = {
  setNoIndex
};
