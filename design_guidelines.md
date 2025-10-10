# FameStreem Design Guidelines

## Design Approach
**Reference-Based Approach** drawing from financial tracking platforms (CoinMarketCap, Yahoo Finance) and social trending interfaces (Twitter/X). The design emphasizes real-time data visualization, quick scanability, and dynamic updates while maintaining visual sophistication.

## Core Design Principles
1. **Data-First Hierarchy**: Numbers, trends, and movements take visual priority
2. **Live & Dynamic**: Visual feedback for real-time updates and changes
3. **Quick Scan Optimization**: Users should grasp trends within 3 seconds
4. **Financial Precision**: Crisp, authoritative aesthetic that builds trust

---

## Color Palette

### Dark Mode (Primary)
- **Background**: 220 20% 8% (deep charcoal base)
- **Surface**: 220 18% 12% (elevated cards/panels)
- **Surface Elevated**: 220 16% 16% (hover states, modals)
- **Border**: 220 12% 20% (subtle divisions)
- **Text Primary**: 220 10% 98% (high contrast white)
- **Text Secondary**: 220 8% 65% (muted information)

### Trend Indicators
- **Trending Up**: 142 76% 45% (vibrant green)
- **Trending Down**: 0 72% 51% (bold red)
- **Neutral/Stable**: 220 10% 50% (gray)
- **Accent/Highlight**: 217 91% 60% (electric blue - for CTAs and featured items)

### Light Mode (Secondary)
- **Background**: 0 0% 98%
- **Surface**: 0 0% 100%
- **Text Primary**: 220 20% 10%

---

## Typography

### Font Families
- **Primary (UI/Data)**: 'Inter', system-ui, sans-serif (via Google Fonts)
- **Display (Headlines)**: 'Space Grotesk', sans-serif (via Google Fonts)
- **Monospace (Numbers/Stats)**: 'JetBrains Mono', monospace (via Google Fonts)

### Type Scale
- **Hero/Display**: text-5xl to text-6xl, font-bold, tracking-tight
- **Section Headers**: text-3xl, font-semibold, Space Grotesk
- **Card Titles**: text-lg, font-semibold
- **Rankings/Numbers**: text-2xl to text-4xl, JetBrains Mono, font-bold
- **Stats/Metrics**: text-sm to text-base, JetBrains Mono
- **Body Text**: text-sm to text-base, Inter, leading-relaxed
- **Micro Labels**: text-xs, font-medium, uppercase, tracking-wide

---

## Layout System

### Spacing Primitives
Use Tailwind units: **2, 3, 4, 6, 8, 12, 16, 24** for consistent rhythm
- Tight spacing: p-2, gap-3 (within components)
- Standard spacing: p-4, gap-4, p-6 (cards, sections)
- Generous spacing: p-8, p-12, py-16, py-24 (page sections)

### Grid Patterns
- **Leaderboard**: Single column list with dense rows
- **Widgets Grid**: 3-column on desktop (grid-cols-1 md:grid-cols-3), 1-column mobile
- **Person Cards**: 2-4 columns (grid-cols-1 md:grid-cols-2 lg:grid-cols-4)
- **Max Width**: max-w-7xl for main content container

---

## Component Library

### Navigation
- **Fixed header** with glass morphism effect (backdrop-blur-xl, bg-opacity-80)
- Logo left, primary nav center, user/settings right
- Sticky position with subtle shadow on scroll

### Leaderboard Table
- Alternating row backgrounds for scannability
- Fixed header row with sort indicators
- Rank badges (top 10 gold accent, 11-50 silver tone)
- Hover state: slight bg lift + border accent
- Columns: Rank | Avatar | Name | Trend Score | 24h Change | 7d Change | Actions
- Mobile: Stacked card layout with key metrics

### Trend Widgets
- **Card Design**: rounded-xl, border, p-6, bg-surface
- **Widget Types**: 
  - Daily Movers (compact list, +/- indicators)
  - Weekly Gainers (green gradient background subtle)
  - Weekly Droppers (red tint background subtle)
- Live pulse animation on data update (subtle ring pulse)

### Person Detail Page
- **Hero Section**: Large avatar, name, current rank, primary stats
- **Trend Graph**: Full-width chart area with 1D/7D/30D/ALL toggles
- **Stats Grid**: 3-4 column metrics (followers, engagement, mentions, sentiment)
- **Social Feed Preview**: Recent mentions/activity cards

### Charts & Graphs
- Line charts for trend visualization (use Chart.js or Recharts)
- Green/red gradient fills for positive/negative trends
- Tooltips on hover with precise data points
- Grid lines subtle (opacity 10%)
- Responsive: full-width on mobile, constrained on desktop

### Buttons & CTAs
- **Primary**: bg-accent (blue), text-white, px-6, py-3, rounded-lg, font-semibold
- **Secondary**: border, border-border, hover:bg-surface-elevated
- **Icon Buttons**: p-2, rounded-lg, hover:bg-surface-elevated
- **Trend Indicators**: Pill badges with +/- and percentage

### Data Cards
- Compact height (h-20 to h-24) for density
- Left: Icon/Avatar, Center: Name/Label, Right: Metric/Trend
- Border-l-4 accent for top performers
- Smooth transitions on all interactive states

---

## Animations & Interactions

### Micro-interactions
- Number counter animations on stat changes (count-up effect)
- Smooth color transitions for trend shifts (300ms ease)
- Card hover: subtle translate-y lift (-2px) + shadow increase
- Live update pulse: Brief ring animation (1s) on new data

### Performance
- Use CSS transforms (not margin/padding) for animations
- Limit simultaneous animations to 3-5 elements
- Disable animations on reduced-motion preference

---

## Images

### Avatar/Profile Images
- **Person Avatars**: Circular (rounded-full), 40px-80px sizes depending on context
- **Placeholder**: Initials on gradient background if no image
- **Source**: Use placeholder service or actual API images

### Hero Section
**Large Hero Image**: Yes - Abstract data visualization or network graph
- **Style**: Dark, glowing network nodes connected by lines
- **Treatment**: Gradient overlay (from bg-background to transparent)
- **Position**: Full-width, h-96 on desktop, h-64 on mobile
- **Content**: Centered over image - "Track Fame in Real-Time" headline + CTA

### Iconography
- **Icon Library**: Heroicons (via CDN)
- **Sizes**: 20px (inline), 24px (standard), 32px (featured)
- **Usage**: Trend arrows, refresh, search, filter, user actions

---

## Accessibility

- WCAG AA contrast ratios maintained (4.5:1 for text)
- Focus visible states: 2px ring-accent ring-offset-2
- Keyboard navigation throughout leaderboard
- Screen reader labels for trend indicators ("up 12%", "down 5%")
- Reduced motion support for all animations
- Dark mode as default with light mode toggle

---

## Key UX Patterns

1. **Auto-refresh Indicator**: Small pill in header showing "Updated 3s ago" with live countdown
2. **Rank Change Badges**: Up/down arrows with numeric change since last update
3. **Contextual Tooltips**: Hover any metric for definition and calculation method
4. **Quick Actions**: Star/favorite, share, view details from any list item
5. **Skeleton Loaders**: Shimmer effect while loading data (not spinners)
6. **Empty States**: Friendly illustrations with actionable next steps