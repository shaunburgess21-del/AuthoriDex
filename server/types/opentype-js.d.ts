declare module "opentype.js" {
  export interface FontTables {
    head?: { unitsPerEm?: number };
    hhea?: { ascender?: number; descender?: number };
    os2?: { sTypoAscender?: number; sTypoDescender?: number };
  }

  export interface Font {
    tables: FontTables;
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize: number,
    ): { toPathData(decimalPlaces?: number): string };
    getAdvanceWidth(text: string, fontSize: number): number;
  }

  export function parse(buffer: ArrayBuffer | Buffer): Font;
}
