const fs = require("fs");
const file = "server.js";
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
const replacements = new Map([
  [1102, "        <label class=\"text-sm\">Quantos meses (1–12)</label>"],
  [1477, "          <thead><tr class=\"text-left text-slate-500\"><th>Propriedade</th><th>Unidade</th><th>Cap.</th><th>Base €/noite</th><th></th></tr></thead>"],
  [1492, "        <input required type=\"number\" step=\"0.01\" min=\"0\" name=\"base_price_eur\" class=\"input\" placeholder=\"Preço base €/noite\"/>"],
  [1495, "        <div class=\"text-xs text-slate-500 md:col-span-5\">Características (uma por linha). Usa <code>icon|texto</code> (ex.: <code>bed|3 camas</code>) ou só o nome do ícone (ex.: <code>wifi</code>). Ícones Lucide: ${FEATURE_ICON_KEYS.join(', ')}.</div>"],
  [1508, "            <td>${b.property_name} – ${b.unit_name}</td>"],
  [1510, "            <td>${b.guest_phone||'-'} · ${b.guest_email}</td>"],
  [1554, "      <ul class=\"space-y-1\">${bookings.map(b => `<li>${b.unit_name}: ${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')} – ${b.guest_name} (${b.adults}A+${b.children}C)</li>`).join('') || '<em>Sem reservas</em>'}</ul>"],
  [1590, "    title: `${u.property_name} – ${u.name}`,"],
  [1639, "                <input required type=\"number\" step=\"0.01\" min=\"0\" name=\"price_eur\" class=\"input\" placeholder=\"Preço €/noite\"/>"],
  [1663, "        <div class=\"text-xs text-slate-500\">Características: uma por linha em \"icon|texto\" (ex.: bed|3 camas) ou só o ícone (ex.: wifi). Ícones disponíveis: ${FEATURE_ICON_KEYS.join(', ')}.</div>"],
  [1666, "        <div class=\"text-xs text-slate-500\">Características: uma por linha em \"icon|texto\" (ex.: bed|3 camas) ou só o ícone (ex.: wifi). Ícones disponíveis: ${FEATURE_ICON_KEYS.join(', ')}.</div>"],
  [1674, "          <thead><tr class=\"text-left text-slate-500\"><th>De</th><th>Até</th><th>€/noite</th><th>Min</th><th></th></tr></thead>"],
  [1676, "              <td>€ ${eur(r.weekday_price_cents)}</td>"],
  [1679, "              <td>€ ${eur(r.weekday_price_cents)}</td>"],
  [1868, "        <td>€ ${eur(b.total_cents)}</td>"],
  [1871, "        <td>€ ${eur(b.total_cents)}</td>"],
  [1914, "            <li>Total atual: € ${eur(b.total_cents)}</li>"],
  [1917, "            <li>Total atual: € ${eur(b.total_cents)}</li>"]
]);
for (const [idx, value] of replacements) {
  if (lines[idx] !== undefined) {
    lines[idx] = value;
  }
}
fs.writeFileSync(file, lines.join('\n'), "utf8");
