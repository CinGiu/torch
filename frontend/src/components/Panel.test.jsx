import { render, screen } from '@testing-library/react';
import { Panel, PanelHeader, PanelFooter, Section, InputGroup } from './Panel.jsx';
import { colors, spacing, borders, typography } from '../design-tokens.js';

// Helper to convert hex to rgb for JSDOM comparison
const hexToRgb = (hex) => {
  if (hex.length === 9) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = parseInt(hex.slice(7, 9), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
};

describe('Panel Components', () => {
  describe('Panel', () => {
    it('renders children correctly', () => {
      render(<Panel>Test Content</Panel>);
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('renders with header', () => {
      const header = <div data-testid="header">Header Content</div>;
      render(<Panel header={header}>Content</Panel>);
      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders with footer', () => {
      const footer = <div data-testid="footer">Footer Content</div>;
      render(<Panel footer={footer}>Content</Panel>);
      expect(screen.getByTestId('footer')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders with header and footer', () => {
      const header = <div data-testid="header">Header</div>;
      const footer = <div data-testid="footer">Footer</div>;
      render(<Panel header={header} footer={footer}>Content</Panel>);
      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('footer')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('applies accent color when provided', () => {
      const { container } = render(<Panel accent="#ff0000">Content</Panel>);
      const panel = container.firstChild;
      expect(panel.style.borderTop).toBe('2px solid rgb(255, 0, 0)');
    });

    it('applies custom style when provided', () => {
      const customStyle = { marginTop: '20px', padding: '30px' };
      const { container } = render(<Panel style={customStyle}>Content</Panel>);
      const panel = container.firstChild;
      expect(panel.style.marginTop).toBe('20px');
      expect(panel.style.padding).toBe('30px');
    });

    it('uses default border when no accent is provided', () => {
      const { container } = render(<Panel>Content</Panel>);
      const panel = container.firstChild;
      expect(panel.style.borderTop).toBe(`2px solid ${hexToRgb(colors.orange)}`);
    });

    it('has correct background color', () => {
      const { container } = render(<Panel>Content</Panel>);
      const panel = container.firstChild;
      expect(panel.style.background).toBe(hexToRgb(colors.surface));
    });

    it('has correct border radius', () => {
      const { container } = render(<Panel>Content</Panel>);
      const panel = container.firstChild;
      expect(panel.style.borderRadius).toBe(borders.radius);
    });
  });

  describe('PanelHeader', () => {
    it('renders title correctly', () => {
      render(<PanelHeader title="My Title" />);
      expect(screen.getByText('My Title')).toBeInTheDocument();
    });

    it('renders icon when provided', () => {
      render(<PanelHeader icon="⚙️" title="Settings" />);
      expect(screen.getByText('⚙️')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
      render(<PanelHeader title="Title" description="Description text" />);
      expect(screen.getByText('Description text')).toBeInTheDocument();
    });

    it('does not render description when not provided', () => {
      render(<PanelHeader title="Title" />);
      const description = screen.queryByText(/Description/i);
      expect(description).not.toBeInTheDocument();
    });

    it('renders without icon when not provided', () => {
      render(<PanelHeader title="Title" />);
      const icon = screen.queryByRole('img', { hidden: true });
      expect(icon).not.toBeInTheDocument();
    });

    it('applies correct header styling', () => {
      const { container } = render(<PanelHeader title="Title" />);
      const header = container.firstChild;
      expect(header.style.background).toBe(hexToRgb(colors.surfaceDark));
      expect(header.style.borderBottom).toBe(`1px solid ${hexToRgb(colors.border)}`);
    });

    it('title has correct typography', () => {
      const { container } = render(<PanelHeader title="Title" />);
      const title = container.querySelector('h3');
      expect(title.style.fontSize).toBe(typography.header.fontSize);
      expect(title.style.fontWeight).toBe(typography.header.fontWeight.toString());
      expect(title.style.textTransform).toBe(typography.header.textTransform);
    });

    it('description has correct typography', () => {
      render(<PanelHeader title="Title" description="Description" />);
      const description = screen.getByText('Description');
      expect(description.style.fontSize).toBe(typography.input.fontSize);
      expect(description.style.color).toBe(hexToRgb(colors.textMuted));
    });
  });

  describe('PanelFooter', () => {
    it('renders children correctly', () => {
      render(<PanelFooter>Footer Content</PanelFooter>);
      expect(screen.getByText('Footer Content')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <PanelFooter>
          <button>Cancel</button>
          <button>Save</button>
        </PanelFooter>
      );
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('applies correct background color', () => {
      const { container } = render(<PanelFooter>Content</PanelFooter>);
      const footer = container.firstChild;
      expect(footer.style.background).toBe(hexToRgb(colors.bgSecondary));
    });

    it('has correct border styling', () => {
      const { container } = render(<PanelFooter>Content</PanelFooter>);
      const footer = container.firstChild;
      expect(footer.style.borderTop).toBe(`1px solid ${hexToRgb(colors.border)}`);
    });

    it('applies custom style when provided', () => {
      const customStyle = { justifyContent: 'center' };
      const { container } = render(<PanelFooter style={customStyle}>Content</PanelFooter>);
      const footer = container.firstChild;
      expect(footer.style.justifyContent).toBe('center');
    });

    it('has flex layout with space-between', () => {
      const { container } = render(<PanelFooter>Content</PanelFooter>);
      const footer = container.firstChild;
      expect(footer.style.display).toBe('flex');
      expect(footer.style.justifyContent).toBe('space-between');
    });
  });

  describe('Section', () => {
    it('renders children correctly', () => {
      render(<Section>Section Content</Section>);
      expect(screen.getByText('Section Content')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
      render(<Section title="Section Title">Content</Section>);
      expect(screen.getByText('Section Title')).toBeInTheDocument();
    });

    it('does not render title when not provided', () => {
      render(<Section>Content</Section>);
      const title = screen.queryByRole('heading');
      expect(title).not.toBeInTheDocument();
    });

    it('title has correct typography', () => {
      const { container } = render(<Section title="Title">Content</Section>);
      const title = container.querySelector('h4');
      expect(title.style.fontSize).toBe(typography.label.fontSize);
      expect(title.style.fontWeight).toBe(typography.label.fontWeight.toString());
      expect(title.style.textTransform).toBe(typography.label.textTransform);
      expect(title.style.color).toBe(hexToRgb(colors.textMuted));
    });

    it('has correct margin bottom', () => {
      const { container } = render(<Section title="Title">Content</Section>);
      const section = container.firstChild;
      expect(section.style.marginBottom).toBe(spacing.xl.toString() + 'px');
    });

    it('applies custom style when provided', () => {
      const customStyle = { backgroundColor: 'red' };
      const { container } = render(<Section style={customStyle}>Content</Section>);
      const section = container.firstChild;
      expect(section.style.backgroundColor).toBe('red');
    });
  });

  describe('InputGroup', () => {
    it('renders children correctly', () => {
      render(<InputGroup><input data-testid="input1" /><input data-testid="input2" /></InputGroup>);
      expect(screen.getByTestId('input1')).toBeInTheDocument();
      expect(screen.getByTestId('input2')).toBeInTheDocument();
    });

    it('applies grid layout', () => {
      const { container } = render(<InputGroup>Content</InputGroup>);
      const group = container.firstChild;
      expect(group.style.display).toBe('grid');
      expect(group.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(280px, 1fr))');
    });

    it('has correct gap', () => {
      const { container } = render(<InputGroup>Content</InputGroup>);
      const group = container.firstChild;
      expect(group.style.gap).toBe(spacing.lg.toString() + 'px');
    });

    it('applies custom style when provided', () => {
      const customStyle = { gridTemplateColumns: '1fr 1fr' };
      const { container } = render(<InputGroup style={customStyle}>Content</InputGroup>);
      const group = container.firstChild;
      expect(group.style.gridTemplateColumns).toBe('1fr 1fr');
    });
  });
});
