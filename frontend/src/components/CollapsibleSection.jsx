import { useState } from 'react';
import { colors, spacing, typography } from '../design-tokens.js';

export function CollapsibleSection({ icon, title, description, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: spacing.xl }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${colors.border}`,
          padding: `${spacing.md} ${spacing.xl}`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '20px' }}>{icon}</span>
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
        <span style={{
          marginLeft: 'auto',
          fontSize: '16px',
          color: colors.textMuted,
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
