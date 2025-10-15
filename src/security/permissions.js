const MASTER_ROLE = 'dev';

const ROLE_DEFINITIONS = [
  {
    key: MASTER_ROLE,
    label: 'Desenvolvedor',
    description: 'Acesso total a todas as funcionalidades.',
    permissions: []
  },
  {
    key: 'rececao',
    label: 'Receção',
    description: 'Operações diárias de reservas e atendimento.',
    permissions: [
      'dashboard.view',
      'calendar.view',
      'calendar.reschedule',
      'calendar.cancel',
      'calendar.block.create',
      'calendar.block.delete',
      'bookings.view',
      'bookings.create',
      'bookings.edit',
      'bookings.cancel',
      'bookings.notes',
      'bookings.export',
      'automation.view',
      'housekeeping.view',
      'housekeeping.manage',
      'housekeeping.complete'
    ]
  },
  {
    key: 'gestao',
    label: 'Gestão',
    description: 'Gestão operacional e comercial da propriedade.',
    permissions: [
      'dashboard.view',
      'calendar.view',
      'calendar.reschedule',
      'calendar.cancel',
      'calendar.block.create',
      'calendar.block.delete',
      'calendar.block.manage',
      'bookings.view',
      'bookings.create',
      'bookings.edit',
      'bookings.cancel',
      'bookings.notes',
      'bookings.export',
      'properties.manage',
      'rates.manage',
      'gallery.manage',
      'automation.view',
      'automation.export',
      'audit.view',
      'owners.portal.view',
      'housekeeping.view',
      'housekeeping.manage',
      'housekeeping.complete'
    ]
  },
  {
    key: 'direcao',
    label: 'Direção',
    description: 'Direção geral com acesso a relatórios e auditorias.',
    permissions: [
      'dashboard.view',
      'calendar.view',
      'calendar.reschedule',
      'calendar.cancel',
      'calendar.block.create',
      'calendar.block.delete',
      'calendar.block.manage',
      'bookings.view',
      'bookings.create',
      'bookings.edit',
      'bookings.cancel',
      'bookings.notes',
      'bookings.export',
      'properties.manage',
      'rates.manage',
      'gallery.manage',
      'automation.view',
      'automation.export',
      'audit.view',
      'users.manage',
      'logs.view',
      'owners.portal.view',
      'housekeeping.view',
      'housekeeping.manage',
      'housekeeping.complete'
    ]
  },
  {
    key: 'limpeza',
    label: 'Limpeza',
    description: 'Equipa de limpeza com acesso ao quadro operacional.',
    permissions: ['housekeeping.view', 'housekeeping.complete']
  },
  {
    key: 'owner',
    label: 'Owners (Portal)',
    description: 'Acesso ao portal de proprietários.',
    permissions: ['owners.portal.view']
  }
];

const ROLE_PERMISSIONS = ROLE_DEFINITIONS.reduce((acc, role) => {
  acc[role.key] = new Set(role.permissions || []);
  return acc;
}, {});

const ALL_PERMISSIONS = new Set();
ROLE_DEFINITIONS.forEach(role => {
  (role.permissions || []).forEach(permission => {
    if (permission) {
      ALL_PERMISSIONS.add(permission);
    }
  });
});
ROLE_PERMISSIONS[MASTER_ROLE] = new Set(ALL_PERMISSIONS);

const ROLE_LABELS = ROLE_DEFINITIONS.reduce((acc, role) => {
  acc[role.key] = role.label;
  return acc;
}, {});

function splitPermissionKey(permission) {
  const raw = typeof permission === 'string' ? permission.trim() : '';
  if (!raw) {
    return { resource: '', action: '' };
  }
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === raw.length - 1) {
    return { resource: raw, action: 'access' };
  }
  return { resource: raw.slice(0, lastDot), action: raw.slice(lastDot + 1) };
}

module.exports = {
  MASTER_ROLE,
  ROLE_DEFINITIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  splitPermissionKey
};
