# CSS Class Reference & Visual Guide

## Complete Class Hierarchy

```
.sidebar                          (Container)
├── .sidebar-header               (Top section - 1.2rem padding)
│   ├── .sidebar-logo             (Emoji container - 28px)
│   └── .sidebar-brand            (Title + subtitle)
│       ├── h2                    (Brand name)
│       └── p                     (Subtitle)
│
├── .sidebar-content              (Scrollable area - flex: 1)
│   └── .nav-group                (Grouping container)
│       ├── .nav-group-title      (Section label - uppercase, muted)
│       ├── .nav-item             (Menu button)
│       │   ├── .active           (Current page highlight)
│       │   ├── .sub              (Sub-item - indented)
│       │   └── .nav-badge        (Notification badge)
│       └── [more nav-items...]
│
└── .sidebar-footer               (Bottom section)
    ├── .nav-item                 (Logout button - red styling)
    └── .user-info                (User name/role text)

.main-with-sidebar               (Content wrapper - margin-left: 280px)
├── .main                         (Original main container)
│   └── [all page content]
│
.sidebar-overlay                 (Mobile dim layer)
.sidebar-toggle                  (Mobile hamburger button)
```

---

## Detailed Class Reference

### `.sidebar`
**Purpose:** Main sidebar container
**Properties:**
- Position: Fixed (left: 0, top: 0)
- Width: 280px
- Height: 100vh
- Background: White (#ffffff)
- Border: Right border (1px solid var(--border))
- Display: Flex (column)
- Z-Index: 95
- Box-shadow: 2px 0 8px rgba(0,0,0,0.06)

**Responsive:**
- Mobile (<768px): Transform translateX(-100%) until `.open` class
- With `.open`: TranslateX(0)
- Width reduces to 240px at <600px

**States:**
- Default: Visible on desktop, hidden on mobile
- `.open`: Visible, slides in from left on mobile

---

### `.sidebar-header`
**Purpose:** Logo and branding section
**Properties:**
- Padding: 1.2rem 1rem
- Border-bottom: 2px solid var(--green-pale)
- Display: Flex, gap: 10px
- Align items: Center
- Background: Linear gradient (light green)
- Flex-shrink: 0 (doesn't shrink)

**Child Elements:**
- Gap between logo and brand: 10px
- Logo font-size: 28px
- Brand text: Right-aligned

**Responsive:**
- Mobile: Font sizes reduce slightly

---

### `.sidebar-logo`
**Purpose:** Emoji/icon container
**Properties:**
- Font-size: 28px
- Line-height: 1
- Flex-shrink: 0 (maintains size)
- Content: "🏢"

**Usage:** Always 28px, emoji-based

---

### `.sidebar-brand`
**Purpose:** Branding text section
**Properties:**
- Flex: 1 (takes remaining space)
- Min-width: 0 (overflow handling)

**Child Elements:**

#### `.sidebar-brand h2`
- Font-size: 0.95rem (14.25px)
- Font-weight: 700 (bold)
- Color: var(--green-dark) (#1a5c38)
- Margin: 0
- Line-height: 1.2

#### `.sidebar-brand p`
- Font-size: 0.65rem (9.75px)
- Color: var(--text-muted) (#6b7a8d)
- Margin: 2px 0 0
- Font-weight: 500

---

### `.sidebar-content`
**Purpose:** Scrollable navigation container
**Properties:**
- Flex: 1 (takes all available space)
- Overflow-y: auto (vertical scroll)
- Overflow-x: hidden (no horizontal scroll)
- Padding: 0.8rem 0 (top/bottom)
- Scrollbar: Thin, custom styled

**Scrollbar Styling:**
- Width: 6px
- Color: var(--border)
- Hover: #d0d5dc

**Notes:**
- Scrollbar gutter: Stable (doesn't shift layout)
- Custom scrollbar for Chrome/Edge
- Firefox: Scrollbar-width: thin

---

### `.nav-group`
**Purpose:** Group/section container
**Properties:**
- Padding: 0 (no internal padding)
- Margin: 0 (no margin)

**Separator:**
- Siblings have border-top: 1px solid var(--border)
- Top margin: 0.4rem
- Top padding: 0.4rem

**Structure:**
```
.nav-group
├── .nav-group-title
├── .nav-item
├── .nav-item.sub
└── .nav-item.sub
```

---

### `.nav-group-title`
**Purpose:** Group label/section header
**Properties:**
- Font-size: 0.7rem (10.5px)
- Font-weight: 700 (bold)
- Color: var(--text-muted) (#6b7a8d)
- Text-transform: Uppercase
- Letter-spacing: 0.4px (tracking)
- Padding: 0.6rem 1.2rem 0.4rem
- Margin: 0
- Display: Block

**Styling:**
- All caps, muted color
- Subtle spacing
- Visual hierarchy

**Examples:**
- "Main"
- "Property"
- "People"
- "Finance"
- "Operations"
- "Management"

---

### `.nav-item`
**Purpose:** Individual navigation button
**Properties:**
- Display: Block + Flex (for icon spacing)
- Width: calc(100% - 0.8rem) (margin padding)
- Margin: 0.25rem 0.4rem
- Padding: 0.65rem 1rem
- Background: Transparent
- Border: None
- Border-radius: var(--radius-sm) (8px)
- Color: var(--text) (#1a2332)
- Font-family: 'Sarabun', sans-serif
- Font-size: 0.88rem (13.2px)
- Font-weight: 500
- Cursor: Pointer
- Transition: all 0.2s ease
- Text-align: Left
- Align-items: Center
- Gap: 8px (between icon and text)
- Position: Relative

**Hover State:**
- Background: var(--green-pale) (#e8f5e9)
- Color: var(--green-dark) (#1a5c38)

**Active State:** (see `.nav-item.active`)

---

### `.nav-item.active`
**Purpose:** Highlight current page
**Properties:**
- Background: Linear gradient (green-pale to light green)
- Color: var(--green-dark) (#1a5c38)
- Font-weight: 600 (semi-bold)
- Border-left: 3px solid var(--green) (#2d8653)
- Padding-left: calc(1rem - 3px) (compensate for border)

**Visual Indicator:**
```
█ ━━━━━━━━━━━━━━━━  ← Green left border (3px)
  📊 Dashboard      ← Text with green tint
  Background: Light green with gradient
```

**Pseudo-element (::before):**
- Position: Absolute, left
- Width: 3px
- Background: var(--green)
- Border-radius: 0 2px 2px 0

---

### `.nav-item.sub`
**Purpose:** Sub-item (child menu)
**Properties:**
- Padding-left: 2rem (indented)
- Font-size: 0.82rem (12.3px) - slightly smaller
- Color: var(--text-muted) (#6b7a8d) - grayed

**Hover State:**
- Color: var(--green-dark)
- Background: var(--green-pale)

**Active State:**
- Color: var(--green-dark)
- Padding-left: calc(2rem - 3px) (border compensated)
- Border-left: 3px solid var(--green)

**Visual:**
```
 🏠 Rooms          ← Parent item
   └ Nest          ← Sub-item (indented 2rem)
   └ Contracts     ← Sub-item (indented 2rem)
```

**Prefix:** "└ " (box drawing character included in HTML)

---

### `.nav-badge`
**Purpose:** Notification count badge
**Properties:**
- Background: #ef5350 (red)
- Color: #fff (white)
- Font-size: 0.6rem (9px)
- Font-weight: 800 (extra bold)
- Padding: 1px 5px
- Border-radius: 10px (pill shape)
- Margin-left: auto (float to right)
- Flex-shrink: 0 (doesn't compress)
- Display: Inline-block
- Vertical-align: Middle

**Usage:**
```html
<button class="nav-item">
  📅 Bill
  <span class="nav-badge" id="billBadge">5</span>
</button>
```

**Display:**
- Hidden by default (display: none)
- Shows when JavaScript sets count
- Right-aligned in button

**IDs:**
- `#billBadge` — Bill count
- `#paymentBadge` — Payment count
- `#mxBadge` — Maintenance count

---

### `.sidebar-footer`
**Purpose:** Bottom section (logout, user info)
**Properties:**
- Padding: 1rem 0.4rem
- Border-top: 1px solid var(--border)
- Background: #f9fafb (light gray)
- Flex-shrink: 0 (doesn't shrink)
- Display: Flex (column)
- Gap: 0.6rem
- Flex-direction: Column

**Children Layout:**
```
┌─────────────────┐
│ 🚪 Logout       │ ← .nav-item (red styling)
├─────────────────┤
│ 👤 Admin Name   │ ← .user-info
│ Admin           │
└─────────────────┘
```

---

### `.sidebar-footer .nav-item`
**Purpose:** Logout button styling
**Properties:**
- Background: rgba(198, 40, 40, 0.08) (light red)
- Color: #c62828 (red)
- Margin: 0.25rem 0.4rem

**Hover State:**
- Background: rgba(198, 40, 40, 0.15) (darker red)

**Active State:**
- Border-left: 3px solid #c62828
- Padding-left: calc(1rem - 3px)

**Icon:** "🚪"
**Text:** "Logout"

---

### `.user-info`
**Purpose:** Display user name and role
**Properties:**
- Font-size: 0.75rem (11.25px)
- Color: #999 (muted)
- Margin-top: 8px
- Padding: 8px 12px
- Text-align: Center
- Border-top: 1px solid #eee
- Line-height: 1.4
- Word-break: Break-word

**Content:**
```html
<strong>👤 Admin Name</strong><br>Admin
```

**Display:**
- Smaller, centered text
- Separated with border
- Shows name (from authentication) and role

---

### `.main-with-sidebar`
**Purpose:** Main content wrapper with sidebar offset
**Properties:**
- Margin-left: 280px (sidebar width)
- Width: calc(100% - 280px)
- Transition: margin-left 0.3s ease, width 0.3s ease

**Responsive:**
- Desktop (>768px): margin-left: 280px, width: calc(100% - 280px)
- Mobile (<768px): margin-left: 0, width: 100%
- Transition smooth over 0.3s

---

### `.sidebar-toggle`
**Purpose:** Mobile hamburger button
**Properties:**
- Display: None (hidden on desktop)
- Position: Fixed
- Top: 16px, Left: 16px
- Z-Index: 96
- Background: var(--green) (#2d8653)
- Color: #fff
- Border: None
- Border-radius: 8px
- Width: 44px, Height: 44px
- Cursor: Pointer
- Font-size: 1.2rem
- Display: Flex, Align-items: Center, Justify-content: Center
- Transition: all 0.2s
- Box-shadow: 0 2px 8px rgba(45, 134, 83, 0.2)

**Hover State:**
- Background: var(--green-dark) (#1a5c38)
- Box-shadow: 0 4px 12px rgba(45, 134, 83, 0.3)

**Content:**
- Normal: "☰" (hamburger)
- When open: "✕" (close)

**Classes:**
- `.close` — Applied when sidebar open

**Responsive:**
- Mobile (<768px): display: flex
- Desktop (>768px): display: none

---

### `.sidebar-overlay`
**Purpose:** Semi-transparent overlay behind sidebar (mobile)
**Properties:**
- Display: None (hidden)
- Position: Fixed
- Inset: 0 (covers entire viewport)
- Background: rgba(0, 0, 0, 0.4) (semi-transparent)
- Z-Index: 94
- Transition: opacity 0.3s ease

**With `.show` class:**
- Display: Block
- Opacity: 1

**Responsive:**
- Mobile (<768px): Shows when sidebar open
- Desktop (>768px): Never shown

---

## Responsive Breakpoints

### Desktop (>768px)
```css
.sidebar {
  transform: translateX(0);  /* Always visible */
  width: 280px;
}

.main-with-sidebar {
  margin-left: 280px;
  width: calc(100% - 280px);
}

.sidebar-toggle {
  display: none;  /* Hidden */
}

.sidebar-overlay {
  display: none;  /* Hidden */
}
```

### Tablet (768px)
```css
/* Breakpoint - hamburger appears */
```

### Mobile (<768px)
```css
.sidebar {
  transform: translateX(-100%);  /* Hidden by default */
  width: 240px;
  /* Slides in with .open class */
}

.sidebar.open {
  transform: translateX(0);
}

.main-with-sidebar {
  margin-left: 0;
  width: 100%;
  padding-top: 60px;  /* Space for hamburger */
}

.sidebar-toggle {
  display: flex;  /* Visible */
}

.sidebar-overlay.show {
  display: block;
}
```

### Small Mobile (<600px)
```css
.sidebar {
  width: 240px;  /* Narrower */
}

.sidebar-brand h2 {
  font-size: 0.88rem;  /* Slightly smaller */
}

.nav-item {
  font-size: 0.82rem;
  padding: 0.55rem 0.85rem;
}

.nav-item.sub {
  padding-left: 1.8rem;  /* Reduced indent */
}
```

---

## Color Variables Used

| Variable | Value | Usage |
|----------|-------|-------|
| `--green` | #2d8653 | Active state, hover |
| `--green-dark` | #1a5c38 | Headings, text |
| `--green-pale` | #e8f5e9 | Backgrounds |
| `--text` | #1a2332 | Primary text |
| `--text-muted` | #6b7a8d | Secondary text |
| `--border` | #e0e6ed | Borders, dividers |
| `--radius-sm` | 8px | Border radius |

---

## Z-Index Stack

```
96 ← .sidebar-toggle (hamburger button - topmost)
95 ← .sidebar (navigation container)
94 ← .sidebar-overlay (dim background)
...
0  ← .main-with-sidebar (content)
```

---

## Animation Classes

### `.sidebar` (Mobile Slide-In)
```css
transform: translateX(-100%);        /* Default: hidden left */
transition: transform 0.3s ease;

.open {
  transform: translateX(0);          /* Slides in to 0 */
}
```

### `.sidebar-overlay` (Fade)
```css
opacity: 0;
transition: opacity 0.3s ease;

.show {
  opacity: 1;
}
```

### `.nav-item` (Hover)
```css
transition: all 0.2s ease;  /* Background, color smooth change */
```

---

## Customization Points

Easy to customize:

```css
/* Change sidebar width */
.sidebar { width: 300px; }
.main-with-sidebar { margin-left: 300px; width: calc(100% - 300px); }

/* Change colors */
--green: #your-color;
--green-dark: #darker;
--green-pale: #lighter;

/* Change transitions */
transition: transform 0.5s ease;  /* Slower/faster slide */

/* Change padding */
.nav-item { padding: 0.8rem 1.2rem; }  /* More/less padding */

/* Change fonts */
font-family: 'Your Font', sans-serif;
```

---

## Print Styles

```css
@media print {
  .sidebar,
  .sidebar-toggle,
  .sidebar-overlay {
    display: none !important;  /* Hide on print */
  }

  .main-with-sidebar {
    margin-left: 0 !important;
    width: 100% !important;
  }
}
```

---

## Testing Checklist

- [ ] Desktop view shows 280px sidebar
- [ ] Sidebar has green header and borders
- [ ] Nav items have proper spacing and fonts
- [ ] Active state shows green left border
- [ ] Sub-items are indented 2rem
- [ ] Mobile hamburger appears at 768px
- [ ] Hamburger is 44x44px in top-left
- [ ] Overlay appears when hamburger clicked
- [ ] Colors match (green #2d8653)
- [ ] Scrollbar visible in sidebar
- [ ] Footer has logout button and user info
- [ ] Badges show red with count
- [ ] Responsive resizing works smoothly
- [ ] Print hides sidebar completely

---

## Summary

This CSS structure provides:
- ✓ Professional appearance
- ✓ Full mobile responsiveness
- ✓ Clear visual hierarchy
- ✓ Accessible contrast
- ✓ Smooth transitions
- ✓ Print-friendly
- ✓ Customizable colors/sizing
- ✓ Production-ready code
