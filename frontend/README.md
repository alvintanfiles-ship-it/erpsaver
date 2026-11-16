# ParkERP Frontend

React + TypeScript + Vite frontend for ParkERP.

## Tech Stack

- React 18 with TypeScript
- Vite for build tooling
- React Router v6 for navigation
- Zustand for state management
- Leaflet + React Leaflet for maps
- Axios for API calls
- CSS Variables for theming

## Features

- **Trip Planner** (Flow A): Origin/destination input with autocomplete, route preview, ERP cost analysis
- **Parking Results**: Live carpark availability with status indicators
- **Navigation View** (Flow B): Turn-by-turn map with reroute alerts
- **Adaptive Theming**: Light/Dark/Auto with navigation mode (forced dark)
- **Speed Lockout**: Disables input above 15 km/h
- **Touch-friendly**: 50dp minimum touch targets

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173` with API proxy to `http://localhost:3000`.

## Project Structure

```
src/
├── api/           # API client
├── components/    # Reusable UI components
├── pages/         # Route pages
├── stores/        # Zustand state stores
├── styles/        # Global CSS
├── utils/         # Helpers
├── App.tsx        # Root component
└── main.tsx       # Entry point
```

## Core Flows

### Flow A: Pre-Trip ERP & Parking
1. User enters origin/destination
2. App geocodes via OneMap API
3. Route preview with ERP cost calculation
4. User taps "Check Nearby Parking"
5. App queries nearby carparks via URA Space API
6. Results shown with live availability status

### Flow B: Dynamic Rerouting
1. User selects carpark → Navigation starts
2. Map shows route to carpark entrance
3. If carpark fills up (<5 lots), reroute alert appears
4. One-tap reroute to next best alternative

## Theming

CSS variables defined in `src/styles/index.css`:

```css
:root {
  --color-bg-primary: #F8F9FA;    /* Off-White */
  --color-bg-secondary: #FFFFFF;
  --color-primary: #00ADB5;       /* Electric Teal */
  --color-available: #2ECC71;     /* Emerald Green */
  --color-filling: #F1C40F;       /* Amber Gold */
  --color-critical: #E74C3C;      /* Crimson Red */
}
```

Dark mode: `[data-theme="dark"]`
Navigation mode: `[data-theme="navigation"]` (forced dark)

## API Integration

All API calls go through `/api/v1` proxy to backend:

- Geocoding: `/geocoding/search`, `/geocoding/reverse`
- Routing: `/routing/plan`, `/routing/preview`, `/routing/reroute`
- ERP: `/erp/cost`, `/erp/windows`, `/erp/gantries`
- Parking: `/parking/nearby`, `/parking/:id`, `/parking/code/:code`

## Build

```bash
npm run build
```

Output in `dist/` ready for static hosting.

## Environment Variables

Create `.env.local`:
```
VITE_API_URL=http://localhost:3000/api/v1
```