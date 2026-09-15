declare module "opentype.js" {
  export interface FontTables {
    head?: { unitsPerEm?: number };
    hhea?: { ascender?: number; descender?: number };
    os2?: { sTypoAscender?: number; sTypoDescender?: number };
  }

  export type PathCommand =
    | { type: "M"; x: number; y: number }
    | { type: "L"; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "Z" };

  export interface GlyphPath {
    commands: PathCommand[];
    toPathData(decimalPlaces?: number): string;
  }

  export interface Font {
    tables: FontTables;
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize: number,
    ): GlyphPath;
    getAdvanceWidth(text: string, fontSize: number): number;
  }

  export function parse(buffer: ArrayBuffer | Buffer): Font;
}
