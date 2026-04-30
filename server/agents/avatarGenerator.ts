import sharp from "sharp";
import { supabaseServer } from "../supabase";
import { AVATAR_GRID_SIZE, generateAvatar } from "../../client/src/lib/avatar/generator";

const AVATAR_BUCKET = "avatars";
const GENERATED_FILENAME = "avatar.png";

function filledGrid(seed: string): string[][] {
  const result = generateAvatar(seed);
  const n = AVATAR_GRID_SIZE;
  const out: string[][] = Array.from({ length: n }, () => new Array<string>(n).fill("#000000"));
  const filled: Array<{ x: number; y: number; color: string }> = [];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const color = result.grid[y][x];
      if (color !== null) {
        out[y][x] = color;
        filled.push({ x, y, color });
      }
    }
  }

  if (filled.length === 0) return out;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (result.grid[y][x] !== null) continue;
      let best = filled[0];
      let bestD = Infinity;
      for (const f of filled) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      out[y][x] = best.color;
    }
  }

  return out;
}

async function ensureAvatarBucket(): Promise<void> {
  const { data: buckets, error } = await supabaseServer.storage.listBuckets();
  if (error) throw new Error(`Could not list storage buckets: ${error.message}`);
  if (buckets?.some((bucket) => bucket.name === AVATAR_BUCKET)) return;

  const { error: createError } = await supabaseServer.storage.createBucket(AVATAR_BUCKET, {
    public: true,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    fileSizeLimit: 2 * 1024 * 1024,
  });
  if (createError) throw new Error(`Could not create avatars bucket: ${createError.message}`);
}

export function agentAvatarSeed(userId: string): string {
  return `${userId}:agent:v2`;
}

export async function uploadGeneratedAgentAvatar(userId: string, seed: string): Promise<string> {
  await ensureAvatarBucket();

  const scale = 28;
  const size = AVATAR_GRID_SIZE * scale;
  const cells = filledGrid(seed)
    .flatMap((row, y) =>
      row.map((color, x) => (
        `<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${color}" />`
      )),
    )
    .join("");

  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <clipPath id="circle"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" /></clipPath>
      </defs>
      <g clip-path="url(#circle)">${cells}</g>
    </svg>
  `);

  const png = await sharp(svg).png().toBuffer();
  const path = `${userId}/${GENERATED_FILENAME}`;

  const { error: uploadError } = await supabaseServer.storage
    .from(AVATAR_BUCKET)
    .upload(path, png, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "3600",
    });
  if (uploadError) throw new Error(`Avatar upload failed: ${uploadError.message}`);

  const { data } = supabaseServer.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Avatar public URL resolution failed");
  return `${data.publicUrl}?v=${Date.now()}`;
}
