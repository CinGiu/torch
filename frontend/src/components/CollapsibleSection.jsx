import { useState } from 'react';
import { colors, spacing, typography, borders } from '../design-tokens.js';

export function CollapsibleSection({ icon, title, description, defaultOpen = false, children, style }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{ 
      marginBottom: spacing.xl,
      background: colors.bg,
      border: borders.default,
      borderRadius: '12px',
      overflow: 'hidden',
      ...style,
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: isOpen ? `1px solid ${colors.border}` : 'none',
          padding: `${spacing.lg} ${spacing.xl}`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '20px', marginTop: '2px' }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
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
        <span style={{
          fontSize: '16px',
          color: colors.orange,
          transition: 'transform 0.2s',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▼
        </span>
      </button>
      
      {isOpen && (
        <div style={{ padding: `${spacing.xl} ${spacing.xl}` }}>
          {children}
        </div>
      )}
    </div>
  );
}
