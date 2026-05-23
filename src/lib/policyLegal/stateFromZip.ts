type ZipRange = {
  state: string;
  min: number;
  max: number;
};

const ZIP_RANGES: ZipRange[] = [
  { state: "MA", min: 10, max: 27 },
  { state: "RI", min: 28, max: 29 },
  { state: "NH", min: 30, max: 38 },
  { state: "ME", min: 39, max: 49 },
  { state: "VT", min: 50, max: 59 },
  { state: "CT", min: 60, max: 69 },
  { state: "NJ", min: 70, max: 89 },
  { state: "NY", min: 90, max: 149 },
  { state: "PA", min: 150, max: 196 },
  { state: "DE", min: 197, max: 199 },
  { state: "DC", min: 200, max: 205 },
  { state: "MD", min: 206, max: 219 },
  { state: "VA", min: 201, max: 201 },
  { state: "VA", min: 220, max: 246 },
  { state: "WV", min: 247, max: 268 },
  { state: "NC", min: 270, max: 289 },
  { state: "SC", min: 290, max: 299 },
  { state: "GA", min: 300, max: 319 },
  { state: "FL", min: 320, max: 349 },
  { state: "AL", min: 350, max: 369 },
  { state: "TN", min: 370, max: 385 },
  { state: "MS", min: 386, max: 397 },
  { state: "KY", min: 400, max: 427 },
  { state: "OH", min: 430, max: 459 },
  { state: "IN", min: 460, max: 479 },
  { state: "MI", min: 480, max: 499 },
  { state: "IA", min: 500, max: 528 },
  { state: "WI", min: 530, max: 549 },
  { state: "MN", min: 550, max: 567 },
  { state: "SD", min: 570, max: 577 },
  { state: "ND", min: 580, max: 588 },
  { state: "MT", min: 590, max: 599 },
  { state: "IL", min: 600, max: 629 },
  { state: "MO", min: 630, max: 658 },
  { state: "KS", min: 660, max: 679 },
  { state: "NE", min: 680, max: 693 },
  { state: "LA", min: 700, max: 714 },
  { state: "AR", min: 716, max: 729 },
  { state: "OK", min: 730, max: 749 },
  { state: "TX", min: 750, max: 799 },
  { state: "CO", min: 800, max: 816 },
  { state: "WY", min: 820, max: 831 },
  { state: "ID", min: 832, max: 838 },
  { state: "UT", min: 840, max: 847 },
  { state: "AZ", min: 850, max: 865 },
  { state: "NM", min: 870, max: 884 },
  { state: "NV", min: 889, max: 898 },
  { state: "CA", min: 900, max: 961 },
  { state: "HI", min: 967, max: 968 },
  { state: "OR", min: 970, max: 979 },
  { state: "WA", min: 980, max: 994 },
  { state: "AK", min: 995, max: 999 },
];

export function resolveStateFromZip(zip: string | number | null | undefined): string | null {
  const normalized = String(zip ?? "").trim().match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (!normalized) return null;

  const prefix = Number(normalized.slice(0, 3));
  if (!Number.isFinite(prefix)) return null;

  const match = ZIP_RANGES.find((range) => prefix >= range.min && prefix <= range.max);
  return match?.state ?? null;
}

export function extractZipFromText(text: string): string | null {
  return text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? null;
}
