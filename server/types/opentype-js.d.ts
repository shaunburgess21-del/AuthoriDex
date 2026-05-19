declare module "opentype.js" {
  export interface Font {
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
