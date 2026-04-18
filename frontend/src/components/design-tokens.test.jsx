import {
  factorioTheme,
  colors,
  spacing,
  borders,
  typography,
  shadows,
  transitions,
} from '../design-tokens.js';

describe('Design Tokens', () => {
  describe('factorioTheme', () => {
    it('exports factorioTheme object', () => {
      expect(factorioTheme).toBeDefined();
      expect(typeof factorioTheme).toBe('object');
    });

    it('has colors property', () => {
      expect(factorioTheme.colors).toBeDefined();
      expect(typeof factorioTheme.colors).toBe('object');
    });

    it('has spacing property', () => {
      expect(factorioTheme.spacing).toBeDefined();
      expect(typeof factorioTheme.spacing).toBe('object');
    });

    it('has borders property', () => {
      expect(factorioTheme.borders).toBeDefined();
      expect(typeof factorioTheme.borders).toBe('object');
    });

    it('has typography property', () => {
      expect(factorioTheme.typography).toBeDefined();
      expect(typeof factorioTheme.typography).toBe('object');
    });

    it('has shadows property', () => {
      expect(factorioTheme.shadows).toBeDefined();
      expect(typeof factorioTheme.shadows).toBe('object');
    });

    it('has transitions property', () => {
      expect(factorioTheme.transitions).toBeDefined();
      expect(typeof factorioTheme.transitions).toBe('object');
    });
  });

  describe('Colors', () => {
    it('exports colors object', () => {
      expect(colors).toBeDefined();
      expect(typeof colors).toBe('object');
    });

    it('has background colors', () => {
      expect(colors.bg).toBeDefined();
      expect(colors.bgSecondary).toBeDefined();
      expect(colors.surface).toBeDefined();
      expect(colors.surfaceDark).toBeDefined();
      expect(colors.input).toBeDefined();
    });

    it('has border colors', () => {
      expect(colors.border).toBeDefined();
      expect(colors.borderHover).toBeDefined();
      expect(colors.borderFocus).toBeDefined();
    });

    it('has text colors', () => {
      expect(colors.text).toBeDefined();
      expect(colors.textMuted).toBeDefined();
      expect(colors.textDim).toBeDefined();
      expect(colors.textHeader).toBeDefined();
    });

    it('has orange colors', () => {
      expect(colors.orange).toBeDefined();
      expect(colors.orangeLight).toBeDefined();
      expect(colors.orangeDark).toBeDefined();
    });

    it('has green colors', () => {
      expect(colors.green).toBeDefined();
      expect(colors.greenLight).toBeDefined();
    });

    it('has red colors', () => {
      expect(colors.red).toBeDefined();
      expect(colors.redLight).toBeDefined();
    });

    it('has cyan color', () => {
      expect(colors.cyan).toBeDefined();
    });

    it('has semantic colors', () => {
      expect(colors.success).toBeDefined();
      expect(colors.warning).toBeDefined();
      expect(colors.error).toBeDefined();
      expect(colors.info).toBeDefined();
    });

    it('all color values are strings', () => {
      Object.values(colors).forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });

    it('hex colors are valid format', () => {
      Object.values(colors).forEach((value) => {
        // Allow hex colors with optional alpha (e.g., #fff, #ffffff, #ffffff22)
        expect(value).toMatch(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
      });
    });
  });

  describe('Spacing', () => {
    it('exports spacing object', () => {
      expect(spacing).toBeDefined();
      expect(typeof spacing).toBe('object');
    });

    it('has all spacing values', () => {
      expect(spacing.xs).toBeDefined();
      expect(spacing.sm).toBeDefined();
      expect(spacing.md).toBeDefined();
      expect(spacing.lg).toBeDefined();
      expect(spacing.xl).toBeDefined();
      expect(spacing.xxl).toBeDefined();
    });

    it('all spacing values are numbers', () => {
      Object.values(spacing).forEach((value) => {
        expect(typeof value).toBe('number');
      });
    });

    it('spacing values are in ascending order', () => {
      expect(spacing.xs).toBeLessThan(spacing.sm);
      expect(spacing.sm).toBeLessThan(spacing.md);
      expect(spacing.md).toBeLessThan(spacing.lg);
      expect(spacing.lg).toBeLessThan(spacing.xl);
      expect(spacing.xl).toBeLessThan(spacing.xxl);
    });

    it('xs spacing is 4', () => {
      expect(spacing.xs).toBe(4);
    });

    it('sm spacing is 8', () => {
      expect(spacing.sm).toBe(8);
    });

    it('md spacing is 12', () => {
      expect(spacing.md).toBe(12);
    });

    it('lg spacing is 16', () => {
      expect(spacing.lg).toBe(16);
    });

    it('xl spacing is 24', () => {
      expect(spacing.xl).toBe(24);
    });

    it('xxl spacing is 32', () => {
      expect(spacing.xxl).toBe(32);
    });
  });

  describe('Borders', () => {
    it('exports borders object', () => {
      expect(borders).toBeDefined();
      expect(typeof borders).toBe('object');
    });

    it('has all border values', () => {
      expect(borders.default).toBeDefined();
      expect(borders.top).toBeDefined();
      expect(borders.focus).toBeDefined();
      expect(borders.radius).toBeDefined();
      expect(borders.radiusLg).toBeDefined();
    });

    it('all border values are strings', () => {
      Object.values(borders).forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });

    it('default border is correct', () => {
      expect(borders.default).toBe('1px solid #3d3d3d');
    });

    it('top border is correct', () => {
      expect(borders.top).toBe('2px solid #ff9800');
    });

    it('focus border is correct', () => {
      expect(borders.focus).toBe('1px solid #ff9800');
    });

    it('border radius is correct', () => {
      expect(borders.radius).toBe('2px');
    });

    it('border radius lg is correct', () => {
      expect(borders.radiusLg).toBe('4px');
    });
  });

  describe('Typography', () => {
    it('exports typography object', () => {
      expect(typography).toBeDefined();
      expect(typeof typography).toBe('object');
    });

    it('has font families', () => {
      expect(typography.sans).toBeDefined();
      expect(typography.mono).toBeDefined();
    });

    it('has header styles', () => {
      expect(typography.header).toBeDefined();
      expect(typography.header.fontSize).toBeDefined();
      expect(typography.header.fontWeight).toBeDefined();
      expect(typography.header.textTransform).toBeDefined();
      expect(typography.header.letterSpacing).toBeDefined();
    });

    it('has label styles', () => {
      expect(typography.label).toBeDefined();
      expect(typography.label.fontSize).toBeDefined();
      expect(typography.label.fontWeight).toBeDefined();
      expect(typography.label.textTransform).toBeDefined();
      expect(typography.label.letterSpacing).toBeDefined();
    });

    it('has input styles', () => {
      expect(typography.input).toBeDefined();
      expect(typography.input.fontSize).toBeDefined();
    });

    it('has button styles', () => {
      expect(typography.button).toBeDefined();
      expect(typography.button.fontSize).toBeDefined();
      expect(typography.button.fontWeight).toBeDefined();
      expect(typography.button.textTransform).toBeDefined();
      expect(typography.button.letterSpacing).toBeDefined();
    });

    it('sans font is Inter', () => {
      expect(typography.sans).toContain('Inter');
    });

    it('mono font is JetBrains Mono', () => {
      expect(typography.mono).toContain('JetBrains Mono');
    });

    it('header has uppercase text transform', () => {
      expect(typography.header.textTransform).toBe('uppercase');
    });

    it('label has uppercase text transform', () => {
      expect(typography.label.textTransform).toBe('uppercase');
    });

    it('button has uppercase text transform', () => {
      expect(typography.button.textTransform).toBe('uppercase');
    });
  });

  describe('Shadows', () => {
    it('exports shadows object', () => {
      expect(shadows).toBeDefined();
      expect(typeof shadows).toBe('object');
    });

    it('has panel shadow', () => {
      expect(shadows.panel).toBeDefined();
    });

    it('has hover shadow', () => {
      expect(shadows.hover).toBeDefined();
    });

    it('all shadow values are strings', () => {
      Object.values(shadows).forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });

    it('panel shadow is correct', () => {
      expect(shadows.panel).toBe('0 2px 8px rgba(0, 0, 0, 0.4)');
    });

    it('hover shadow is correct', () => {
      expect(shadows.hover).toBe('0 4px 16px rgba(0, 0, 0, 0.5)');
    });
  });

  describe('Transitions', () => {
    it('exports transitions object', () => {
      expect(transitions).toBeDefined();
      expect(typeof transitions).toBe('object');
    });

    it('has all transition values', () => {
      expect(transitions.fast).toBeDefined();
      expect(transitions.normal).toBeDefined();
      expect(transitions.slow).toBeDefined();
    });

    it('all transition values are strings', () => {
      Object.values(transitions).forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });

    it('fast transition is correct', () => {
      expect(transitions.fast).toBe('0.1s');
    });

    it('normal transition is correct', () => {
      expect(transitions.normal).toBe('0.2s');
    });

    it('slow transition is correct', () => {
      expect(transitions.slow).toBe('0.3s');
    });
  });

  describe('Named Exports', () => {
    it('exports colors from factorioTheme', () => {
      expect(colors).toBe(factorioTheme.colors);
    });

    it('exports spacing from factorioTheme', () => {
      expect(spacing).toBe(factorioTheme.spacing);
    });

    it('exports borders from factorioTheme', () => {
      expect(borders).toBe(factorioTheme.borders);
    });

    it('exports typography from factorioTheme', () => {
      expect(typography).toBe(factorioTheme.typography);
    });

    it('exports shadows from factorioTheme', () => {
      expect(shadows).toBe(factorioTheme.shadows);
    });

    it('exports transitions from factorioTheme', () => {
      expect(transitions).toBe(factorioTheme.transitions);
    });
  });
});
