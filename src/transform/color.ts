/**
 * Token color synthesis: convert a dspack color value into the `#rrggbb` form
 * that the A2UI `theme.primaryColor` schema requires (pattern ^#[0-9a-fA-F]{6}$).
 *
 * dspack stores resolved values as strings in whatever notation the source used.
 * The shadcn source uses `hsl(H, S%, L%)`. Anything already in `#rrggbb` passes
 * through; anything we cannot parse returns null so the caller can record a
 * lossy/cannot-represent warning instead of emitting an invalid color.
 */

export function toHex6(value: string): string | null {
  const v = value.trim();

  // Already a 6-digit hex.
  const hex = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (hex) return `#${hex[1].toLowerCase()}`;

  // 3-digit hex -> expand.
  const hex3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v);
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`.toLowerCase();

  // hsl(H, S%, L%) / hsl(H S% L%), with an optional alpha channel, anchored to the
  // end of the string so trailing garbage (e.g. "hsl(0,0%,0%)x") is rejected.
  const hsl =
    /^hsla?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)\s*$/.exec(v);
  if (hsl) return hslToHex(parseFloat(hsl[1]), parseFloat(hsl[2]), parseFloat(hsl[3]));

  return null;
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const ch = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}
