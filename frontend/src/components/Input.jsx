import { useState } from 'react';
import { colors, typography, borders, transitions } from '../design-tokens.js';

export function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  disabled,
  isCode = false,
  rows,
  style,
}) {
  const baseInputStyle = {
    width: '100%',
    background: colors.input,
    border: borders.default,
    borderRadius: borders.radius,
    padding: type === 'text' ? '10px 12px' : undefined,
    color: colors.text,
    fontSize: typography.input.fontSize,
    fontFamily: isCode || rows ? typography.mono : typography.sans,
    outline: 'none',
    boxSizing: 'border-box',
    transition: `border-color ${transitions.fast}`,
    disabled: disabled ? 'opacity: 0.5' : undefined,
  };

  const [focus, setFocus] = useState(false);

  return (
    <div style={{ marginBottom: spacing.md, ...style }}>
      {label && (
        <label style={{
          display: 'block',
          fontSize: typography.label.fontSize,
          fontWeight: typography.label.fontWeight,
          textTransform: typography.label.textTransform,
          letterSpacing: typography.label.letterSpacing,
          color: colors.textMuted,
          fontFamily: typography.mono,
          marginBottom: spacing.sm,
        }}>
          {label}
        </label>
      )}
      {rows ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            ...baseInputStyle,
            borderColor: focus ? colors.borderFocus : colors.border,
            resize: 'vertical',
          }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            ...baseInputStyle,
            borderColor: focus ? colors.borderFocus : colors.border,
          }}
        />
      )}
      {hint && (
        <p style={{
          margin: `${spacing.xs} 0 0`,
          fontSize: '11px',
          color: colors.textDim,
          fontFamily: typography.mono,
        }}>
          {hint}
        </p>
      )}
    </div>
  );
}
