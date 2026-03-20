export type ChunkMetadata = {
  system: string | null
  component: string | null
  procedure: string | null
}

const SYSTEMS = [
  "ADAS","SRS","Airbag","Radar","Camera","Blind Spot",
  "Lane Keep","Parking Sensor","Brake","Steering",""
]

const PROCEDURES = [
  "Calibration",
  "Diagnostic Scan",
  "Pre-Scan",
  "Post-Scan",
  "Verification",
  "Initialization",
  "Programming",
  "Reset",
  "Inspection",
  "Replacement",
  "Installation",
  "Removal",
  "Repairs and Inspections Required After a Collision"
]

const COMPONENTS = [
  "Radar","Camera","Windshield","Bumper","Grille","Airbag",
  "Seat Belt","Sensor","Module"
]

function firstMatch(text: string, values: string[]): string | null {
  const lower = text.toLowerCase()

  for (const value of values) {
    if (lower.includes(value.toLowerCase())) {
      return value
    }
  }

  return null
}

export function extractMetadata(input: {
  text: string
  drivePath?: string | null
}): ChunkMetadata {

  const combined = `${input.drivePath ?? ""}\n${input.text}`

  return {
    system: firstMatch(combined, SYSTEMS),
    component: firstMatch(combined, COMPONENTS),
    procedure:
      firstMatch(combined, PROCEDURES) ??
      (combined.toLowerCase().includes("repairs and inspections required")
        ? "Repairs and Inspections Required"
        : null)
}
}
