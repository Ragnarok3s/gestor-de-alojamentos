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

const THEME_KEYS = Object.keys(defaultTheme);

const createTheme = (overrides = {}) => {
  if (!overrides || typeof overrides !== "object") {
    return { ...defaultTheme };
  }

  const nextTheme = { ...defaultTheme };
  THEME_KEYS.forEach((key) => {
    const value = overrides[key];
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    nextTheme[key] = trimmed;
  });

  return nextTheme;
};

module.exports = {
  defaultTheme,
  createTheme,
  THEME_KEYS
};

// Provide ES module compatibility for tooling that relies on named exports.
exports.defaultTheme = defaultTheme;
exports.createTheme = createTheme;
exports.THEME_KEYS = THEME_KEYS;
