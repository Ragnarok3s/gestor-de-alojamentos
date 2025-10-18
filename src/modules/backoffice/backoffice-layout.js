'use strict';

function createBackofficeLayoutHelpers({ html, esc, userCan, isFlagEnabled, MASTER_ROLE }) {
  const broomIconSvg = `
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 21h4l7-7"></path>
        <path d="M14 14l5-5a3 3 0 0 0-4.24-4.24l-5 5"></path>
        <path d="M11 11l2 2"></path>
        <path d="M5 21l-1-4 4 1"></path>
      </svg>
    `.trim();

  function evaluateFlag(flagName) {
    if (typeof isFlagEnabled === 'function') {
      try {
        return !!isFlagEnabled(flagName);
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  function buildBackofficeNavigation(req, { activePaneId = '' } = {}) {
    const can = permission => userCan(req.user, permission);
    const canManageHousekeeping = can('housekeeping.manage');
    const canViewHousekeeping = can('housekeeping.view');
    const canSeeHousekeeping = canManageHousekeeping || canViewHousekeeping;
    const canManageUsers = can('users.manage');
    const canManageEmailTemplates = can('bookings.edit');
    const canManageIntegrations = canManageEmailTemplates;
    const canManageProperties = can('properties.manage');
    const canViewCalendar = can('calendar.view');
    const canViewBookings = can('bookings.view');
    const canViewRevenueCalendar = can('dashboard.view');
    const canManageRates = can('rates.manage');
    const canAccessAudit = can('audit.view') || can('logs.view');
    const enableExportShortcuts = evaluateFlag('FEATURE_NAV_EXPORT_SHORTCUTS');
    const canExportBookings = enableExportShortcuts && can('bookings.export');
    const isDevOperator = req.user && req.user.role === MASTER_ROLE;
    const isDirectorOperator = req.user && req.user.role === 'direcao';
    const canViewHistory = !!(isDevOperator || isDirectorOperator);

    const navSections = [
      {
        id: 'operations',
        title: 'Operações diárias',
        items: [
          { id: 'overview', label: 'Propriedades', icon: 'building-2', allowed: true },
          { id: 'calendar', label: 'Calendário', icon: 'calendar-days', allowed: canViewCalendar },
          { id: 'bookings-link', label: 'Reservas', icon: 'notebook-text', allowed: canViewBookings, href: '/admin/bookings' },
          { id: 'housekeeping', label: 'Painel de limpezas', iconSvg: broomIconSvg, icon: 'broom', allowed: canSeeHousekeeping },
          {
            id: 'housekeeping-manage',
            label: 'Gestão de limpezas',
            icon: 'clipboard-check',
            allowed: canManageHousekeeping,
            href: '/admin/limpeza'
          },
          {
            id: 'extras-link',
            label: 'Extras & serviços',
            icon: 'gift',
            allowed: canManageProperties,
            href: '/admin/extras'
          },
          { id: 'channel-manager', label: 'Channel Manager', icon: 'share-2', allowed: canManageIntegrations },
          { id: 'content-center-link', label: 'Centro de Conteúdos', icon: 'notebook-pen', allowed: true, href: '/admin/content-center' }
        ]
      },
      {
        id: 'finance',
        title: 'Finanças e rendimento',
        items: [
          { id: 'finance', label: 'Financeiro', icon: 'piggy-bank', allowed: true },
          {
            id: 'revenue-calendar-link',
            label: 'Calendário de receita',
            icon: 'calendar-range',
            allowed: canViewRevenueCalendar,
            href: '/admin/revenue-calendar'
          },
          { id: 'exports-link', label: 'Exportações', icon: 'file-spreadsheet', allowed: canExportBookings, href: '/admin/export' },
          { id: 'rates-link', label: 'Regras de tarifas', icon: 'wand-2', allowed: canManageRates, href: '/admin/rates/rules' }
        ]
      },
      {
        id: 'communication',
        title: 'Comunicação',
        items: [
          { id: 'estatisticas', label: 'Estatísticas', icon: 'bar-chart-3', allowed: can('automation.view') },
          { id: 'reviews', label: 'Reviews', icon: 'message-square', allowed: true },
          { id: 'emails', label: 'Emails', icon: 'mail', allowed: canManageEmailTemplates },
          { id: 'messages', label: 'Mensagens', icon: 'message-circle', allowed: canManageEmailTemplates }
        ]
      },
      {
        id: 'administration',
        title: 'Administração',
        items: [
          ...(canViewHistory ? [{ id: 'history', label: 'Histórico', icon: 'history', allowed: true }] : []),
          { id: 'users', label: 'Utilizadores', icon: 'users', allowed: canManageUsers },
          { id: 'branding', label: 'Identidade', icon: 'palette', allowed: canManageUsers },
          {
            id: 'audit-link',
            label: 'Auditoria',
            icon: 'clipboard-list',
            allowed: evaluateFlag('FEATURE_NAV_AUDIT_LINKS') && canAccessAudit,
            href: '/admin/auditoria'
          }
        ]
      }
    ];

    const allNavItems = navSections.flatMap(section => section.items);
    const defaultPane = allNavItems.find(item => item.allowed && !item.href)?.id || 'overview';
    const navLinkTargets = new Set(allNavItems.filter(item => item.href).map(item => item.href));

    const navButtonsHtml = navSections
      .map(section => {
        const itemsHtml = section.items
          .map(item => {
            const classes = ['bo-tab'];
            if (item.id === 'channel-manager') classes.push('bo-tab--compact');
            if (item.href) classes.push('bo-tab--link');

            const isActive = item.id === activePaneId;
            if (isActive || (!activePaneId && !item.href && item.id === defaultPane)) {
              classes.push('is-active');
            }

            const iconMarkup = item.iconSvg
              ? item.iconSvg
              : `<i data-lucide="${item.icon}" class="w-5 h-5" aria-hidden="true"></i>`;

            if (!item.allowed) {
              return `<button type="button" class="${classes.join(' ')}" data-disabled="true" title="Sem permissões" disabled>${iconMarkup}<span>${esc(item.label)}</span></button>`;
            }

            if (item.href) {
              const ariaCurrent = isActive ? ' aria-current="page"' : '';
              return `<a class="${classes.join(' ')}" href="${item.href}" target="_self"${ariaCurrent}>${iconMarkup}<span>${esc(item.label)}</span></a>`;
            }

            return `<button type="button" class="${classes.join(' ')}" data-bo-target="${item.id}">${iconMarkup}<span>${esc(item.label)}</span></button>`;
          })
          .join('');

        if (!itemsHtml.trim()) {
          return '';
        }

        const sectionItemsId = `bo-nav-items-${section.id}`;
        return `
          <div class="bo-nav__section is-collapsed" data-nav-section data-nav-start-collapsed="true">
            <button
              type="button"
              class="bo-nav__section-toggle"
              data-nav-toggle
              aria-expanded="false"
              aria-controls="${sectionItemsId}"
            >
              <span>${esc(section.title)}</span>
              <i data-lucide="chevron-down" class="bo-nav__section-toggle-icon" aria-hidden="true"></i>
            </button>
            <div class="bo-nav__section-items" data-nav-items id="${sectionItemsId}" hidden>${itemsHtml}</div>
          </div>
        `;
      })
      .filter(Boolean)
      .join('');

    return { navButtonsHtml, navLinkTargets, defaultPane };
  }

  function renderBackofficeShell({ navButtonsHtml, mainContent, isWide = false }) {
    const pageClass = ['bo-page', isWide ? 'bo-page--wide' : ''].filter(Boolean).join(' ');
    return html`
      <div class="${pageClass}">
        <div class="bo-shell" data-bo-shell>
          <aside class="bo-sidebar" data-bo-sidebar tabindex="-1">
            <div class="bo-sidebar__header">
              <div class="bo-sidebar__title">Menu principal</div>
              <button
                type="button"
                class="bo-sidebar__toggle"
                data-sidebar-toggle
                aria-expanded="true"
                aria-controls="bo-backoffice-nav"
                aria-label="Encolher menu"
              >
                <i data-lucide="chevron-left" class="bo-sidebar__toggle-icon bo-sidebar__toggle-icon--collapse" aria-hidden="true"></i>
                <i data-lucide="chevron-right" class="bo-sidebar__toggle-icon bo-sidebar__toggle-icon--expand" aria-hidden="true"></i>
                <i data-lucide="x" class="bo-sidebar__toggle-icon bo-sidebar__toggle-icon--close" aria-hidden="true"></i>
              </button>
            </div>
            <nav class="bo-nav" id="bo-backoffice-nav" data-sidebar-nav>${navButtonsHtml}</nav>
          </aside>
          <div class="bo-sidebar__scrim" data-sidebar-scrim hidden></div>
          <div class="bo-main" data-bo-main>
            <button type="button" class="bo-main__menu" data-sidebar-open>
              <i data-lucide="menu" aria-hidden="true"></i>
              <span>Menu</span>
            </button>
            ${mainContent}
          </div>
        </div>
      </div>
    `;
  }

  return { buildBackofficeNavigation, renderBackofficeShell };
}

module.exports = { createBackofficeLayoutHelpers };
