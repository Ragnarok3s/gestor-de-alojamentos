const SUPPORTED_LOCALES = ['pt', 'en', 'es'];
const DEFAULT_LOCALE = 'pt';

const TRANSLATIONS = {
  en: {
    app: {
      tagline: 'Hospitality management platform'
    },
    auth: {
      login: {
        title: 'Login',
        heading: 'Backoffice login',
        username: 'Username',
        password: 'Password',
        submit: 'Sign in',
        invalidCredentials: 'Invalid credentials'
      }
    },
    nav: {
      search: 'Search',
      owners: 'Owners portal',
      calendar: 'Reservation map',
      housekeeping: 'Housekeeping',
      backoffice: 'Backoffice',
      notifications: 'Notifications',
      viewBookings: 'View bookings',
      login: 'Login',
      logout: 'Log out'
    },
    notifications: {
      empty: 'No notifications at the moment.',
      update: 'Update'
    },
    dashboard: {
      housekeeping: {
        title: 'Housekeeping overview',
        subtitle: 'Track priorities, monitor tasks in real time and keep the team aligned.',
        today: 'Today\'s tasks',
        messages: 'Messages',
        tasks: 'Tasks',
        avgTime: 'Average cleaning time',
        weekly: 'Weekly tasks',
        inventory: 'Supply inventory',
        properties: 'Property list',
        newTask: 'New cleaning task',
        newTaskHint: 'Link the task to an existing booking or set the unit and dates manually.',
        type: 'Task type',
        priority: 'Priority',
        title: 'Title',
        details: 'Details',
        booking: 'Booking',
        property: 'Property',
        unit: 'Unit',
        dueDate: 'Due date',
        dueTime: 'Due time',
        create: 'Create task',
        stats: {
          pending: 'Pending',
          inProgress: 'In progress',
          highPriority: 'High priority'
        },
        dailySummary: 'Daily summary',
        totalUpcoming: '{{count}} tasks in the next days',
        noUpcoming: 'No scheduled tasks',
        noProperties: 'No registered properties.',
        reconnect: 'Reopen',
        summaryLabel: 'Summary',
        todayEmpty: 'No tasks scheduled for today.',
        todayCheckouts: '{{count}} checkout{{suffix}}',
        todayCheckins: '{{count}} check-in{{suffix}}',
        alerts: {
          overdue: '{{count}} overdue task{{suffix}} awaiting action.',
          backlog: '{{count}} unit{{suffix}} pending cleaning after checkout.',
          highPriority: '{{count}} high-priority task{{suffix}} open.',
          none: 'No alerts at the moment. Keep up the great work!'
        },
        priorityBadge: {
          high: 'High priority',
          normal: 'Normal priority',
          low: 'Low priority'
        },
        statusBadge: {
          pending: 'Pending',
          inProgress: 'In progress',
          completed: 'Completed'
        },
        status: {
          free: 'Available',
          busy: 'Occupied',
          checkinToday: 'Check-in today',
          checkoutToday: 'Check-out today',
          none: 'No bookings'
        },
        messagesEmpty: 'No new messages.',
        taskCount: '{{count}} task{{suffix}}',
        moreTasks: '+{{count}} task(s)',
        noTasks: 'No tasks',
        inventoryNoneActive: 'No active tasks',
        inventoryActiveStatus: '{{pending}} pending{{pendingSuffix}} · {{inProgress}} in progress',
        inventoryItem: 'Item',
        inventoryQuantity: 'Quantity',
        taskTypeKey: {
          checkout: 'Checkout',
          checkin: 'Check-in',
          midstay: 'Mid-stay',
          custom: 'Manual'
        },
        propertyStats: '{{pending}} pending{{pendingSuffix}} · {{inProgress}} in progress',
        propertiesHighPriority: 'High priority: {{count}}',
        noProperty: 'No property',
        propertyColumn: 'Property',
        occupancyColumn: 'Occupancy',
        taskColumn: 'Task',
        unitColumn: 'Unit',
        completedColumn: 'Completed',
        completedByColumn: 'Completed by',
        completed7d: 'Completed in the last 7 days',
        completedCount: '{{count}} record{{suffix}}',
        boardTitle: 'Housekeeping map',
        bookingOptional: 'Booking (optional)',
        selectBooking: 'Select booking...',
        unitOptional: 'Unit (optional)',
        selectUnit: 'Select unit...',
        propertyOptional: 'Property (optional)',
        selectProperty: 'Select property...',
        dueTimeOptional: 'Due time (optional)',
        titleLabel: 'Title',
        titlePlaceholder: 'Ex.: Prepare for new arrival',
        detailsOptional: 'Team notes (optional)',
        detailsPlaceholder: 'Share specific instructions or guest requests',
        noGuest: 'No guest'
      },
      moduleLoading: 'Loading module…',
      moduleError: 'Unable to refresh module.',
      moduleRetry: 'Try again',
      moduleRefresh: 'Refresh',
      moduleCollapse: 'Collapse module',
      moduleExpand: 'Expand module'
    },
    housekeeping: {
      checklist: {
        dueToday: 'Due today',
        startedBy: 'Started by',
        complete: 'Complete',
        start: 'Start'
      },
      priorities: {
        high: 'High',
        normal: 'Normal',
        low: 'Low'
      },
      types: {
        checkout: 'Checkout cleaning',
        checkin: 'Prepare arrival',
        midstay: 'Mid-stay refresh',
        custom: 'Cleaning task'
      }
    },
    general: {
      brandDemo: 'Demo platform',
      language: 'Language',
      theme: 'Theme',
      themeLight: 'Light mode',
      themeDark: 'Dark mode',
      viewAll: 'View all',
      today: 'Today',
      noData: 'No data available'
    }
  },
  es: {
    app: {
      tagline: 'Plataforma de gestión hotelera'
    },
    auth: {
      login: {
        title: 'Iniciar sesión',
        heading: 'Acceso al backoffice',
        username: 'Usuario',
        password: 'Contraseña',
        submit: 'Entrar',
        invalidCredentials: 'Credenciales inválidas'
      }
    },
    nav: {
      search: 'Buscar',
      owners: 'Portal de propietarios',
      calendar: 'Mapa de reservas',
      housekeeping: 'Limpieza',
      backoffice: 'Backoffice',
      notifications: 'Notificaciones',
      viewBookings: 'Ver reservas',
      login: 'Iniciar sesión',
      logout: 'Cerrar sesión'
    },
    notifications: {
      empty: 'Sin notificaciones por el momento.',
      update: 'Actualización'
    },
    dashboard: {
      housekeeping: {
        title: 'Resumen de limpieza',
        subtitle: 'Visualiza prioridades, sigue las tareas en tiempo real y mantén al equipo alineado.',
        today: 'Tareas de hoy',
        messages: 'Mensajes',
        tasks: 'Tareas',
        avgTime: 'Tiempo medio por limpieza',
        weekly: 'Tareas semanales',
        inventory: 'Inventario de suministros',
        properties: 'Listado de propiedades',
        newTask: 'Nueva tarea de limpieza',
        newTaskHint: 'Relaciona la tarea con una reserva existente o define manualmente la unidad y las fechas.',
        type: 'Tipo de tarea',
        priority: 'Prioridad',
        title: 'Título',
        details: 'Detalles',
        booking: 'Reserva',
        property: 'Propiedad',
        unit: 'Unidad',
        dueDate: 'Fecha límite',
        dueTime: 'Hora límite',
        create: 'Crear tarea',
        stats: {
          pending: 'Pendientes',
          inProgress: 'En curso',
          highPriority: 'Alta prioridad'
        },
        dailySummary: 'Resumen diario',
        totalUpcoming: '{{count}} tareas en los próximos días',
        noUpcoming: 'Sin tareas programadas',
        noProperties: 'No hay propiedades registradas.',
        reconnect: 'Reabrir',
        summaryLabel: 'Resumen',
        todayEmpty: 'Sin tareas programadas para hoy.',
        todayCheckouts: '{{count}} check-out{{suffix}}',
        todayCheckins: '{{count}} check-in{{suffix}}',
        alerts: {
          overdue: '{{count}} tarea{{suffix}} atrasada esperando acción.',
          backlog: '{{count}} unidad{{suffix}} pendiente de limpieza tras la salida.',
          highPriority: '{{count}} tarea{{suffix}} de alta prioridad abierta.',
          none: 'Sin alertas por ahora. ¡Sigue así!'
        },
        priorityBadge: {
          high: 'Alta prioridad',
          normal: 'Prioridad normal',
          low: 'Prioridad baja'
        },
        statusBadge: {
          pending: 'Pendiente',
          inProgress: 'En curso',
          completed: 'Completada'
        },
        status: {
          free: 'Libre',
          busy: 'Ocupado',
          checkinToday: 'Check-in hoy',
          checkoutToday: 'Check-out hoy',
          none: 'Sin reservas'
        },
        messagesEmpty: 'Sin mensajes nuevos.',
        taskCount: '{{count}} tarea{{suffix}}',
        moreTasks: '+{{count}} tarea(s)',
        noTasks: 'Sin tareas',
        inventoryNoneActive: 'Sin tareas activas',
        inventoryActiveStatus: '{{pending}} pendiente{{pendingSuffix}} · {{inProgress}} en curso',
        inventoryItem: 'Elemento',
        inventoryQuantity: 'Cantidad',
        taskTypeKey: {
          checkout: 'Check-out',
          checkin: 'Check-in',
          midstay: 'Estancia',
          custom: 'Manual'
        },
        propertyStats: '{{pending}} pendiente{{pendingSuffix}} · {{inProgress}} en curso',
        propertiesHighPriority: 'Alta prioridad: {{count}}',
        noProperty: 'Sin propiedad',
        propertyColumn: 'Propiedad',
        occupancyColumn: 'Ocupación',
        taskColumn: 'Tarea',
        unitColumn: 'Unidad',
        completedColumn: 'Completada',
        completedByColumn: 'Por',
        completed7d: 'Completadas en los últimos 7 días',
        completedCount: '{{count}} registro{{suffix}}',
        boardTitle: 'Mapa de limpiezas',
        bookingOptional: 'Reserva (opcional)',
        selectBooking: 'Seleccionar reserva...',
        unitOptional: 'Unidad (opcional)',
        selectUnit: 'Seleccionar unidad...',
        propertyOptional: 'Propiedad (opcional)',
        selectProperty: 'Seleccionar propiedad...',
        dueTimeOptional: 'Hora límite (opcional)',
        titleLabel: 'Título',
        titlePlaceholder: 'Ej.: Preparar para nueva entrada',
        detailsOptional: 'Notas para el equipo (opcional)',
        detailsPlaceholder: 'Indica instrucciones específicas o peticiones de los huéspedes',
        noGuest: 'Sin huésped'
      },
      moduleLoading: 'Cargando módulo…',
      moduleError: 'No se pudo actualizar el módulo.',
      moduleRetry: 'Intentar de nuevo',
      moduleRefresh: 'Actualizar',
      moduleCollapse: 'Contraer módulo',
      moduleExpand: 'Expandir módulo'
    },
    housekeeping: {
      checklist: {
        dueToday: 'Entrega hoy',
        startedBy: 'Iniciada por',
        complete: 'Completar',
        start: 'Iniciar'
      },
      priorities: {
        high: 'Alta',
        normal: 'Normal',
        low: 'Baja'
      },
      types: {
        checkout: 'Limpieza de salida',
        checkin: 'Preparar entrada',
        midstay: 'Repaso intermedio',
        custom: 'Tarea de limpieza'
      }
    },
    general: {
      brandDemo: 'Plataforma demo',
      language: 'Idioma',
      theme: 'Tema',
      themeLight: 'Modo claro',
      themeDark: 'Modo oscuro',
      viewAll: 'Ver todos',
      today: 'Hoy',
      noData: 'Sin datos disponibles'
    }
  }
};

function normalizeLocale(locale) {
  if (!locale || typeof locale !== 'string') return '';
  const value = locale.trim().toLowerCase();
  if (!value) return '';
  const base = value.split(/[-_]/)[0];
  return base;
}

function resolveLocale(candidate) {
  const normalized = normalizeLocale(candidate);
  if (SUPPORTED_LOCALES.includes(normalized)) return normalized;
  return '';
}

function parseAcceptLanguage(header) {
  if (!header || typeof header !== 'string') return [];
  return header
    .split(',')
    .map(part => {
      const [lang] = part.split(';');
      return normalizeLocale(lang);
    })
    .filter(Boolean);
}

function getLocaleFromRequest(req) {
  const queryLocale = resolveLocale(req.query && req.query.lang);
  if (queryLocale) return queryLocale;
  const cookieLocale = resolveLocale(req.cookies && req.cookies.lang);
  if (cookieLocale) return cookieLocale;
  const acceptLocales = parseAcceptLanguage(req.headers['accept-language']);
  for (const candidate of acceptLocales) {
    if (SUPPORTED_LOCALES.includes(candidate)) {
      return candidate;
    }
  }
  return DEFAULT_LOCALE;
}

function formatWithReplacements(message, replacements) {
  if (!replacements) return message;
  return message.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const k = String(key).trim();
    if (!k) return '';
    if (Object.prototype.hasOwnProperty.call(replacements, k)) {
      const value = replacements[k];
      return value != null ? String(value) : '';
    }
    return '';
  });
}

function translate(locale, key, fallback, replacements) {
  const dictionary = TRANSLATIONS[locale];
  let message;
  if (dictionary && key) {
    const segments = key.split('.');
    message = segments.reduce((acc, segment) => {
      if (acc && typeof acc === 'object' && segment in acc) {
        return acc[segment];
      }
      return undefined;
    }, dictionary);
    if (typeof message === 'object') {
      message = undefined;
    }
  }
  const base = typeof message === 'string' ? message : fallback;
  const resolved = typeof base === 'string' ? base : key;
  return formatWithReplacements(resolved, replacements);
}

function getLocaleLabel(locale) {
  switch (locale) {
    case 'en':
      return 'English';
    case 'es':
      return 'Español';
    case 'pt':
    default:
      return 'Português';
  }
}

module.exports = {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  TRANSLATIONS,
  getLocaleFromRequest,
  translate,
  normalizeLocale,
  resolveLocale,
  getLocaleLabel
};
