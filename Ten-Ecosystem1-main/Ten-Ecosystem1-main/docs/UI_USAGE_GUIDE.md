# UI Usage Guide

## Design System
Link both CSS files in any portal page:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/components.css">
```

## Theme Toggle
Add this script before `</body>`:
```html
<script src="/js/theme-toggle.js"></script>
```
Add a toggle button anywhere:
```html
<button data-theme-toggle>Toggle Theme</button>
```

## CSS Variables
| Token | Purpose |
|---|---|
| `--color-primary` | Brand indigo |
| `--color-bg` | Page background |
| `--color-surface` | Card background |
| `--color-border` | Borders & dividers |
| `--color-text` | Primary text |
| `--color-muted` | Secondary text |

## Component Classes
| Class | Description |
|---|---|
| `.ten-card` | Rounded surface card |
| `.ten-btn .ten-btn-primary` | Primary action button |
| `.ten-input` | Form input field |
| `.ten-navbar` | Sticky top navigation |
| `.ten-hero` | Full-width hero section |
| `.ten-grid-2 / -3` | Responsive grid layouts |
| `.ten-stat` | KPI stat card |
| `.ten-alert-*` | Success/warning/danger alerts |
| `.ten-badge` | Pill badge label |
| `.ten-form-group` | Labelled input wrapper |
