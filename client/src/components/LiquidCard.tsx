import { ReactNode, useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

type GradientPreset = "greenCyan" | "purplePink" | "tealYellow";

interface LiquidCardProps {
  children: ReactNode;
  gradient: GradientPreset;
  className?: string;
}

const gradientColors: Record<GradientPreset, { start: string; mid: string; end: string }> = {
  greenCyan: {
    start: "#10b981",
    mid: "#06b6d4",
    end: "#14b8a6",
  },
  purplePink: {
    start: "#a855f7",
    mid: "#ec4899",
    end: "#f472b6",
  },
  tealYellow: {
    start: "#14b8a6",
    mid: "#06b6d4",
    end: "#fbbf24",
  },
};

export function LiquidCard({ children, gradient, className }: LiquidCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const mousePos = useRef({ x: 0.5, y: 0.5 });
  const mouseVelocity = useRef({ x: 0, y: 0 });
  const lastMousePos = useRef({ x: 0.5, y: 0.5 });
  const animationFrameId = useRef<number | null>(null);
  const time = useRef(0);

  const colors = gradientColors[gradient];

  // Simplex noise function (2D)
  const simplex2D = useCallback((x: number, y: number): number => {
    const grad3 = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
    ];

    const p = new Array(512);
    const perm = [
      151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
      140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
      247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
      57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
      74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
      60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
      65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
      200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
      52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
      207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
      119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
      129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
      218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
      81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
      184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
      222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180
    ];

    for (let i = 0; i < 512; i++) {
      p[i] = perm[i % 256];
    }

    const dot = (g: number[], x: number, y: number) => g[0] * x + g[1] * y;

    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = p[ii + p[jj]] % 12;
    const gi1 = p[ii + i1 + p[jj + j1]] % 12;
    const gi2 = p[ii + 1 + p[jj + 1]] % 12;

    let n0, n1, n2;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else {
      t0 *= t0;
      n0 = t0 * t0 * dot(grad3[gi0], x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else {
      t1 *= t1;
      n1 = t1 * t1 * dot(grad3[gi1], x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else {
      t2 *= t2;
      n2 = t2 * t2 * dot(grad3[gi2], x2, y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }, []);

  // Animation loop for canvas
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (!isHovered) {
      // When not hovered, show minimal effect
      time.current += 0.0005;
      mouseVelocity.current.x *= 0.95;
      mouseVelocity.current.y *= 0.95;

      if (Math.abs(mouseVelocity.current.x) < 0.001 && Math.abs(mouseVelocity.current.y) < 0.001) {
        animationFrameId.current = null;
        return;
      }
    } else {
      time.current += 0.001; // Slower time scale for smooth liquid effect
    }

    // Create gradient with animated noise
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const intensity = isHovered ? 1.0 : 0.3;
    const distortion = Math.sqrt(
      mouseVelocity.current.x ** 2 + mouseVelocity.current.y ** 2
    );
    const distortionMagnitude = Math.min(distortion * 1.8, 0.5);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x / width;
        const py = y / height;

        // Multi-octave noise
        const noise1 = simplex2D(
          (px + mousePos.current.x * 2) * 3 + time.current * 10,
          (py + mousePos.current.y * 2) * 3 + time.current * 10
        );
        const noise2 = simplex2D(
          (px - mousePos.current.x * 1.5) * 5 + time.current * 7,
          (py - mousePos.current.y * 1.5) * 5 + time.current * 7
        );
        const noise3 = simplex2D(
          px * 2 + time.current * 5,
          py * 2 - time.current * 5
        );

        const combinedNoise = (noise1 + noise2 * 0.5 + noise3 * 0.3) * intensity;

        // Chromatic aberration offset
        const aberration = combinedNoise * distortionMagnitude * 0.015;

        // Create gradient based on position and noise
        const gradient = (px + py) / 2 + combinedNoise * 0.3;

        // Color mixing with chromatic shift
        const idx = (y * width + x) * 4;
        const alpha = Math.abs(combinedNoise) * 40 * intensity;

        // Parse hex colors
        const parseHex = (hex: string) => ({
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16),
        });

        const c1 = parseHex(colors.start);
        const c2 = parseHex(colors.mid);
        const c3 = parseHex(colors.end);

        // R channel shifted
        const rGrad = Math.max(0, Math.min(1, gradient + aberration));
        const r = c1.r * (1 - rGrad) + c2.r * rGrad;

        // G channel normal
        const gGrad = Math.max(0, Math.min(1, gradient));
        const g = c2.g * (1 - gGrad) + c3.g * gGrad;

        // B channel shifted opposite
        const bGrad = Math.max(0, Math.min(1, gradient - aberration));
        const b = c3.b * (1 - bGrad) + c1.b * bGrad;

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = alpha;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    animationFrameId.current = requestAnimationFrame(animate);
  }, [isHovered, colors, simplex2D]);

  // Handle mouse movement
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Calculate velocity
    const dx = x - lastMousePos.current.x;
    const dy = y - lastMousePos.current.y;

    mouseVelocity.current.x = dx;
    mouseVelocity.current.y = dy;

    lastMousePos.current = { x, y };
    mousePos.current = { x, y };
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (animationFrameId.current === null) {
      animate();
    }
  }, [animate]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    mouseVelocity.current = { x: 0, y: 0 };
  }, []);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden rounded-2xl", className)}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        background: "hsl(var(--card))",
      }}
    >
      {/* Canvas layer - absolutely positioned behind content */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{
          mixBlendMode: "screen",
          opacity: isHovered ? 0.6 : 0.2,
          transition: "opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />

      {/* Gradient background that animates on hover */}
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-700"
        style={{
          opacity: isHovered ? 0.15 : 0,
          background: `radial-gradient(circle at ${mousePos.current.x * 100}% ${mousePos.current.y * 100}%, ${colors.start}, ${colors.mid}, ${colors.end})`,
        }}
      />

      {/* Glow effect on hover */}
      {isHovered && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow: `0 0 60px ${colors.mid}40, inset 0 0 30px ${colors.start}20`,
            transition: "box-shadow 0.6s ease-out",
          }}
        />
      )}

      {/* Content layer */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
