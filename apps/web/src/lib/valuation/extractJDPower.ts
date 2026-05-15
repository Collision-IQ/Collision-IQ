type JDPowerFile = {
  text?: string | null;
};

export function extractJDPower(files: JDPowerFile[]) {
  for (const file of files) {
    const text = file.text || "";

    if (text.includes("JD Power") || text.includes("J.D. Power")) {
      return text;
    }
  }

  return null;
}
