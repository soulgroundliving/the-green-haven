# THE GREEN HAVEN - Design System Protocol
## "Quiet Living" Brand Identity

---

## 🌿 Brand Philosophy
**The Green Haven** embodies the concept of "quiet living" - a peaceful, balanced, nature-inspired lifestyle. The design system reflects this through:
- **Calming colors** derived from nature (forest greens, warm grays)
- **Professional typography** for clarity and accessibility
- **Subtle interactions** that don't startle or overwhelm
- **Consistent patterns** that create predictability and trust

---

## 🎨 Color Palette

### Primary Colors (Calm, Nature-Inspired)
- **Primary Dark** `#2d5a4d` - Deep forest green, grounding and peaceful
- **Primary** `#3d7063` - Main green, balanced and nature-inspired
- **Primary Light** `#5a8f7f` - Soft green, accessible and gentle
- **Primary Pale** `#ecf3f1` - Very pale green, backgrounds

### Neutral Colors (Professional, Warm)
- **Neutral Dark** `#3f4a52` - Deep charcoal, primary text
- **Neutral** `#6b7a8d` - Soft gray, secondary text
- **Neutral Light** `#c0c9d4` - Light gray, borders
- **Neutral Pale** `#f5f7f9` - Off-white, subtle backgrounds

### Status Colors (Muted, Not Alarming)
- **Success** `#5a8f7f` - Paid, complete, confirmed
- **Warning** `#c9a876` - Pending, caution, in progress
- **Danger** `#a85a5a` - Overdue, alert, requires action

### Supporting Colors
- **Accent Warm** `#8b7f6a` - Taupe for special emphasis
- **Info** `#5a8f7f` - Information, help text

### UI Elements
- **Background** `#fafbfc` - Main background, very light
- **Card** `#ffffff` - Card backgrounds, white
- **Border** `#d9dfe8` - Subtle borders
- **Divider** `#eef2f5` - Very subtle dividers

---

## 📝 Typography

### Font Family
`'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

### Heading Scale
| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| H1 | 2rem (32px) | Bold (700) | Page titles |
| H2 | 1.5rem (24px) | Bold (700) | Section headers |
| H3 | 1.25rem (20px) | Semibold (600) | Card titles |

### Body Text
| Type | Size | Weight | Usage |
|------|------|--------|-------|
| Body | 0.95rem (15px) | Normal (400) | Main text |
| Small | 0.85rem (13.6px) | Normal (400) | Labels, captions |
| XSmall | 0.75rem (12px) | Normal (400) | Helper text, hints |

### Font Weights
- Light: 300
- Normal: 400
- Medium: 500
- Semibold: 600
- Bold: 700
- Extrabold: 800

---

## 📐 Spacing System (4px Base Grid)

| Token | Value | Usage |
|-------|-------|-------|
| xs | 0.25rem (4px) | Tight spacing, icon margins |
| sm | 0.5rem (8px) | Small gaps, close elements |
| md | 1rem (16px) | Standard spacing, default margin |
| lg | 1.5rem (24px) | Section spacing, padding |
| xl | 2rem (32px) | Large gaps, main sections |
| 2xl | 2.5rem (40px) | Very large spacing |

---

## 🎭 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| radius-sm | 6px | Small buttons, inputs |
| radius | 10px | Cards, standard elements |
| radius-lg | 14px | Large cards, modals |
| radius-xl | 18px | Extra large, featured elements |

---

## 💫 Shadow System (Subtle & Calm)

| Level | CSS | Opacity | Usage |
|-------|-----|---------|-------|
| xs | `0 1px 2px rgba(0, 0, 0, 0.05)` | 5% | Minimal elevation |
| sm | `0 1px 3px rgba(0, 0, 0, 0.08)` | 8% | Subtle, input fields |
| md | `0 2px 8px rgba(0, 0, 0, 0.1)` | 10% | Standard, cards |
| lg | `0 4px 12px rgba(0, 0, 0, 0.12)` | 12% | Header, emphasis |
| xl | `0 8px 24px rgba(0, 0, 0, 0.15)` | 15% | Strong emphasis |

---

## ⏱️ Transitions (Smooth & Natural)

| Speed | Duration | Usage |
|-------|----------|-------|
| Fast | 0.15s ease | Hover states, quick interactions |
| Normal | 0.3s ease | Standard transitions (default) |
| Slow | 0.5s ease | Page loads, subtle effects |

---

## 🧩 Component Guidelines

### Buttons
- **Primary**: Use primary color background, white text
- **Secondary**: Use neutral light background, neutral dark text
- **Disabled**: Reduce opacity to 50%, disable pointer
- **Hover State**: Slight color darkening, subtle shadow lift

### Cards
- **Background**: White (`#ffffff`)
- **Padding**: `md` (1rem) standard, `lg` (1.5rem) for spacious
- **Shadow**: Use `shadow-md` by default
- **Border Radius**: `radius` (10px) standard

### Input Fields
- **Border**: `border` color (`#d9dfe8`)
- **Focus**: Primary color border, subtle shadow
- **Padding**: `sm` (0.5rem) vertical, `md` (1rem) horizontal
- **Font**: Body text size (`0.95rem`)

### Status Indicators
- **Success**: Green (`#5a8f7f`)
- **Warning**: Amber (`#c9a876`)
- **Danger**: Red (`#a85a5a`)
- **Info**: Green (`#5a8f7f`)

---

## ✨ Animation Principles

1. **Subtle**: Avoid jarring or overly dramatic animations
2. **Purposeful**: Every animation should convey information
3. **Quick**: Respect user time with fast transitions
4. **Consistent**: Use the same timing across the app
5. **Accessible**: Respect `prefers-reduced-motion` preference

---

## 🔄 Implementation Examples

### Using CSS Variables
```css
/* Colors */
background: var(--primary-dark);
color: var(--text);
border: 1px solid var(--border);

/* Typography */
font-size: var(--font-h2);
font-weight: var(--font-weight-bold);

/* Spacing */
padding: var(--space-md);
margin-bottom: var(--space-lg);

/* Shadows */
box-shadow: var(--shadow-md);

/* Transitions */
transition: all var(--transition);
```

---

## 📋 Design System Checklist

When adding new components:
- ✅ Use CSS variables for all colors, spacing, typography
- ✅ Follow the spacing grid (4px base)
- ✅ Use proper heading hierarchy
- ✅ Apply appropriate shadow for depth
- ✅ Implement hover/focus states
- ✅ Ensure accessibility (color contrast, focus indicators)
- ✅ Test on mobile and desktop
- ✅ Document any new tokens

---

## 🚀 Version History

### v1.0 - Initial Design System (2026-03-28)
- Created "Quiet Living" color palette
- Established typography hierarchy
- Defined spacing and sizing system
- Created shadow and transition guidelines
- Applied system across all pages

---

## 📞 Questions?

For questions about the design system or to propose changes, please follow the design protocol guidelines above.

---

**The Green Haven Design System**
*Calm. Professional. Nature-Inspired.*
