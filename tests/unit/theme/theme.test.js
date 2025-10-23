const {
  defaultTheme,
  createTheme,
  serializeThemeOverrides,
  parseThemeOverrides
} = require('../../../src/theme/colors');

describe('theme colors', () => {
  it('exports the default theme palette', () => {
    expect(defaultTheme).toStrictEqual({
      primary: '#FF8C42',
      primaryDark: '#E66A32',
      accent: '#C24C30',
      accentDark: '#8C2F2B',
      background: '#2B2B2B',
      surface: '#FFDBA0',
      textPrimary: '#2B2B2B',
      textOnPrimary: '#FFFFFF',
      textOnBackground: '#FFDBA0'
    });
  });

  it('allows overriding individual tokens', () => {
    const customTheme = createTheme({
      primary: '#111111',
      surface: '#fafafa',
      textOnPrimary: '#eeeeee'
    });

    expect(customTheme).toStrictEqual({
      primary: '#111111',
      primaryDark: '#E66A32',
      accent: '#C24C30',
      accentDark: '#8C2F2B',
      background: '#2B2B2B',
      surface: '#FAFAFA',
      textPrimary: '#2B2B2B',
      textOnPrimary: '#EEEEEE',
      textOnBackground: '#FFDBA0'
    });
  });

  it('serializes and restores persisted overrides safely', () => {
    const overrides = {
      primary: '#123456',
      background: '#000000'
    };

    const stored = serializeThemeOverrides(overrides);
    expect(typeof stored).toBe('string');

    const parsed = parseThemeOverrides(stored);
    expect(parsed).toStrictEqual({
      primary: '#123456',
      background: '#000000'
    });

    const restoredTheme = createTheme(parsed);
    expect(restoredTheme).toStrictEqual({
      primary: '#123456',
      primaryDark: '#E66A32',
      accent: '#C24C30',
      accentDark: '#8C2F2B',
      background: '#000000',
      surface: '#FFDBA0',
      textPrimary: '#2B2B2B',
      textOnPrimary: '#FFFFFF',
      textOnBackground: '#FFDBA0'
    });
  });
});
