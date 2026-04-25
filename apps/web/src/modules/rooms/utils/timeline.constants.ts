export const TIMELINE = {
  ROW_HEIGHT: 36,
  GROUP_HEADER_HEIGHT: 32,
  DAY_WIDTH: {
    week: 120,
    month: 48,
    quarter: 20,
  },
  MIN_BLOCK_WIDTH: 40,
  COLUMN_WIDTH: 220,
  HEADER_HEIGHT: 80,
  OVERSCAN: 3,
} as const

export const SOURCE_COLORS = {
  direct: {
    bg: '#DCFCE7',
    border: '#86EFAC',
    text: '#166534',
    label: 'Directo',
  },
  booking: {
    bg: '#DBEAFE',
    border: '#93C5FD',
    text: '#1E40AF',
    label: 'Booking',
  },
  expedia: {
    bg: '#FEF9C3',
    border: '#FDE047',
    text: '#713F12',
    label: 'Expedia',
  },
  airbnb: {
    bg: '#FFE4E6',
    border: '#FCA5A5',
    text: '#9F1239',
    label: 'Airbnb',
  },
  'walk-in': {
    bg: '#F1F5F9',
    border: '#CBD5E1',
    text: '#334155',
    label: 'Walk-in',
  },
  other: {
    bg: '#F5F3FF',
    border: '#C4B5FD',
    text: '#4C1D95',
    label: 'Otro',
  },
} as const

export type SourceKey = keyof typeof SOURCE_COLORS

// ─── Stay status colors (operational) ────────────────────────
export const STAY_STATUS_COLORS = {
  UNCONFIRMED: {
    bg:     'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.35)',
    text:   '#92400E',
    label:  'Sin confirmar',
  },
  ARRIVING: {
    bg: '#DBEAFE',
    border: '#93C5FD',
    text: '#1E40AF',
    label: 'Llegada',
  },
  IN_HOUSE: {
    bg: '#DCFCE7',
    border: '#86EFAC',
    text: '#166534',
    label: 'Alojado',
  },
  DEPARTING: {
    bg: '#FEF9C3',
    border: '#FDE047',
    text: '#713F12',
    label: 'Salida',
  },
  DEPARTED: {
    bg: '#F1F5F9',
    border: '#CBD5E1',
    text: '#334155',
    label: 'Completado',
  },
  NO_SHOW: {
    bg: '#FEF2F2',
    border: '#FECACA',
    text: '#7F1D1D',
    label: 'No-show',
  },
} as const

export type StayStatusKey = keyof typeof STAY_STATUS_COLORS

// ─── OTA accent colors (left border stripe) ─────────────────
export const OTA_ACCENT_COLORS: Record<string, string> = {
  'walk-in':      '#64748B',
  'direct':       '#059669',
  'booking':      '#003580',
  'expedia':      '#B45309',
  'airbnb':       '#E11D48',
  'hotels_com':   '#C2001A',
  'agoda':        '#5C3B8C',
  'tripadvisor':  '#34E0A1',
  'hostelworld':  '#F97316',
  'despegar':     '#0055A5',
  'google':       '#4285F4',
  'other':        '#7C3AED',
}

export const STATUS_DOT_COLORS: Record<string, string> = {
  AVAILABLE: '#10B981',
  OCCUPIED: '#6366F1',
  CHECKING_OUT: '#F59E0B',
  CLEANING: '#06B6D4',
  INSPECTION: '#8B5CF6',
  MAINTENANCE: '#F97316',
  OUT_OF_SERVICE: '#64748B',
}
