'use strict';

const fs = require('fs');
const path = require('path');

function createBackofficeLayoutHelpers({ html, esc, userCan, isFlagEnabled, MASTER_ROLE }) {
  const tabsScriptSource = fs.readFileSync(path.join(__dirname, 'scripts', 'backoffice-tabs.js'), 'utf8');

  function inlineScript(source) {
    return source.replace(/<\/(script)/gi, '<\\/$1');
  }

  function escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeTargetFromHref(href) {
    if (typeof href !== 'string' || !href.trim()) return '';
    const sanitized = href.split('#')[0].split('?')[0];
    const segments = sanitized.split('/').filter(Boolean);
    return normalizeTargetSegment(segments.length ? segments[segments.length - 1] : sanitized);
  }

  function normalizeTargetFromId(id) {
    if (typeof id !== 'string') return '';
    return normalizeTargetSegment(id.replace(/-link$/, ''));
  }

  function normalizeTargetSegment(segment) {
    if (typeof segment !== 'string') return '';
    const cleaned = segment
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return cleaned || 'panel';
  }

  function deriveTargetForItem(item) {
    if (!item || typeof item !== 'object') return 'panel';
    if (typeof item.target === 'string' && item.target.trim()) {
      return normalizeTargetSegment(item.target);
    }
    if (typeof item.href === 'string' && item.href.trim()) {
      const fromHref = normalizeTargetFromHref(item.href);
      if (fromHref) return fromHref;
    }
    if (typeof item.id === 'string' && item.id.trim()) {
      const fromId = normalizeTargetFromId(item.id);
      if (fromId) return fromId;
    }
    if (typeof item.label === 'string' && item.label.trim()) {
      return normalizeTargetSegment(item.label);
    }
    return 'panel';
  }

  function deriveSourceForItem(item, target) {
    if (item && typeof item.href === 'string' && item.href.trim()) {
      return item.href;
    }
    if (!target) return '/admin';
    return `/admin?tab=${encodeURIComponent(target)}`;
  }

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

    const enrichedSections = navSections.map(section => ({
      ...section,
      items: section.items
        .map(item => {
          if (!item) return null;
          const target = deriveTargetForItem(item);
          const source = deriveSourceForItem(item, target);
          return { ...item, target, source };
        })
        .filter(Boolean)
    }));

    const allNavItems = enrichedSections.flatMap(section => section.items);
    const defaultItem = allNavItems.find(item => item.allowed && !item.href) || allNavItems.find(item => item.allowed);
    const defaultPane = defaultItem ? defaultItem.target : 'overview';
    let activeItem = null;
    if (activePaneId) {
      activeItem = allNavItems.find(item => item.id === activePaneId) || allNavItems.find(item => item.target === activePaneId);
    }
    const activeTarget = activeItem ? activeItem.target : defaultPane;
    const navLinkTargets = new Set(allNavItems.filter(item => item.href).map(item => item.href));

    const navPanels = [];
    const seenTargets = new Set();

    enrichedSections.forEach(section => {
      section.items.forEach(item => {
        if (!item.allowed) return;
        if (!item.target || seenTargets.has(item.target)) return;
        navPanels.push({ target: item.target, href: item.href || null, source: item.source });
        seenTargets.add(item.target);
      });
    });

    const navButtonsHtml = enrichedSections
      .map(section => {
        const itemsHtml = section.items
          .map(item => {
            const classes = ['bo-tab'];
            if (item.id === 'channel-manager') classes.push('bo-tab--compact');
            const isActive = item.target === activeTarget;
            if (isActive) {
              classes.push('is-active');
            }

            const iconMarkup = item.iconSvg
              ? item.iconSvg
              : `<i data-lucide="${item.icon}" class="w-5 h-5" aria-hidden="true"></i>`;

            if (!item.allowed) {
              return `<button type="button" class="${classes.join(' ')}" data-disabled="true" data-bo-target="${escAttr(item.target)}" data-bo-source="${escAttr(item.source)}" id="bo-tab-${escAttr(item.target)}" role="tab" aria-controls="bo-panel-${escAttr(item.target)}" aria-selected="false" aria-disabled="true" title="Sem permissões" disabled>${iconMarkup}<span>${esc(item.label)}</span></button>`;
            }

            const ariaSelected = isActive ? 'true' : 'false';
            return `<button type="button" class="${classes.join(' ')}" data-bo-target="${escAttr(item.target)}" data-bo-source="${escAttr(item.source)}" id="bo-tab-${escAttr(item.target)}" role="tab" aria-controls="bo-panel-${escAttr(item.target)}" aria-selected="${ariaSelected}">${iconMarkup}<span>${esc(item.label)}</span></button>`;
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
            <div class="bo-nav__section-items" data-nav-items id="${sectionItemsId}" role="tablist" hidden>${itemsHtml}</div>
          </div>
        `;
      })
      .filter(Boolean)
      .join('');

    return { navButtonsHtml, navLinkTargets, defaultPane, activeTarget, navPanels };
  }

  function renderBackofficeShell({
    navButtonsHtml,
    mainContent,
    navPanels = [],
    activeTarget = '',
    defaultTarget = '',
    isWide = false
  }) {
    const pageClass = ['bo-page', isWide ? 'bo-page--wide' : ''].filter(Boolean).join(' ');
    const safeActiveTarget = typeof activeTarget === 'string' ? activeTarget : '';
    const safeDefaultTarget = typeof defaultTarget === 'string' && defaultTarget ? defaultTarget : safeActiveTarget;
    const activePanelDescriptor = navPanels.find(panel => panel.target === safeActiveTarget);
    const shouldWrapActiveContent = activePanelDescriptor ? !!activePanelDescriptor.href : true;
    const activePanelSource = activePanelDescriptor ? activePanelDescriptor.source : `/admin?tab=${encodeURIComponent(safeActiveTarget || safeDefaultTarget || 'overview')}`;
    const activePanelHtml = shouldWrapActiveContent
      ? html`
          <section
            id="bo-panel-${safeActiveTarget || 'overview'}"
            class="bo-panel is-active"
            role="tabpanel"
            aria-labelledby="bo-tab-${safeActiveTarget || 'overview'}"
            data-bo-panel-src="${escAttr(activePanelSource)}"
            data-bo-panel-loaded="true"
          >
            ${mainContent}
          </section>
        `
      : mainContent;

    const placeholderPanelsHtml = navPanels
      .filter(panel => panel.target !== safeActiveTarget && panel.href)
      .map(
        panel => `
          <section
            id="bo-panel-${escAttr(panel.target)}"
            class="bo-panel"
            role="tabpanel"
            aria-labelledby="bo-tab-${escAttr(panel.target)}"
            data-bo-panel-src="${escAttr(panel.source)}"
            hidden
          ></section>
        `
      )
      .join('');

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
            <div class="bo-panels" data-bo-panels data-active-target="${escAttr(safeActiveTarget)}" data-default-target="${escAttr(safeDefaultTarget)}">
              ${activePanelHtml}
              ${placeholderPanelsHtml}
            </div>
          </div>
        </div>
      </div>
      <script>${inlineScript(tabsScriptSource)}</script>
    `;
  }

  return { buildBackofficeNavigation, renderBackofficeShell };
}

module.exports = { createBackofficeLayoutHelpers };
