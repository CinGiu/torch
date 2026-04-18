import { useState } from 'react';
import { colors, typography, borders, transitions } from '../design-tokens.js';

export function Button({ 
  children, 
  variant = 'default', 
  onClick, 
  disabled, 
  type = 'button',
  style 
}) {
  const baseStyle = {
    padding: '11px 24px',
    borderRadius: borders.radius,
    border: borders.default,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: typography.mono,
    fontSize: typography.button.fontSize,
    fontWeight: typography.button.fontWeight,
    textTransform: typography.button.textTransform,
    letterSpacing: typography.button.letterSpacing,
    transition: `all ${transitions.normal}`,
    opacity: disabled ? 0.5 : 1,
  };

  const variants = {
    default: {
      background: 'transparent',
      color: colors.text,
    },
    primary: {
      background: colors.orange,
      color: '#000000',
      borderColor: colors.orange,
    },
    success: {
      background: `${colors.green}22`,
      color: colors.green,
      borderColor: colors.green,
    },
    danger: {
      background: `${colors.red}22`,
      color: colors.red,
      borderColor: colors.red,
    },
  };

  const variantStyle = variants[variant] || variants.default;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseStyle,
        ...variantStyle,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && variant !== 'primary') {
          e.target.style.background = `${colors.orange}11`;
          e.target.style.borderColor = colors.orange;
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && variant !== 'primary') {
          e.target.style.background = variantStyle.background;
          e.target.style.borderColor = variantStyle.borderColor || borders.default;
        }
      }}
    >
      {children}
    </button>
  );
}
