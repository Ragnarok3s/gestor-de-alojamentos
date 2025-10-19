const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const { buildUserNotifications } = require('../../src/services/notifications');

function createAutomationNotification(title, type, createdAt) {
  return {
    title,
    type,
    created_at: createdAt.toISOString()
  };
}

describe('notifications service - buildUserNotifications', () => {
  it('filters automation notifications according to the user permissions', () => {
    // Scenario: User only has housekeeping permissions, so booking or automation alerts must be hidden.
    const user = { id: 1, role: 'housekeeping' };
    const now = dayjs();
    const automationData = {
      notifications: [
        createAutomationNotification('Limpeza pendente', 'housekeeping', now.subtract(1, 'hour')),
        createAutomationNotification('Reserva cancelada', 'booking', now.subtract(2, 'hour')),
        createAutomationNotification('Exportação falhada', 'automation', now.subtract(3, 'hour'))
      ],
      lastRun: now.toISOString()
    };

    const result = buildUserNotifications({
      user,
      db: {},
      dayjs,
      userCan: (_user, ability) => ability === 'housekeeping.view',
      automationData
    });

    // Expectation: Only housekeeping alerts survive the permission filter and are returned to the user.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'Limpeza pendente' });
  });

  it('orders notifications by the newest creation date', () => {
    // Scenario: Booking permissions enabled, producing two pending booking alerts plus an older automation message.
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE units (id INTEGER PRIMARY KEY, property_id INTEGER, name TEXT);
      CREATE TABLE bookings (
        id INTEGER PRIMARY KEY,
        guest_name TEXT,
        created_at TEXT,
        unit_id INTEGER,
        status TEXT
      );
    `);

    const now = dayjs();
    db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(1, 'Casa Azul');
    db.prepare('INSERT INTO units (id, property_id, name) VALUES (?, ?, ?)').run(1, 1, 'Suite Vista Mar');
    db.prepare(
      'INSERT INTO bookings (id, guest_name, created_at, unit_id, status) VALUES (?, ?, ?, ?, ?)'
    ).run(1, 'Maria Silva', now.subtract(10, 'minute').toISOString(), 1, 'PENDING');
    db.prepare(
      'INSERT INTO bookings (id, guest_name, created_at, unit_id, status) VALUES (?, ?, ?, ?, ?)'
    ).run(2, 'João Costa', now.subtract(5, 'minute').toISOString(), 1, 'PENDING');

    const automationData = {
      notifications: [createAutomationNotification('Exportação concluída', 'automation', now.subtract(1, 'day'))]
    };

    const result = buildUserNotifications({
      user: { id: 2, role: 'manager' },
      db,
      dayjs,
      userCan: (_user, ability) => ['bookings.view', 'automation.view'].includes(ability),
      automationData,
      pendingLimit: 5
    });

    // Expectation: Notifications are sorted so the most recent booking appears first, followed by older entries.
    expect(result).toHaveLength(3);
    expect(result[0].message).toContain('João Costa');
    expect(result[1].message).toContain('Maria Silva');
    expect(result[2]).toMatchObject({ title: 'Exportação concluída' });
  });
});
