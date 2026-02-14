interface AuthoriDexLogoProps {
  size?: number;
  className?: string;
}

export function AuthoriDexLogo({ size = 32, className = "" }: AuthoriDexLogoProps) {
  return (
    <div
      className={`rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 ${className}`}
      style={{ width: size, height: size }}
      data-testid="logo-authoridex"
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: size * 0.6, height: size * 0.6 }}
      >
        <path
          d="M50 12L82 40L50 58L18 40L50 12Z"
          fill="white"
          opacity="0.95"
        />
        <path
          d="M50 58L82 40L82 62L50 80L18 62L18 40L50 58Z"
          fill="white"
          opacity="0.6"
        />
        <rect
          x="22"
          y="82"
          width="56"
          height="6"
          rx="3"
          fill="white"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}
