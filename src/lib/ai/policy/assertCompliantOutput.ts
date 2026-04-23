export function assertCompliantOutput(output: unknown) {
  const serialized = JSON.stringify(output);

  const blockedMarkers = [
    "rawText",
    "fullText",
    "documentBlob",
    "previewUrl",
    "attachmentUrl",
    "base64",
  ];

  for (const marker of blockedMarkers) {
    if (serialized.includes(`"${marker}"`)) {
      throw new Error(`Unsafe output detected: ${marker}`);
    }
  }

  return output;
}
