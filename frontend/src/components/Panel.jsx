import { colors, spacing, borders, typography } from '../design-tokens.js';

export function Panel({ children, header, footer, accent, style }) {
  return (
    <div style={{
      background: 'transparent',
      border: 'none',
      borderTop: 'none',
      borderRadius: borders.radius,
      overflow: 'hidden',
      ...style,
    }}>
      {header}
      <div style={{ padding: `${spacing.xl} ${spacing.xl}` }}>
        {children}
      </div>
      {footer}
    </div>
  );
}

export function PanelHeader({ icon, title, description }) {
  return (
    <div style={{
      background: 'transparent',
      padding: `${spacing.md} ${spacing.xl}`,
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.lg,
    }}>
      {icon && <span style={{ fontSize: '20px' }}>{icon}</span>}
      <div>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: colors.textHeader,
          fontFamily: typography.sans,
        }}>
          {title}
        </h3>
        {description && (
          <p style={{
            margin: `${spacing.xs} 0 0 0`,
            fontSize: '12px',
            color: colors.textMuted,
            fontFamily: typography.mono,
            lineHeight: 1.4,
          }}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function PanelFooter({ children, style }) {
  return (
    <div style={{
      background: colors.bgSecondary,
      padding: spacing.lg,
      borderTop: borders.default,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      ...style,
    }}>
      {children}
    </div>
  );
}

export function Section({ title, children, style }) {
  return (
    <div style={{ 
      marginBottom: spacing.xl, 
      padding: spacing.lg,
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: borders.radius,
      ...style 
    }}>
      {title && (
        <h4 style={{
          margin: `0 0 ${spacing.lg}`,
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: colors.orange,
          fontFamily: typography.sans,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
        }}>
          <span style={{
            display: 'inline-block',
            width: 4,
            height: 14,
            background: colors.orange,
            borderRadius: '2px',
          }} />
          {title}
        </h4>
      )}
      {children}
    </div>
  );
}

export function InputGroup({ children, style }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: spacing.xl,
      ...style,
    }}>
      {children}
    </div>
  );
}
