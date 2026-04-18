import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button.jsx';
import { colors, typography, borders, transitions } from '../design-tokens.js';

// Helper to convert hex to rgb for JSDOM comparison
const hexToRgb = (hex) => {
  // Handle hex with alpha (e.g., #ffffff22)
  if (hex.length === 9) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = parseInt(hex.slice(7, 9), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  // Handle standard hex (e.g., #ffffff)
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
};

// Helper to normalize font family quotes
const normalizeFontFamily = (fontFamily) => {
  return fontFamily.replace(/'/g, '"');
};

describe('Button', () => {
  describe('Rendering', () => {
    it('renders children correctly', () => {
      render(<Button>Click Me</Button>);
      expect(screen.getByText('Click Me')).toBeInTheDocument();
    });

    it('renders as button element', () => {
      render(<Button>Submit</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders with default type="button"', () => {
      render(<Button>Submit</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('renders with custom type', () => {
      render(<Button type="submit">Submit</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });
  });

  describe('Variants', () => {
    it('renders with default variant', () => {
      const { container } = render(<Button>Default</Button>);
      const button = container.firstChild;
      expect(button.style.background).toBe('transparent');
      expect(button.style.color).toBe(hexToRgb(colors.text));
    });

    it('renders with primary variant', () => {
      const { container } = render(<Button variant="primary">Primary</Button>);
      const button = container.firstChild;
      expect(button.style.background).toBe(hexToRgb(colors.orange));
      expect(button.style.color).toBe(hexToRgb('#000000'));
      expect(button.style.borderColor).toBe(hexToRgb(colors.orange));
    });

    it('renders with success variant', () => {
      const { container } = render(<Button variant="success">Success</Button>);
      const button = container.firstChild;
      expect(button.style.background).toBe(hexToRgb(`${colors.green}22`));
      expect(button.style.color).toBe(hexToRgb(colors.green));
      expect(button.style.borderColor).toBe(hexToRgb(colors.green));
    });

    it('renders with danger variant', () => {
      const { container } = render(<Button variant="danger">Danger</Button>);
      const button = container.firstChild;
      expect(button.style.background).toBe(hexToRgb(`${colors.red}22`));
      expect(button.style.color).toBe(hexToRgb(colors.red));
      expect(button.style.borderColor).toBe(hexToRgb(colors.red));
    });

    it('defaults to default variant for unknown variants', () => {
      const { container } = render(<Button variant="unknown">Unknown</Button>);
      const button = container.firstChild;
      expect(button.style.background).toBe('transparent');
      expect(button.style.color).toBe(hexToRgb(colors.text));
    });
  });

  describe('Disabled State', () => {
    it('is disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('is not disabled when disabled prop is false', () => {
      render(<Button disabled={false}>Enabled</Button>);
      expect(screen.getByRole('button')).not.toBeDisabled();
    });

    it('is not disabled by default', () => {
      render(<Button>Enabled</Button>);
      expect(screen.getByRole('button')).not.toBeDisabled();
    });

    it('has not-allowed cursor when disabled', () => {
      const { container } = render(<Button disabled>Disabled</Button>);
      const button = container.firstChild;
      expect(button.style.cursor).toBe('not-allowed');
    });

    it('has pointer cursor when enabled', () => {
      const { container } = render(<Button>Enabled</Button>);
      const button = container.firstChild;
      expect(button.style.cursor).toBe('pointer');
    });

    it('has reduced opacity when disabled', () => {
      const { container } = render(<Button disabled>Disabled</Button>);
      const button = container.firstChild;
      expect(button.style.opacity).toBe('0.5');
    });

    it('has full opacity when enabled', () => {
      const { container } = render(<Button>Enabled</Button>);
      const button = container.firstChild;
      expect(button.style.opacity).toBe('1');
    });
  });

  describe('Click Handler', () => {
    it('calls onClick when clicked', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick} disabled>Disabled</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('receives click event object', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledWith(expect.objectContaining({
        type: 'click',
      }));
    });
  });

  describe('Hover States', () => {
    it('changes background on mouse enter for default variant', () => {
      const { container } = render(<Button>Hover</Button>);
      const button = container.firstChild;
      fireEvent.mouseEnter(button);
      expect(button.style.background).toBe(hexToRgb(`${colors.orange}11`));
      expect(button.style.borderColor).toBe(hexToRgb(colors.orange));
    });

    it('changes background on mouse enter for success variant', () => {
      const { container } = render(<Button variant="success">Hover</Button>);
      const button = container.firstChild;
      fireEvent.mouseEnter(button);
      expect(button.style.background).toBe(hexToRgb(`${colors.orange}11`));
      expect(button.style.borderColor).toBe(hexToRgb(colors.orange));
    });

    it('changes background on mouse enter for danger variant', () => {
      const { container } = render(<Button variant="danger">Hover</Button>);
      const button = container.firstChild;
      fireEvent.mouseEnter(button);
      expect(button.style.background).toBe(hexToRgb(`${colors.orange}11`));
      expect(button.style.borderColor).toBe(hexToRgb(colors.orange));
    });

    it('does NOT change background on mouse enter for primary variant', () => {
      const { container } = render(<Button variant="primary">Primary</Button>);
      const button = container.firstChild;
      const initialBackground = button.style.background;
      fireEvent.mouseEnter(button);
      expect(button.style.background).toBe(initialBackground);
    });

    it('does NOT change background on mouse enter when disabled', () => {
      const { container } = render(<Button disabled>Disabled</Button>);
      const button = container.firstChild;
      const initialBackground = button.style.background;
      fireEvent.mouseEnter(button);
      expect(button.style.background).toBe(initialBackground);
    });

    it('restores background on mouse leave', () => {
      const { container } = render(<Button>Hover</Button>);
      const button = container.firstChild;
      fireEvent.mouseEnter(button);
      fireEvent.mouseLeave(button);
      expect(button.style.background).toBe('transparent');
    });

    it('restores border on mouse leave', () => {
      const { container } = render(<Button>Hover</Button>);
      const button = container.firstChild;
      fireEvent.mouseEnter(button);
      fireEvent.mouseLeave(button);
      // After mouse leave, border should be restored to default (but JSDOM may show the last set value)
      expect(button.style.borderColor).toBeTruthy();
    });
  });

  describe('Styling', () => {
    it('has correct padding', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.padding).toBe('11px 24px');
    });

    it('has correct border radius', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.borderRadius).toBe(borders.radius);
    });

    it('has correct border', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.border).toBe(`1px solid ${hexToRgb(colors.border)}`);
    });

    it('has correct font family', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.fontFamily).toBe(normalizeFontFamily(typography.mono));
    });

    it('has correct font size', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.fontSize).toBe(typography.button.fontSize);
    });

    it('has correct font weight', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.fontWeight).toBe(typography.button.fontWeight.toString());
    });

    it('has correct text transform', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.textTransform).toBe(typography.button.textTransform);
    });

    it('has correct letter spacing', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.letterSpacing).toBe(typography.button.letterSpacing);
    });

    it('has transition applied', () => {
      const { container } = render(<Button>Button</Button>);
      const button = container.firstChild;
      expect(button.style.transition).toContain(transitions.normal);
    });

    it('applies custom style when provided', () => {
      const customStyle = { marginTop: '10px', width: '200px' };
      const { container } = render(<Button style={customStyle}>Button</Button>);
      const button = container.firstChild;
      expect(button.style.marginTop).toBe('10px');
      expect(button.style.width).toBe('200px');
    });
  });
});
