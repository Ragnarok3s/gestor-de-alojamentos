const FEATURE_ICONS = {
  bed: 'Camas',
  kitchen: 'Kitchenette',
  ac: 'Ar condicionado',
  bath: 'Casa de banho',
  wifi: 'Wi-Fi',
  pool: 'Piscina',
  car: 'Estacionamento',
  coffee: 'Café',
  sun: 'Terraço',
};

const FEATURE_ICON_KEYS = Object.keys(FEATURE_ICONS);

function parseFeaturesInput(raw) {
  if (!raw) return [];
  const iconRegex = /^[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?$/i;
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let icon = null;
      let label = '';
      const pipeParts = line.split('|');
      if (pipeParts.length > 1) {
        const candidate = pipeParts.shift().trim();
        if (iconRegex.test(candidate)) {
          icon = candidate.toLowerCase();
        } else {
          pipeParts.unshift(candidate);
        }
        label = pipeParts.join('|').trim();
      } else {
        const tokens = line.split(/\s+/).filter(Boolean);
        if (tokens.length === 1 && iconRegex.test(tokens[0])) {
          icon = tokens[0].toLowerCase();
        } else if (tokens.length > 1 && iconRegex.test(tokens[0])) {
          icon = tokens.shift().toLowerCase();
          label = tokens.join(' ').trim();
        } else {
          label = line;
        }
      }
      if (!icon && !label) return null;
      return { icon: icon || null, label };
    })
    .filter(Boolean);
}

function normalizeFeature(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const parsed = parseFeaturesInput(entry);
    return parsed.length ? parsed[0] : null;
  }
  let icon = entry.icon ?? entry.type ?? null;
  let label = entry.label ?? entry.text ?? '';
  icon = icon ? String(icon).trim().toLowerCase() : null;
  label = label ? String(label).trim() : '';
  if (!label) return null;
  return { icon: icon || null, label };
}

function parseFeaturesStored(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeFeature).filter(Boolean);
  const str = String(raw).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed.map(normalizeFeature).filter(Boolean);
  } catch (_) {
    // noop
  }
  return parseFeaturesInput(str);
}

function featuresToTextarea(raw) {
  return parseFeaturesStored(raw)
    .map((f) => {
      const icon = f.icon ? String(f.icon).toLowerCase() : '';
      const label = f.label ? String(f.label) : '';
      if (icon && label) return `${icon}|${label}`;
      if (icon) return icon;
      return label;
    })
    .join('\n');
}

function featureChipsHtml(features, opts = {}) {
  const items = Array.isArray(features)
    ? features.map(normalizeFeature).filter(Boolean)
    : parseFeaturesStored(features);
  if (!items.length) return '';
  const className = opts.className || 'flex flex-wrap gap-2 text-xs text-slate-600';
  const badgeClass = opts.badgeClass || 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full';
  const iconWrap = opts.iconWrapClass || 'inline-flex items-center justify-center text-emerald-700';
  const parts = items
    .map((f) => {
      const key = f.icon ? String(f.icon).toLowerCase() : '';
      const fallback = FEATURE_ICONS[key] || key.replace(/[-_]/g, ' ');
      const label = f.label
        ? f.label.replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          }[ch]))
        : fallback.replace(/\b\w/g, (c) => c.toUpperCase());
      const iconHtml = key ? `<span class="${iconWrap}"><i data-lucide="${key}" class="w-4 h-4"></i></span>` : '';
      const labelHtml = label ? `<span>${label}</span>` : '';
      if (!iconHtml && !labelHtml) return '';
      return `<span class="${badgeClass}">${iconHtml}${labelHtml}</span>`;
    })
    .filter(Boolean);
  if (!parts.length) return '';
  return `<div class="${className}">${parts.join('')}</div>`;
}

module.exports = {
  FEATURE_ICONS,
  FEATURE_ICON_KEYS,
  parseFeaturesInput,
  parseFeaturesStored,
  featuresToTextarea,
  featureChipsHtml,
  normalizeFeature,
};
