import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.css',
  ],
  // Safelist evita que o JIT remova classes custom usadas via @apply em
  // globals.css. Sem isso, o PostCSS quebra com "class does not exist" e o
  // servidor inteiro retorna 500.
  safelist: [
    'bg-primary', 'bg-primary-focus', 'bg-primary-onDark',
    'text-primary', 'text-primary-focus', 'text-primary-onDark',
    'border-primary', 'border-primary-focus', 'border-primary-onDark',
    'bg-canvas', 'bg-parchment', 'bg-pearl',
    'text-canvas', 'text-parchment', 'text-pearl',
    'border-canvas', 'border-parchment', 'border-pearl',
    'bg-ink', 'text-ink', 'border-ink',
    'bg-ink-muted-80', 'text-ink-muted-80', 'border-ink-muted-80',
    'bg-ink-muted-48', 'text-ink-muted-48', 'border-ink-muted-48',
    'bg-body-muted', 'text-body-muted', 'border-body-muted',
    'bg-tile-1', 'bg-tile-2', 'bg-tile-3',
    'text-tile-1', 'text-tile-2', 'text-tile-3',
    'bg-hairline', 'text-hairline', 'border-hairline',
    'bg-divider-soft', 'text-divider-soft', 'border-divider-soft',
    'bg-chip-translucent', 'text-chip-translucent', 'border-chip-translucent',
    'rounded-none', 'rounded-xs', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-full',
    'text-hero-display', 'text-display-lg', 'text-display-md',
    'text-lead', 'text-lead-airy', 'text-tagline',
    'text-body', 'text-body-strong', 'text-caption', 'text-caption-strong',
    'text-button-large', 'text-button-utility', 'text-fine-print',
    'p-xxs', 'p-xs', 'p-sm', 'p-md', 'p-lg', 'p-xl', 'p-xxl', 'p-section',
    'm-xxs', 'm-xs', 'm-sm', 'm-md', 'm-lg', 'm-xl', 'm-xxl',
    'shadow-product', 'shadow-hairline',
    'backdrop-blur-frosted',
  ],
  theme: {
    extend: {
      colors: {
        // Apple Design System — Action Blue é o único accent interativo.
        primary: {
          DEFAULT: '#0066cc',
          focus: '#0071e3',
          onDark: '#2997ff',
        },
        // Superfícies — alternância clara/escura é o divisor visual.
        canvas: '#ffffff',
        parchment: '#f5f5f7',
        pearl: '#fafafc',
        ink: '#1d1d1f',
        'ink-muted-80': '#333333',
        'ink-muted-48': '#7a7a7a',
        'body-muted': '#cccccc',
        tile: {
          1: '#272729',
          2: '#2a2a2c',
          3: '#252527',
        },
        hairline: '#e0e0e0',
        'divider-soft': '#f0f0f0',
        'chip-translucent': '#d2d2d7',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        // Tipografia Apple — tracking negativo em display, body em 17px.
        'hero-display': ['56px', { lineHeight: '1.07', letterSpacing: '-0.28px', fontWeight: '600' }],
        'display-lg': ['40px', { lineHeight: '1.10', letterSpacing: '0', fontWeight: '600' }],
        'display-md': ['34px', { lineHeight: '1.47', letterSpacing: '-0.374px', fontWeight: '600' }],
        lead: ['28px', { lineHeight: '1.14', letterSpacing: '0.196px', fontWeight: '400' }],
        'lead-airy': ['24px', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '300' }],
        tagline: ['21px', { lineHeight: '1.19', letterSpacing: '0.231px', fontWeight: '600' }],
        body: ['17px', { lineHeight: '1.47', letterSpacing: '-0.374px', fontWeight: '400' }],
        'body-strong': ['17px', { lineHeight: '1.24', letterSpacing: '-0.374px', fontWeight: '600' }],
        caption: ['14px', { lineHeight: '1.43', letterSpacing: '-0.224px', fontWeight: '400' }],
        'caption-strong': ['14px', { lineHeight: '1.29', letterSpacing: '-0.224px', fontWeight: '600' }],
        'button-large': ['18px', { lineHeight: '1.0', letterSpacing: '0', fontWeight: '300' }],
        'button-utility': ['14px', { lineHeight: '1.29', letterSpacing: '-0.224px', fontWeight: '400' }],
        'fine-print': ['12px', { lineHeight: '1.0', letterSpacing: '-0.12px', fontWeight: '400' }],
      },
      borderRadius: {
        none: '0',
        xs: '5px',
        sm: '8px',
        md: '11px',
        lg: '18px',
        full: '9999px',
      },
      boxShadow: {
        // Única sombra do sistema — aplicada somente sobre renders/imagens.
        product: 'rgba(0,0,0,0.22) 3px 5px 30px 0',
        hairline: '0 0 0 1px rgba(0,0,0,0.08)',
      },
      backdropBlur: {
        frosted: '20px',
      },
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        md: '17px',
        lg: '24px',
        xl: '32px',
        xxl: '48px',
        section: '80px',
      },
    },
  },
  plugins: [],
};

export default config;
