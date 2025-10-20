// Centraliza as rotas de tarifários e planos de tarifa do backoffice.
function registerRatePlans(app, context) {
  const { db, dayjs, requireLogin, requirePermission } = context;

  app.post('/admin/units/:id/rates/create', requireLogin, requirePermission('rates.manage'), (req, res) => {
    const { start_date, end_date, price_eur, min_stay } = req.body;
    if (!dayjs(end_date).isAfter(dayjs(start_date)))
      return res.status(400).send('end_date deve ser > start_date');
    const price_cents = Math.round(parseFloat(String(price_eur || '0').replace(',', '.')) * 100);
    if (!(price_cents >= 0)) return res.status(400).send('Preço inválido');
    db.prepare(
      'INSERT INTO rates(unit_id,start_date,end_date,weekday_price_cents,weekend_price_cents,min_stay) VALUES (?,?,?,?,?,?)'
    ).run(req.params.id, start_date, end_date, price_cents, price_cents, min_stay ? Number(min_stay) : 1);
    res.redirect(`/admin/units/${req.params.id}`);
  });

  app.post('/admin/rates/:rateId/delete', requireLogin, requirePermission('rates.manage'), (req, res) => {
    const r = db.prepare('SELECT unit_id FROM rates WHERE id = ?').get(req.params.rateId);
    if (!r) return res.status(404).send('Rate não encontrada');
    db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.rateId);
    res.redirect(`/admin/units/${r.unit_id}`);
  });
}

module.exports = { registerRatePlans };
