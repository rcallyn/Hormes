export function Icon({ name }: { name: "mic" | "muted" | "pen" | "eraser" | "select" | "close" | "record" | "pause" | "stop" | "question" | "next" | "file" }) {
  const paths = {
    file: <><path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6" /></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    muted: <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3"/></>,
    pen: <><path d="m4 16-1 5 5-1L20 8a2 2 0 0 0-4-4ZM14 6l4 4"/></>,
    eraser: <><path d="m3 14 9-11a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3L11 22H7l-4-4a3 3 0 0 1 0-4ZM8 8l9 9M11 22h10"/></>,
    select: <path d="m5 3 15 10-7 1-3 7Z"/>,
    close: <path d="m6 14 6-6 6 6"/>,
    record: <circle cx="12" cy="12" r="6" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    question: <><path d="M8 8a4 4 0 0 1 8 0c0 3-4 3-4 6M12 18v1" /><circle cx="12" cy="12" r="10" /></>,
    next: <path d="M4 12h15m-6-6 6 6-6 6" />,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
