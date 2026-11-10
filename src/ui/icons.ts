/** Inline line icons (stroke = currentColor), so the UI ships without image files. */
const line = (body: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  garage: line('<path d="M3 10.5 12 4l9 6.5V20H3z"/><path d="M7 20v-6h10v6"/><path d="M7 17h10"/>'),
  route: line('<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>'),
  brush: line('<path d="M14.5 4.5 19.5 9.5 11 18l-5-5z"/><path d="M6 13c-2 .6-2.6 2.6-2.8 5.8 3.2-.2 5.2-.8 5.8-2.8"/><path d="m16.5 2.5 5 5"/>'),
  tag: line('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>'),
  sliders: line('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
  left: line('<path d="M15 5l-7 7 7 7"/>'),
  right: line('<path d="M9 5l7 7-7 7"/>'),
  play: line('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/>'),
  coin: line('<path d="M12 2.8 19.8 7.3v9.4L12 21.2l-7.8-4.5V7.3z"/><path d="M14.6 9.4a3 3 0 1 0 0 5.2"/>'),
  user: line('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/>'),
  lock: line('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  check: line('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  arrow: line('<path d="M4 12h15M13 6l6 6-6 6"/>'),
  pause: line('<path d="M9 5v14M15 5v14"/>'),
  reset: line('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  paint: line('<path d="M12 3.5c3.6 4.2 5.5 7.3 5.5 9.7a5.5 5.5 0 0 1-11 0c0-2.4 1.9-5.5 5.5-9.7z"/>'),
  wheel: line('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>'),
  window: line('<path d="M3.5 16.5 7 9.5c.4-.7 1-1 1.8-1h6.4c.8 0 1.4.3 1.8 1l3.5 7"/><path d="M3 16.5h18"/><path d="M9 8.5 7.5 13h9L15 8.5" opacity=".55"/>'),
  height: line('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
};

/** Drivetrain diagram: driven axle drawn solid. */
export function driveIcon(layout: 'FWD' | 'RWD' | 'AWD' | 'stock'): string {
  if (layout === 'stock') return line('<path d="M5 19 12 5l7 14M7.8 14h8.4"/>');
  const front = layout === 'FWD' || layout === 'AWD';
  const rear = layout === 'RWD' || layout === 'AWD';
  const w = (x: number, y: number, on: boolean) =>
    `<rect x="${x}" y="${y}" width="3.6" height="5.4" rx="1"${on ? ' fill="currentColor"' : ''}/>`;
  return line(`${w(4.2, 3, front)}${w(16.2, 3, front)}${w(4.2, 15.6, rear)}${w(16.2, 15.6, rear)}<path d="M7.8 5.7h8.4M7.8 18.3h8.4M12 5.7v12.6"/>`);
}
