export const BoRoutes = {
  overview: { url: "/admin?tab=overview", selector: "#app-main, main, #content, body" },
  calendar: { url: "/admin?tab=calendar", selector: "#app-main, main, #content, body" },
  bookings: { url: "/admin/bookings", selector: "#app-main, #bookings-root, main" },
  housekeeping: { url: "/admin?tab=housekeeping", selector: "#app-main, main, #content, body" },
  limpeza: { url: "/admin/limpeza", selector: "#app-main, #cleaning-root, main" },
  extras: { url: "/admin/extras", selector: "#app-main, #extras-root, main" },
  "content-center": { url: "/admin/content-center", selector: "#app-main, #content-center-root, main" },
  "channel-manager": { url: "/admin?tab=channel-manager", selector: "#app-main, main, #content, body" },
  finance: { url: "/admin?tab=finance", selector: "#app-main, main, #content, body" },
  "revenue-calendar": { url: "/admin/revenue-calendar", selector: "#app-main, main, #content, body" },
  export: { url: "/admin/export", selector: "#app-main, main, #content, body" },
  rules: { url: "/admin/rates/rules", selector: "#app-main, main, #content, body" },
  estatisticas: { url: "/admin?tab=estatisticas", selector: "#app-main, main, #content, body" },
  reviews: { url: "/admin?tab=reviews", selector: "#app-main, main, #content, body" },
  emails: { url: "/admin?tab=emails", selector: "#app-main, main, #content, body" },
  messages: { url: "/admin?tab=messages", selector: "#app-main, main, #content, body" },
  history: { url: "/admin?tab=history", selector: "#app-main, main, #content, body" },
  branding: { url: "/admin/identidade-visual", selector: "#app-main, main, #content, body" },
  users: { url: "/admin/utilizadores", selector: "#app-main, main, #content, body" },
  auditoria: { url: "/admin/auditoria", selector: "#app-main, main, #content, body" }
};

if (typeof window !== "undefined") {
  window.BoRoutes = BoRoutes;
}
