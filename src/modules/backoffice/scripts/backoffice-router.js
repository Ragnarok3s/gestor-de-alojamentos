(function (global) {
  if (typeof global === 'undefined') return;

  var routes = {
    overview: { url: '/admin?tab=overview', selector: '#bo-panel-overview' },
    calendar: { url: '/admin?tab=calendar', selector: '#bo-panel-calendar' },
    bookings: { url: '/admin/bookings', selector: '#bo-panel-bookings' },
    housekeeping: { url: '/admin?tab=housekeeping', selector: '#bo-panel-housekeeping' },
    limpeza: { url: '/admin/limpeza', selector: '#bo-panel-limpeza' },
    extras: { url: '/admin/extras', selector: '#bo-panel-extras' },
    'channel-manager': { url: '/admin?tab=channel-manager', selector: '#bo-panel-channel-manager' },
    'content-center': { url: '/admin/content-center', selector: '#bo-panel-content-center' },
    finance: { url: '/admin?tab=finance', selector: '#bo-panel-finance' },
    'revenue-calendar': { url: '/admin/revenue-calendar', selector: '#bo-panel-revenue-calendar' },
    export: { url: '/admin/export', selector: '#bo-panel-export' },
    rules: { url: '/admin/rates/rules', selector: '#bo-panel-rules' },
    estatisticas: { url: '/admin?tab=estatisticas', selector: '#bo-panel-estatisticas' },
    reviews: { url: '/admin?tab=reviews', selector: '#bo-panel-reviews' },
    emails: { url: '/admin?tab=emails', selector: '#bo-panel-emails' },
    messages: { url: '/admin?tab=messages', selector: '#bo-panel-messages' },
    history: { url: '/admin?tab=history', selector: '#bo-panel-history' },
    branding: { url: '/admin?tab=branding', selector: '#bo-panel-branding' },
    users: { url: '/admin?tab=users', selector: '#bo-panel-users' },
    auditoria: { url: '/admin/auditoria', selector: '#bo-panel-auditoria' }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports.BoRoutes = routes;
  }

  global.BoRoutes = routes;
})(typeof window !== 'undefined' ? window : globalThis);
