/** Gmail only accepts label colours from its fixed palette. These are the readable mid-tones from that set. */
export const GMAIL_SWATCHES = ["#fb4c2f", "#ffad47", "#fad165", "#16a766", "#43d692", "#4a86e8", "#a479e2", "#f691b3", "#cc3a21", "#eaa041", "#f2c960", "#149e60", "#3dc789", "#3c78d8", "#8e63ce", "#e07798", "#ac2b16", "#cf8933", "#d5ae49", "#0b804b", "#2a9c68", "#285bac", "#653e9b", "#b65775", "#666666", "#999999", "#cccccc", "#efefef"] as const;

/** Black or white text, whichever reads on the swatch. Both are in Gmail's palette. */
export function textOn(bg: string): "#000000" | "#ffffff" {
  const n = parseInt(bg.replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
}
