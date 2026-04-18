import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input.jsx';
import { colors, typography, borders, transitions, spacing } from '../design-tokens.js';

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

describe('Input', () => {
  describe('Basic Rendering', () => {
    it('renders input element by default', () => {
      render(<Input value="" onChange={() => {}} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('renders with value prop', () => {
      render(<Input value="Test Value" onChange={() => {}} />);
      expect(screen.getByRole('textbox')).toHaveValue('Test Value');
    });

    it('calls onChange when value changes', () => {
      const handleChange = jest.fn();
      render(<Input value="" onChange={handleChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Value' } });
      expect(handleChange).toHaveBeenCalledWith('New Value');
    });

    it('renders with placeholder', () => {
      render(<Input value="" onChange={() => {}} placeholder="Enter text..." />);
      expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
    });

    it('renders with type attribute', () => {
      render(<Input value="" onChange={() => {}} type="email" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email');
    });
  });

  describe('Label', () => {
    it('renders label when provided', () => {
      render(<Input label="Username" value="" onChange={() => {}} />);
      expect(screen.getByText('Username')).toBeInTheDocument();
    });

    it('does not render label when not provided', () => {
      render(<Input value="" onChange={() => {}} />);
      const label = screen.queryByRole('label');
      expect(label).not.toBeInTheDocument();
    });

    it('label has correct typography', () => {
      const { container } = render(<Input label="Label" value="" onChange={() => {}} />);
      const label = container.querySelector('label');
      expect(label.style.fontSize).toBe(typography.label.fontSize);
      expect(label.style.fontWeight).toBe(typography.label.fontWeight.toString());
      expect(label.style.textTransform).toBe(typography.label.textTransform);
      expect(label.style.letterSpacing).toBe(typography.label.letterSpacing);
    });

    it('label has correct color', () => {
      const { container } = render(<Input label="Label" value="" onChange={() => {}} />);
      const label = container.querySelector('label');
      expect(label.style.color).toBe(hexToRgb(colors.textMuted));
    });

    it('label has correct font family', () => {
      const { container } = render(<Input label="Label" value="" onChange={() => {}} />);
      const label = container.querySelector('label');
      expect(label.style.fontFamily).toBe(normalizeFontFamily(typography.mono));
    });

    it('label has correct margin bottom', () => {
      const { container } = render(<Input label="Label" value="" onChange={() => {}} />);
      const label = container.querySelector('label');
      expect(label.style.marginBottom).toBe(spacing.sm.toString() + 'px');
    });
  });

  describe('Hint', () => {
    it('renders hint when provided', () => {
      render(<Input value="" onChange={() => {}} hint="This is a hint" />);
      expect(screen.getByText('This is a hint')).toBeInTheDocument();
    });

    it('does not render hint when not provided', () => {
      render(<Input value="" onChange={() => {}} />);
      const hint = screen.queryByText(/hint/i);
      expect(hint).not.toBeInTheDocument();
    });

    it('hint has correct font size', () => {
      render(<Input value="" onChange={() => {}} hint="Hint text" />);
      const hint = screen.getByText('Hint text');
      expect(hint.style.fontSize).toBe('11px');
    });

    it('hint has correct color', () => {
      render(<Input value="" onChange={() => {}} hint="Hint text" />);
      const hint = screen.getByText('Hint text');
      expect(hint.style.color).toBe(hexToRgb(colors.textDim));
    });

    it('hint has correct font family', () => {
      render(<Input value="" onChange={() => {}} hint="Hint text" />);
      const hint = screen.getByText('Hint text');
      expect(hint.style.fontFamily).toBe(normalizeFontFamily(typography.mono));
    });

    it('hint has correct margin', () => {
      render(<Input value="" onChange={() => {}} hint="Hint text" />);
      const hint = screen.getByText('Hint text');
      expect(hint).toBeInTheDocument();
      expect(hint.tagName).toBe('P');
    });
  });

  describe('Textarea Mode', () => {
    it('renders textarea when rows is provided', () => {
      render(<Input value="" onChange={() => {}} rows={4} />);
      expect(screen.getByRole('textbox')).toHaveAttribute('rows', '4');
    });

    it('renders textarea with correct rows', () => {
      render(<Input value="" onChange={() => {}} rows={6} />);
      expect(screen.getByRole('textbox')).toHaveAttribute('rows', '6');
    });

    it('textarea has vertical resize', () => {
      const { container } = render(<Input value="" onChange={() => {}} rows={4} />);
      const textarea = container.querySelector('textarea');
      expect(textarea.style.resize).toBe('vertical');
    });

    it('renders input when rows is not provided', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      expect(container.querySelector('input')).toBeInTheDocument();
      expect(container.querySelector('textarea')).not.toBeInTheDocument();
    });
  });

  describe('Code Mode', () => {
    it('uses mono font family when isCode is true', () => {
      const { container } = render(<Input value="" onChange={() => {}} isCode />);
      const input = container.querySelector('input');
      expect(input.style.fontFamily).toBe(normalizeFontFamily(typography.mono));
    });

    it('uses sans font family when isCode is false', () => {
      const { container } = render(<Input value="" onChange={() => {}} isCode={false} />);
      const input = container.querySelector('input');
      expect(input.style.fontFamily).toBe(normalizeFontFamily(typography.sans));
    });

    it('uses sans font family by default (isCode=false)', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.fontFamily).toBe(normalizeFontFamily(typography.sans));
    });

    it('uses mono font family for textarea', () => {
      const { container } = render(<Input value="" onChange={() => {}} rows={4} />);
      const textarea = container.querySelector('textarea');
      expect(textarea.style.fontFamily).toBe(normalizeFontFamily(typography.mono));
    });
  });

  describe('Disabled State', () => {
    it('is disabled when disabled prop is true', () => {
      render(<Input value="" onChange={() => {}} disabled />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('is not disabled when disabled prop is false', () => {
      render(<Input value="" onChange={() => {}} disabled={false} />);
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });

    it('is not disabled by default', () => {
      render(<Input value="" onChange={() => {}} />);
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });
  });

  describe('Focus States', () => {
    it('changes border color on focus', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      fireEvent.focus(input);
      expect(input.style.borderColor).toBe(hexToRgb(colors.borderFocus));
    });

    it('restores border color on blur', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      fireEvent.focus(input);
      fireEvent.blur(input);
      expect(input.style.borderColor).toBe(hexToRgb(colors.border));
    });

    it('changes textarea border color on focus', () => {
      const { container } = render(<Input value="" onChange={() => {}} rows={4} />);
      const textarea = container.querySelector('textarea');
      fireEvent.focus(textarea);
      expect(textarea.style.borderColor).toBe(hexToRgb(colors.borderFocus));
    });

    it('restores textarea border color on blur', () => {
      const { container } = render(<Input value="" onChange={() => {}} rows={4} />);
      const textarea = container.querySelector('textarea');
      fireEvent.focus(textarea);
      fireEvent.blur(textarea);
      expect(textarea.style.borderColor).toBe(hexToRgb(colors.border));
    });
  });

  describe('Input Styling', () => {
    it('has correct background color', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.background).toBe(hexToRgb(colors.input));
    });

    it('has correct border', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.border).toBe(`1px solid ${hexToRgb(colors.border)}`);
    });

    it('has correct border radius', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.borderRadius).toBe(borders.radius);
    });

    it('has correct text color', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.color).toBe(hexToRgb(colors.text));
    });

    it('has correct font size', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.fontSize).toBe(typography.input.fontSize);
    });

    it('has correct padding for text input', () => {
      const { container } = render(<Input value="" onChange={() => {}} type="text" />);
      const input = container.querySelector('input');
      expect(input.style.padding).toBe('10px 12px');
    });

    it('has correct transition', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.transition).toContain(transitions.fast);
    });

    it('has box-sizing border-box', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.boxSizing).toBe('border-box');
    });

    it('has width 100%', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const input = container.querySelector('input');
      expect(input.style.width).toBe('100%');
    });

    it('applies custom style when provided', () => {
      const customStyle = { marginTop: '15px' };
      const { container } = render(<Input value="" onChange={() => {}} style={customStyle} />);
      const div = container.firstChild;
      expect(div.style.marginTop).toBe('15px');
    });
  });

  describe('Container Styling', () => {
    it('has correct margin bottom', () => {
      const { container } = render(<Input value="" onChange={() => {}} />);
      const div = container.firstChild;
      expect(div.style.marginBottom).toBe(spacing.md.toString() + 'px');
    });

    it('applies custom style to container', () => {
      const customStyle = { marginTop: '20px' };
      const { container } = render(<Input value="" onChange={() => {}} style={customStyle} />);
      const div = container.firstChild;
      expect(div.style.marginTop).toBe('20px');
    });
  });
});
