/** Gmail calls the Primary category PERSONAL in its API. Use stable system IDs rather than UI search aliases. */
export const SMART_LABELS: Record<string, string> = {
  "smart:primary": "CATEGORY_PERSONAL",
  "smart:newsletter": "CATEGORY_PROMOTIONS",
  "smart:notification": "CATEGORY_UPDATES",
  "smart:social": "CATEGORY_SOCIAL",
  "smart:forums": "CATEGORY_FORUMS",
};
