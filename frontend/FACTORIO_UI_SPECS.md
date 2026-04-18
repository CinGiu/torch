# Torch UI Refactoring - Factorio Style

## Design Principles (Factorio-inspired)

### Color Palette
- **Background**: `#1a1a1a` (dark gray)
- **Panel Background**: `#242424` (slightly lighter)
- **Border**: `#3d3d3d` (medium gray)
- **Header Background**: `#2d2d2d` (darker than panel)
- **Accent Orange**: `#ff9800` (Factorio orange)
- **Accent Green**: `#4caf50` (active/success)
- **Accent Red**: `#f44336` (error/danger)
- **Text Primary**: `#e0e0e0` (light gray)
- **Text Muted**: `#9e9e9e` (dimmed text)
- **Text Header**: `#ffffff` (white for titles)

### Typography
- **Headers**: `font-weight: 700`, `text-transform: uppercase`, `letter-spacing: 0.1em`
- **Labels**: `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.08em`, `color: muted`
- **Input Text**: `font-family: monospace`, `font-size: 13px`
- **Body Text**: `font-size: 13px`

### Layout Structure
```
┌─────────────────────────────────────────┐
│ PANEL HEADER (icon + title + desc)      │
├─────────────────────────────────────────┤
│                                         │
│  Section Title                          │
│  ┌─────────────┐  ┌─────────────┐      │
│  │ Input Field │  │ Input Field │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
│  Section Title                          │
│  ┌───────────────────────────────┐     │
│  │ Large Textarea                │     │
│  │                               │     │
│  └───────────────────────────────┘     │
│                                         │
├─────────────────────────────────────────┤
│ ACTION BAR (Save | Cancel)              │
└─────────────────────────────────────────┘
```

### Component Specifications

#### Panel Frame
- Border: `1px solid #3d3d3d`
- Border Top: `2px solid #ff9800` (accent)
- Background: `#242424`
- Padding: `16px`
- Margin: `16px 0`
- Border Radius: `2px` (minimal rounding)

#### Header Frame
- Background: `#2d2d2d` (darker)
- Padding: `12px 16px`
- Border Bottom: `1px solid #3d3d3d`
- Icon: `16px` left of title
- Title: `uppercase`, `letter-spacing: 0.1em`, `font-size: 13px`

#### Section Title
- Font Size: `11px`
- Text Transform: `uppercase`
- Letter Spacing: `0.08em`
- Color: `#9e9e9e` (muted)
- Margin Bottom: `8px`

#### Input Fields
- Background: `#1a1a1a` (darker than panel)
- Border: `1px solid #3d3d3d`
- Border Focus: `1px solid #ff9800`
- Padding: `10px 12px`
- Font Family: `monospace`
- Font Size: `13px`
- Border Radius: `2px`

#### Buttons
- Primary: Orange background (`#ff9800`), dark text
- Secondary: Transparent with border
- Danger: Red border and text
- Padding: `11px 24px`
- Font: `monospace`, `uppercase`, `font-size: 12px`
- Letter Spacing: `0.08em`

#### Action Bar (Footer)
- Border Top: `1px solid #3d3d3d`
- Padding: `16px`
- Background: `#1f1f1f` (slightly darker than panel)
- Buttons aligned right

### Settings Panel Organization

#### 1. Agents Configuration Panel
```
┌─ AGENT CONFIGURATION ────────────────────┐
│ [Developer] [Tester] [Reviewer] (tabs)   │
├──────────────────────────────────────────┤
│ CLI Selection                            │
│ ○ Claude  ○ Opencode                     │
│                                          │
│ API Key                                  │
│ ┌────────────────────────────────────┐  │
│ │ sk-...                             │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Max Fix Rounds                           │
│ [1] [2] [3] [4] [5]                     │
│                                          │
│ Custom Prompt (optional)                 │
│ ┌────────────────────────────────────┐  │
│ │ You are a senior developer...      │  │
│ │                                    │  │
│ └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

#### 2. GitHub Configuration Panel
```
┌─ GITHUB INTEGRATION ─────────────────────┐
│ GitHub Token                             │
│ ┌────────────────────────────────────┐  │
│ │ ghp_...                            │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Webhook Secret                           │
│ ┌────────────────────────────────────┐  │
│ │ your-secret-here                   │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Trigger Label                            │
│ ┌─────────────┐                          │
│ │ ai-implement│                          │
│ └─────────────┘                          │
│                                          │
│ Base Branch                              │
│ ┌─────────────┐                          │
│ │ main        │                          │
│ └─────────────┘                          │
└──────────────────────────────────────────┘
```

#### 3. Pipeline Configuration Panel
```
┌─ PIPELINE SETTINGS ──────────────────────┐
│ Test Command                             │
│ ┌────────────────────────────────────┐  │
│ │ flutter test                       │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Lint Command                             │
│ ┌────────────────────────────────────┐  │
│ │ flutter analyze                    │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Workspaces Directory                     │
│ ┌────────────────────────────────────┐  │
│ │ /tmp/torch-workspaces              │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Timeout (seconds)                        │
│ ┌─────────────┐                          │
│ │ 1800        │                          │
│ └─────────────┘                          │
│                                          │
│ Opencode Config (if enabled)             │
│ ┌────────────────────────────────────┐  │
│ │ {                                  │  │
│ │   "provider": {...}                │  │
│ │ }                                  │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Max Fix Rounds                           │
│ [1] [2] [3] [4] [5]                     │
└──────────────────────────────────────────┘
```

### Implementation Priority

1. **Create FactorioTheme object** - Colors, spacing, typography tokens
2. **Refactor Card component** - Add header, footer, section support
3. **Rebuild Settings tab** - Split into 3 panels (Agents, GitHub, Pipeline)
4. **Add visual hierarchy** - Section titles, proper spacing
5. **Update buttons** - Factorio-style with uppercase labels
6. **Improve inputs** - Better focus states, monospace fonts
7. **Add action bar** - Fixed footer with Save/Reset buttons

### Files to Modify

- `src/App.jsx` - Main refactoring of Settings section
- `src/design-tokens.js` - NEW: Factorio theme definition
- `src/components/Panel.jsx` - NEW: Factorio-style panel component
- `src/components/Section.jsx` - NEW: Section wrapper component

### References

- Factorio GUI screenshots: https://wiki.factorio.com/GUI
- Factorio style guide: https://mods.factorio.com/mod/gui-guidelines
- Factorio UI GitHub: https://github.com/wube/factorio-data
