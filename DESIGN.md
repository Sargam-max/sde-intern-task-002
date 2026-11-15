# 🎨 BillSplitter Design System & Visual Architecture Specification

> **Version**: 2.0.0  
> **Philosophy**: Modern Fintech Glassmorphism meets High-Precision Ledger Simplicity  
> **Target Audience**: Roommates, flatmates, and shared households requiring crystal-clear, zero-ambiguity expense splitting.

---

## 1. Design Philosophy & Vision

Fintech applications for shared living often suffer from two extremes: either overly clinical spreadsheet clones that intimidate casual users, or overly playful consumer apps that hide arithmetic details behind ambiguous rounding.

**BillSplitter 2.0** bridges this divide with four core design tenets:

1. **Absolute Mathematical Transparency**: Roommates must never wonder where a stray cent went. Every uneven split is explained in plain language (e.g., _"first roommate pays 1¢ more"_), and every financial metric uses strict `tabular-nums` formatting.
2. **Tactile Depth & Glassmorphism**: The interface uses multi-layered frosted glass panels (`backdrop-filter: blur(16px)`), dual-layer soft elevation shadows, and ambient fluid aurora orbs that create a vibrant, modern fintech atmosphere without distracting from the data.
3. **Calm Micro-Interactions & Living Motion**: State transitions, payment confirmations, and upload indicators use spring-damped curves (`cubic-bezier(0.16, 1, 0.3, 1)`), shimmering progress bars, and glowing beacons that provide continuous, delightful visual feedback.
4. **Universal Accessibility & Ergonomics**: Built with semantic HTML5 landmarks, full keyboard navigability, WCAG 2.1 AAA contrast ratios, and complete `prefers-reduced-motion` compliance.

---

## 2. Color System & Design Tokens

The palette is engineered around an authoritative **Deep Indigo & Violet** core, supported by crisp functional semantic colors (Emerald for settled/verified states, Amber for pending balances, Rose for errors) and translucent frosted glass overlays.

### 2.1 Primary & Neutral Tokens

| Token            | Light Value                 | Semantic Purpose                                     |
| ---------------- | --------------------------- | ---------------------------------------------------- |
| `--fg`           | `#0f172a` (Slate 900)       | Primary body typography, high contrast readouts      |
| `--fg-heading`   | `#090d16` (Deep Obsidian)   | Titles, dashboard metric values, prominent headers   |
| `--muted`        | `#64748b` (Slate 500)       | Secondary metadata, subtitles, timestamps            |
| `--muted-light`  | `#94a3b8` (Slate 400)       | Placeholder text, subtle borders, empty state glyphs |
| `--border`       | `rgba(226, 232, 240, 0.8)`  | Standard card, input, and divider border             |
| `--border-focus` | `#6366f1` (Indigo 500)      | Form element active focus ring                       |
| `--bg`           | `#f8fafc` (Slate 50)        | Background surface canvas                            |
| `--card`         | `rgba(255, 255, 255, 0.88)` | Translucent frosted glass card surface               |
| `--card-solid`   | `#ffffff`                   | Solid surface fallback for non-blurring viewports    |

### 2.2 Brand & Accent Tokens

| Token                    | Light Value                                         | Semantic Purpose                                  |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------- |
| `--accent`               | `#4f46e5` (Indigo 600)                              | Primary CTA buttons, active tabs, brand icons     |
| `--accent-hover`         | `#4338ca` (Indigo 700)                              | Primary button hover state                        |
| `--accent-gradient`      | `linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)` | Vibrant button fills, brand badges                |
| `--accent-subtle`        | `rgba(238, 242, 255, 0.85)`                         | Selected rows, soft chip backgrounds, hover fills |
| `--accent-subtle-border` | `#c7d2fe` (Indigo 200)                              | Border for active items and pills                 |
| `--accent-glow`          | `rgba(79, 70, 229, 0.22)`                           | Focus rings and floating button drop shadows      |

### 2.3 Semantic Status Tokens

```css
/* Success & Settled */
--ok-bg: #ecfdf5;           /* Emerald 50 */
--ok-fg: #047857;           /* Emerald 700 */
--ok-border: #a7f3d0;       /* Emerald 200 */
--ok-gradient: linear-gradient(135deg, #10b981 0%, #059669 100%);

/* Warning & Outstanding */
--warn-bg: #fffbeb;         /* Amber 50 */
--warn-fg: #b45309;         /* Amber 700 */
--warn-border: #fde68a;     /* Amber 200 */
--warn-gradient: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);

/* Error & Danger */
--err-bg: #fef2f2;          /* Rose 50 */
--err-fg: #b91c1c;          /* Rose 700 */
--err-border: #fecaca;      /* Rose 200 */
```

---

## 3. Typography Hierarchy & Number Formatting

Typography uses a pairing of **Plus Jakarta Sans** for modern humanist geometric headings and UI controls, and **JetBrains Mono** for all monetary figures, currency amounts, and mathematical breakdowns.

```
Type Scale:
├── Hero Display (Start Page) : 2.5rem (40px) / 1.15 / Bold 800 / Tracking: -0.035em
├── Page Title (Dashboard)    : 1.95rem (31px) / 1.2  / Bold 800 / Tracking: -0.03em
├── Section Header (H2)       : 1.25rem (20px) / 1.3  / SemiBold 700 / Tracking: -0.02em
├── Card Subheading (H3)      : 1.05rem (17px) / 1.4  / SemiBold 600
├── Body Regular              : 0.94rem (15px) / 1.55 / Regular 400
├── Caption & Meta            : 0.82rem (13px) / 1.4  / Medium 500
└── Micro Badge Label         : 0.72rem (11.5px) / 1.2 / Bold 700 / Tracking: 0.06em (Uppercase)
```

### 3.1 Tabular Numerical Figures

All prices, debts, shares, and totals enforce `font-variant-numeric: tabular-nums` and fallback to `JetBrains Mono, SF Mono, Menlo, monospace`. This prevents column jitter during currency updates and guarantees crisp vertical alignment across rows in the split tables.

---

## 4. Glassmorphism & Elevation System

Cards and panels float above an ambient living canvas using multi-stop linear borders and backdrop blurring.

```
       ┌─────────────────────────────────────────────────────────────┐
Layer 3│ Ambient Aurora Glowing Orbs (Deep Canvas Blur)              │
       └─────────────────────────────────────────────────────────────┘
                                  ▼
       ┌─────────────────────────────────────────────────────────────┐
Layer 2│ Frosted Glassmorphism Cards:                                │
       │ - background: rgba(255, 255, 255, 0.82)                     │
       │ - backdrop-filter: blur(16px) saturate(180%)                │
       │ - border: 1px solid rgba(255, 255, 255, 0.6)                │
       │ - box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.05)       │
       └─────────────────────────────────────────────────────────────┘
                                  ▼
       ┌─────────────────────────────────────────────────────────────┐
Layer 1│ Interactive Floating Elements (Modals, Dropdowns, Tooltips) │
       │ - box-shadow: 0 20px 25px -5px rgba(79, 70, 229, 0.12)      │
       └─────────────────────────────────────────────────────────────┘
```

### 4.1 Shadow Tokens

```css
--shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.04);
--shadow-sm: 0 2px 4px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.04);
--shadow-md: 0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -1px rgba(15, 23, 42, 0.03);
--shadow-lg: 0 12px 24px -4px rgba(15, 23, 42, 0.08), 0 4px 8px -2px rgba(15, 23, 42, 0.04);
--shadow-glow: 0 0 24px 0 rgba(99, 102, 241, 0.18);
--shadow-glow-ok: 0 0 20px 0 rgba(16, 185, 129, 0.22);
```

---

## 5. Motion, Keyframes & Animation Language

Motion in BillSplitter is natural and fluid, using a signature cubic bezier spring curve: `cubic-bezier(0.16, 1, 0.3, 1)`.

### 5.1 Keyframe Choreography

1. **Ambient Aurora Float (`@keyframes floatSlow`, `@keyframes floatDrift`)**:
   Three luminous blurred color spheres (Indigo, Teal, Rose/Amber) slowly drift across the background viewport with varying 20-30s durations, creating an organic, dynamic depth of field.
2. **Progress Bar Shimmer (`@keyframes shimmerProgress`)**:
   A sweeping light band flows diagonally across the emerald progress bar of partially paid bills, communicating ongoing financial resolution.
3. **Button Sheen Sweep (`@keyframes buttonSheen`)**:
   On hover or focus, primary CTA buttons play a subtle luminous light reflection across their surface to signify tactile readiness.
4. **Status Pulse Beacons (`@keyframes pulseGlow`)**:
   Live KPI metric cards feature a pulsating beacon dot indicating live synchronization with Cloudflare Workers D1 storage.
5. **Card Stagger Entrance (`@keyframes fadeInUp`)**:
   New views and cards enter with a 12px vertical lift and smooth opacity fade, staggered by 60ms increments.

```css
@keyframes floatSlow {
  0%,
  100% {
    transform: translate(0px, 0px) scale(1);
  }
  50% {
    transform: translate(40px, -30px) scale(1.08);
  }
}

@keyframes shimmerProgress {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(200%);
  }
}

@keyframes pulseGlow {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.35);
    opacity: 0.3;
  }
}
```

---

## 6. Component Anatomy & Exotic Design Features

### 6.1 Ambient Background Orbs (`.ambient-orb`)

Positioned with `fixed` coordinates and negative z-index, using SVG-level hardware-accelerated filters (`filter: blur(80px)`) to provide living ambient backlighting without CPU lag.

### 6.2 Financial KPI Metric Cards (`.metric-card`)

- High-contrast monetary display with custom currency symbol sizing.
- Integrated pulsing live beacon indicator.
- Subtle top border glow accent matching the card's financial health status.

### 6.3 Deterministic Avatar Rings (`.avatar`)

- Avatars use a deterministic string-hash algorithm to compute stable pastel hue values for each roommate.
- Enhanced with a dual-ring border (`outline: 2px solid white`, `box-shadow: 0 2px 8px rgba(...)`) for crisp separation against table backgrounds.

### 6.4 Category Icon Badges (`.bill-cat-icon`)

Category icons (`⚡ Electricity`, `🌐 Internet`, `💧 Water`, `🔥 Gas`, `🏠 Rent`, `🛒 Groceries`, `🧹 Maintenance`, `📄 General`) are housed in rounded glass pebbles with subtle chromatic backgrounds and micro-interaction hover bounce.

### 6.5 Interactive Bill Progress Bars (`.bill-progress-bar`)

- Two-tone emerald gradient bar showing paid vs total ratios.
- Animated shimmering highlight overlay.
- Accessible ARIA progress attributes (`role="progressbar"`, `aria-valuenow`).

### 6.6 Smart Drag-and-Drop Bill OCR Zone (`.dropzone`)

- Animated dash pattern (`border: 2px dashed ...`) with smooth background color expansion when dragging files.
- Live scan progress indicator with animated processing pulses during in-browser or Gemini AI document parsing.

### 6.7 Household Link Share Pill (`.share-link-pill`)

- One-click copy link action in the dashboard header allowing users to immediately invite roommates with instant visual feedback ("✓ Copied to clipboard!").

---

## 7. Responsiveness & Adaptive Grid System

The interface adapts smoothly from mobile screens (320px) up to ultra-wide displays (1920px+):

- **Mobile Viewports (<640px)**: Single column stacked layout. Full-width metric cards, horizontally scrollable shares table with sticky member column, and touch-optimized 44px tap targets.
- **Tablet Viewports (640px - 860px)**: 2-column metrics grid, full-width bill stack, and collapsible sidebar drawers.
- **Desktop Viewports (860px - 1440px)**: 2-column asynchronous dashboard grid:
  - Left column: Flexible main feed for bills, attachments, and payment tables.
  - Right column: Fixed 380px sidebar for adding bills, instant split calculator, and roommate ledger balances.

---

## 8. Accessibility (a11y) & Inclusivity

- **Color Contrast**: All text elements exceed WCAG 2.1 AA (4.5:1) and AAA (7:1 for headings) contrast ratios against their respective backgrounds.
- **Focus Rings**: Clean 3px offset rings (`outline: 3px solid rgba(99, 102, 241, 0.4)`) on all interactive buttons, inputs, and links.
- **Motion Reduction**: Full `@media (prefers-reduced-motion: reduce)` support instantly disables all ambient floating orbs, shimmer sweeps, and entrance transforms while retaining all functionality.
- **Screen Reader Support**: Hidden semantic labels (`.sr-only`), live region announcements for bill calculation states, and descriptive ARIA alerts.
