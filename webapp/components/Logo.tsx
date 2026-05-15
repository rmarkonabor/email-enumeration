export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Envelope */}
      <rect x="4" y="16" width="36" height="28" rx="3" fill="#1e5fa8" />
      <path d="M4 19L22 33L40 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 44L18 30M40 44L26 30" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" />
      {/* Magnifying glass */}
      <circle cx="42" cy="30" r="15" fill="#bfe0ff" stroke="#2b8fe0" strokeWidth="3" />
      <circle cx="42" cy="30" r="11" fill="#e6f2fb" fillOpacity="0.7" />
      {/* @ symbol */}
      <circle cx="42" cy="30" r="3.2" stroke="#2b8fe0" strokeWidth="2" />
      <path d="M45.2 30v3a2.5 2.5 0 004.6-1.3 8 8 0 10-3 6" stroke="#2b8fe0" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Sparkles */}
      <path d="M52 19l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="white" />
      <path d="M49 25l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" fill="white" />
      {/* Handle */}
      <rect x="52" y="40" width="10" height="4" rx="2" transform="rotate(45 52 40)" fill="#2b8fe0" />
    </svg>
  );
}
