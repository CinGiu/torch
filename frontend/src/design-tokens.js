export const factorioTheme = {
  colors: {
    bg: '#1a1a1a',
    bgSecondary: '#1f1f1f',
    surface: '#242424',
    surfaceDark: '#2d2d2d',
    input: '#1a1a1a',
    border: '#3d3d3d',
    borderHover: '#5a5a5a',
    borderFocus: '#ff9800',
    text: '#e0e0e0',
    textMuted: '#9e9e9e',
    textDim: '#6e6e6e',
    textHeader: '#ffffff',
    orange: '#ff9800',
    orangeLight: '#ffb74d',
    orangeDark: '#f57c00',
    green: '#4caf50',
    greenLight: '#81c784',
    red: '#f44336',
    redLight: '#e57373',
    cyan: '#26c6da',
    success: '#4caf50',
    warning: '#ff9800',
    error: '#f44336',
    info: '#26c6da',
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  
  borders: {
    default: '1px solid #3d3d3d',
    top: '2px solid #ff9800',
    focus: '1px solid #ff9800',
    radius: '2px',
    radiusLg: '4px',
  },
  
  typography: {
    sans: "'Inter', sans-serif",
    mono: "'JetBrains Mono', monospace",
    
    header: {
      fontSize: '13px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
    },
    
    label: {
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
    
    input: {
      fontSize: '13px',
      fontFamily: "'JetBrains Mono', monospace",
    },
    
    button: {
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
  },
  
  shadows: {
    panel: '0 2px 8px rgba(0, 0, 0, 0.4)',
    hover: '0 4px 16px rgba(0, 0, 0, 0.5)',
  },
  
  transitions: {
    fast: '0.1s',
    normal: '0.2s',
    slow: '0.3s',
  },
};

export const { colors, spacing, borders, typography, shadows, transitions } = factorioTheme;
