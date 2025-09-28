const fs = require('fs');
const file = 'server.js';
let text = fs.readFileSync(file, 'utf8');
const replacements = new Map([
  [`Booking Engine ? Front + Backoffice + Auth + Mapa (mensal)`, `Booking Engine — Front + Backoffice + Auth + Mapa (mensal)`],
  [`exporta??o`, `exportação`],
  [`calend?rio`, `calendário`],
  [`inclu?do`, `incluído`],
  [`Migra??es`, `Migrações`],
  [`Caf?`, `Café`],
  [`Terra?o`, `Terraço`],
  [`Caracter?sticas`, `Características`],
  [`s? o nome`, `só o nome`],
  [`?cone`, `ícone`],
  [`?cones`, `Ícones`],
  [`dispon?veis`, `disponíveis`],
  [`${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
        ? ${adults} adulto(s)`, `${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
        · ${adults} adulto(s)`],
  [`${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
        ? ${adults} adulto(s)`, `${dayjs(checkin).format('DD/MM/YYYY')} &rarr; ${dayjs(checkout).format('DD/MM/YYYY')}
        · ${adults} adulto(s)`],
  [`${u.property_name} ? ${u.name}`, `${u.property_name} – ${u.name}`],
  [`${b.property_name} ? ${b.unit_name}`, `${b.property_name} – ${b.unit_name}`],
  [`${b.guest_phone||'-'} ? ${b.guest_email}`, `${b.guest_phone||'-'} · ${b.guest_email}`],
  [`${dayjs(b.checkin).format('DD/MM')}?${dayjs(b.checkout).format('DD/MM')}`, `${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}`],
  [`${dayjs(b.checkin).format('DD/MM')}?${dayjs(b.checkout).format('DD/MM')}`, `${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}`],
  [`${dayjs(b.checkin).format('DD/MM')}?${dayjs(b.checkout).format('DD/MM')}`, `${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}`],
  [`${dayjs(b.checkin).format('DD/MM')}?${dayjs(b.checkout).format('DD/MM')}`, `${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}`],
  [`? ${eur(b.total_cents)}`, `€ ${eur(b.total_cents)}`],
  [`Quantos meses (1?12)`, `Quantos meses (1–12)`],
  [`Base ?/noite`, `Base €/noite`],
  [`Preço base ?/noite`, `Preço base €/noite`],
  [`Preço ?/noite`, `Preço €/noite`],
  [`${u.property_name} ? ${u.name}`, `${u.property_name} – ${u.name}`],
  [`${u.property_name} ? ${u.name}`, `${u.property_name} – ${u.name}`],
  [`${b.property_name} ? ${b.unit_name}`, `${b.property_name} – ${b.unit_name}`],
  [`${b.guest_phone||'-'} ? ${b.guest_email}`, `${b.guest_phone||'-'} · ${b.guest_email}`],
  [`${dayjs(b.checkin).format('DD/MM')}?${dayjs(b.checkout).format('DD/MM')}`, `${dayjs(b.checkin).format('DD/MM')} &rarr; ${dayjs(b.checkout).format('DD/MM')}`],
  [`? ${eur(b.total_cents)}`, `€ ${eur(b.total_cents)}`],
]);

let changed = false;
for (const [from, to] of replacements) {
  if (text.includes(from)) {
    text = text.split(from).join(to);
    changed = true;
  }
}
if (!changed) {
  console.warn('No replacements applied');
}
fs.writeFileSync(file, text, 'utf8');
