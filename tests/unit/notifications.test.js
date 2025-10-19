const dayjs = require('dayjs');
const { buildUserNotifications } = require('../../src/services/notifications');
const { createDatabase } = require('../../src/infra/database');

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
    const db = createDatabase(':memory:');

    const now = dayjs();
    db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(1, 'Casa Azul');
    db.prepare('INSERT INTO units (id, property_id, name) VALUES (?, ?, ?)').run(1, 1, 'Suite Vista Mar');
    const insertBooking = db.prepare(
      `INSERT INTO bookings (
        id,
        unit_id,
        guest_name,
        guest_email,
        checkin,
        checkout,
        total_cents,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertBooking.run(
      1,
      1,
      'Maria Silva',
      'maria@example.com',
      now.subtract(10, 'minute').toISOString(),
      now.subtract(9, 'minute').toISOString(),
      5000,
      'PENDING',
      now.subtract(10, 'minute').toISOString()
    );
    insertBooking.run(
      2,
      1,
      'João Costa',
      'joao@example.com',
      now.subtract(5, 'minute').toISOString(),
      now.subtract(4, 'minute').toISOString(),
      7000,
      'PENDING',
      now.subtract(5, 'minute').toISOString()
    );

    const automationData = {
      notifications: [createAutomationNotification('Exportação concluída', 'automation', now.subtract(1, 'day'))]
    };

    try {
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
    } finally {
      db.close();
    }
  });
});
