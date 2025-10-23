const defaultTheme = {
  primary: "#FF8C42", // Saffron Fire
  primaryDark: "#E66A32", // Burnt Paprika
  accent: "#C24C30", // Brick Rust
  accentDark: "#8C2F2B", // Deep Maroon
  background: "#2B2B2B", // Carbon
  surface: "#FFDBA0", // Sand Nougat
  textPrimary: "#2B2B2B",
  textOnPrimary: "#FFFFFF",
  textOnBackground: "#FFDBA0"
};

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i;

const THEME_KEYS = Object.keys(defaultTheme);

const normalizeColor = (value) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(HEX_COLOR_PATTERN);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
};

const normalizeThemeOverrides = (overrides = {}) => {
  if (!overrides || typeof overrides !== "object") {
    return {};
  }

  const clean = {};
  THEME_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
      return;
    }
    const normalized = normalizeColor(overrides[key]);
    if (normalized) {
      clean[key] = normalized;
    }
  });
  return clean;
};

const createTheme = (overrides = {}) => ({
  ...defaultTheme,
  ...normalizeThemeOverrides(overrides)
});

const serializeThemeOverrides = (overrides = {}) => {
  const clean = normalizeThemeOverrides(overrides);
  return JSON.stringify(clean);
};

const parseThemeOverrides = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeThemeOverrides(parsed);
    } catch (err) {
      return {};
    }
  }
  if (typeof value === "object") {
    return normalizeThemeOverrides(value);
  }
  return {};
};

module.exports = {
  defaultTheme,
  createTheme,
  THEME_KEYS,
  normalizeThemeOverrides,
  serializeThemeOverrides,
  parseThemeOverrides
};

// Provide ES module compatibility for tooling that relies on named exports.
exports.defaultTheme = defaultTheme;
exports.createTheme = createTheme;
exports.THEME_KEYS = THEME_KEYS;
exports.normalizeThemeOverrides = normalizeThemeOverrides;
exports.serializeThemeOverrides = serializeThemeOverrides;
exports.parseThemeOverrides = parseThemeOverrides;
