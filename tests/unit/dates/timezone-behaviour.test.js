const {
  dayjs,
  calculateNights,
  ensureZonedDayjs,
  DEFAULT_TIMEZONE
} = require('../../../src/lib/dates');

describe('helpers de datas - timezone e DST', () => {
  const timezone = DEFAULT_TIMEZONE || 'Europe/Lisbon';

  test('calcula noites correctamente durante mudança de hora (primavera)', () => {
    const checkin = '2024-03-30';
    const checkout = '2024-04-02';
    const nights = calculateNights(checkin, checkout, { timezone });
    expect(nights).toBe(3);
  });

  test('reservas que atravessam a meia-noite contam uma noite', () => {
    const checkin = '2024-10-26T22:45:00';
    const checkout = '2024-10-27T08:15:00';
    const nights = calculateNights(checkin, checkout, { timezone });
    expect(nights).toBe(1);
  });

  test('ensureZonedDayjs aplica timezone configurado', () => {
    const zoned = ensureZonedDayjs('2024-04-01T12:00:00Z', timezone);
    expect(zoned).not.toBeNull();
    expect(zoned.format()).toBe(dayjs('2024-04-01T12:00:00Z').tz(timezone).format());
  });
});
