export const BoRoutes = {
  overview: { url: "/admin/overview", selector: "#app-main, main, #content, body" },
  calendar: { url: "/admin/calendar", selector: "#app-main, main, #calendar-root" },
  bookings: { url: "/admin/bookings", selector: "#app-main, #bookings-root, main" },
  limpeza: { url: "/admin/limpeza", selector: "#app-main, #cleaning-root, main" },
  extras: { url: "/admin/extras", selector: "#app-main, #extras-root, main" },
  "content-center": { url: "/admin/content-center", selector: "#app-main, #content-center-root, main" },
  "channel-manager": { url: "/admin/channel-manager", selector: "#app-main, #channel-root, main" },
  // TODO: adicionar restantes entradas do menu principal com o selector correto.
};

if (typeof window !== "undefined") {
  window.BoRoutes = BoRoutes;
}
