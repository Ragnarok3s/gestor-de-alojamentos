const { defaultTheme, createTheme } = require('../../../src/theme/colors');

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
      surface: '#fafafa',
      textPrimary: '#2B2B2B',
      textOnPrimary: '#eeeeee',
      textOnBackground: '#FFDBA0'
    });
  });
});
