export const theme = {
  color: {
    canvas: '#FFFFFF', surface: '#FFFFFF', ink: '#24212D', muted: '#6B6574',
    coral: '#C94F57', primary: '#B6404B', primaryHover: '#9F3440', link: '#8B303E',
    mat: '#FFFFFF', soft: '#FFF3F3', lavenderSoft: '#FFFFFF', coralSoft: '#FFFFFF',
    line: '#E5E2E8', input: '#897F97', focus: '#B6404B',
    success: '#176B4A', successBg: '#E6F4EB', warning: '#875100', warningBg: '#FFF4CD',
    error: '#9F244A', errorBg: '#FFF0F3', demo: '#545068', demoBg: '#ECEAF2',
  },
  radius: { badge: 4, control: 6, card: 0, panel: 8, mat: 0 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, section: 48 },
  breakpoint: { mobile: 640, tablet: 960 },
  motion: { fast: '150ms', standard: '220ms', panel: '280ms', ease: 'cubic-bezier(0.22, 1, 0.36, 1)' },
} as const;
export type AppTheme = typeof theme;
