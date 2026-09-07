/**
 * A single inline SVG icon set. Everything is stroked with `currentColor` on a
 * 24×24 grid, so icons inherit colour from whatever they sit in and stay sharp
 * in both themes without a second asset.
 */

export type IconName = keyof typeof PATHS;

const PATHS = {
  /* Resource glyphs */
  group: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  vnet: 'M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3M12 4v3M12 17v3',
  subnet: 'M4 8h16M4 16h16M8 4v16',
  vm: 'M4 5h16v10H4zM9 19h6M12 15v4',
  scaleset: 'M3 8h10v8H3zM8 5h10M8 5v3M18 5v8h-3M15 13v3',
  app: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 0 0 18 14 14 0 0 0 0-18',
  container: 'M4 9l8-4 8 4-8 4zM4 9v6l8 4 8-4V9M12 13v6',
  kubernetes: 'M12 3l7.5 4v10L12 21l-7.5-4V7zM12 8v8M12 12l4-2M12 12l-4-2M12 12l3 3M12 12l-3 3',
  function: 'M13 3l-8 10h6l-2 8 8-10h-6z',
  plan: 'M4 6h16v12H4zM4 10h16M8 14h8',
  storage: 'M4 6h16v4H4zM4 14h16v4H4zM7 8h.01M7 16h.01',
  blob: 'M12 4c4 0 7 2 7 4v8c0 2-3 4-7 4s-7-2-7-4V8c0-2 3-4 7-4M5 8c0 2 3 4 7 4s7-2 7-4',
  share: 'M4 5h16v14H4zM4 10h16M9 10v9',
  queue: 'M3 7h4v10H3zM10 7h4v10h-4zM17 7h4v10h-4z',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  sql: 'M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  cosmos: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M4 12c5-4 11-4 16 0M4 12c5 4 11 4 16 0',
  mysql: 'M4 8c0-2 3.6-3.5 8-3.5s8 1.5 8 3.5-3.6 3.5-8 3.5S4 10 4 8M4 8v8c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V8',
  vault: 'M5 4h14v16H5zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 15v3',
  logs: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h4',
  shield: 'M12 3l8 3v6c0 4.4-3.4 8.1-8 9-4.6-.9-8-4.6-8-9V6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18',
  balance: 'M12 4v16M6 8h12M6 8l-3 6h6zM18 8l-3 6h6z',
  gateway: 'M12 3l4 4-4 4-4-4zM12 13l4 4-4 4-4-4zM3 12l4-4 4 4-4 4zM13 12l4-4 4 4-4 4z',
  dns: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 10h8M8 14h5',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  module: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4M20 7v10l-8 4M12 11v10',
  resource: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z',
  identity: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 20a8 8 0 0 1 16 0',

  /* Interface glyphs */
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  save: 'M5 4h11l4 4v12H5zM8 4v6h7V4M8 20v-6h8v6',
  check: 'M4 12l5 5L20 6',
  download: 'M12 4v10M8 11l4 4 4-4M4 19h16',
  upload: 'M12 18V8M8 11l4-4 4 4M4 19h16',
  undo: 'M9 8H4V3M4 8a9 9 0 1 1 1 9',
  redo: 'M15 8h5V3M20 8a9 9 0 1 0-1 9',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  bell: 'M6 9a6 6 0 1 1 12 0v5l2 3H4l2-3zM10 20a2 2 0 0 0 4 0',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6M12 17h.01',
  edit: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  play: 'M7 4l12 8-12 8z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  sun: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10',
} as const;

interface IconProps {
  name: IconName | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, className, strokeWidth = 1.7 }: IconProps) {
  const path = PATHS[name as IconName] ?? PATHS.resource;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export const hasIcon = (name: string): boolean => name in PATHS;
