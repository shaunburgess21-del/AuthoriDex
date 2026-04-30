type LogoVariant = "default" | "vote" | "predict";

const VARIANT_STYLES: Record<LogoVariant, string> = {
  default: "from-cyan-500 to-blue-600 shadow-cyan-500/25",
  vote: "from-cyan-400 to-teal-600 shadow-cyan-400/25",
  predict: "from-violet-500 to-purple-700 shadow-violet-500/25",
};

interface VoxDexLogoProps {
  size?: number;
  variant?: LogoVariant;
  className?: string;
}

export function VoxDexLogo({ size = 32, variant = "default", className = "" }: VoxDexLogoProps) {
  return (
    <div
      className={`rounded-lg bg-gradient-to-br ${VARIANT_STYLES[variant]} flex items-center justify-center shadow-lg ${className}`}
      style={{ width: size, height: size }}
      data-testid="logo-voxdex"
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: size * 0.9, height: size * 0.9 }}
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
