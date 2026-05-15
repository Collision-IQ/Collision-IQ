import assert from "node:assert/strict";
import {
  assessDisplayQuality,
  cleanDisplayLabel,
  cleanDisplayText,
  getDisplayVehicleInfo,
} from "./displayText.js";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("cleanDisplayLabel strips OCR confidence suffix junk from short labels", () => {
  assert.equal(cleanDisplayLabel("wheelm0.2"), "Wheel");
  assert.equal(cleanDisplayLabel("wheelm0.1"), "Wheel");
  assert.equal(cleanDisplayLabel("mirror0.3"), "Mirror");
  assert.equal(cleanDisplayLabel("trim panel0.5"), "Trim Panel");
  assert.equal(cleanDisplayLabel("batterym0.3"), "Battery");
});

runTest("cleanDisplayText preserves ordinary phrases while removing OCR suffix junk", () => {
  assert.equal(
    cleanDisplayText("Replace wheelm0.2 and mirror0.3 before delivery."),
    "Replace wheel and mirror before delivery."
  );
});

runTest("getDisplayVehicleInfo removes awkward body-style suffixes from trim display", () => {
  assert.deepEqual(
    getDisplayVehicleInfo({
      year: 2021,
      make: "GMC",
      model: "Acadia",
      trim: "AT4 AWD 4D UTV",
    }),
    {
      label: "2021 GMC Acadia AT4 AWD",
      trim: "AT4 AWD",
    }
  );
});

runTest("cleanDisplayLabel does not over-normalize legitimate acronyms", () => {
  assert.equal(cleanDisplayLabel("OEM front radar bracket"), "OEM Front Radar Bracket");
  assert.equal(cleanDisplayLabel("ADAS calibration"), "ADAS Calibration");
});

runTest("assessDisplayQuality flags noisy OCR-heavy labels", () => {
  const result = assessDisplayQuality({
    vehicleLabel: "2021 GMC Acadia AT4 AWD",
    supplementItems: [
      { title: "wheelm0.2" },
      { title: "mirror0.3" },
      { title: "OEM Front Radar Bracket" },
    ],
  });

  assert.equal(result.noisy, true);
  assert.equal(result.lowQualityItemCount >= 1, true);
});

runTest("assessDisplayQuality flags malformed vehicle labels", () => {
  const result = assessDisplayQuality({
    vehicleLabel: "2021 GMC Acadia AT4 AWD 4D UTV",
    supplementItems: [{ title: "OEM Front Radar Bracket" }],
  });

  assert.equal(result.noisy, true);
  assert.equal(result.malformedVehicle, true);
});
