/**
 * RO 21995 — 2026 Rivian R1S Dual Motor. Shop final (CCC, 9/25/2026 2:47 PM)
 * vs carrier SOR-3 (9/25/2026 1:18 PM), hand-built from the two prints for the
 * appraisal-summary engine spec.
 *
 * Totals are verbatim from the printed ESTIMATE TOTALS blocks. Lines are the
 * subset the checks need (no owner PII), so the non-labor bucket guard runs
 * with strictLines:false on this partial fixture. The production-path rows of
 * the same pair live in tests/fixtures/21995/.
 */
import type { Estimate } from "../../appraisalSummary/types";

export const shop: Estimate = {
  role: "shop", fileName: "Shop final 21995.pdf",
  vehicle: "2026 RIVI R1S w/Dual Motor Large Pack 4D UTV Electric",
  totals: {
    parts: 16385.74, misc: 5464.32,
    labor: [
      { cat: "body", label: "Body Labor", hours: 32.6, rate: 90, cost: 2934.0 },
      { cat: "paint", label: "Paint Labor", hours: 9.7, rate: 90, cost: 873.0 },
      { cat: "mechanical", label: "Mechanical Labor", hours: 38.7, rate: 175, cost: 6772.5 },
      { cat: "aluminum", label: "Aluminum Or Steel Repair", hours: 9.0, rate: 135, cost: 1215.0 },
    ],
    paintSupplies: { hours: 9.7, rate: 60, cost: 582.0 },
    subtotal: 34226.56, tax: 1953.13, grandTotal: 36179.69,
  },
  lines: [
    { line: 25, oper: "R&I", desc: "Water pump powertrain", hours: 0.4, laborCat: "body" },
    { line: 68, oper: "Subl", desc: "Forklift frame from lot", qty: 1, price: 175.0, manual: true },
    { line: 69, desc: "Prep grounds & clamps", hours: 1.0, laborCat: "aluminum", manual: true },
    { line: 70, desc: "Inspect & secure all gounds", hours: 1.0, laborCat: "mechanical", manual: true },
    { line: 76, desc: "Isolate high voltage", hours: 1.0, laborCat: "mechanical", manual: true },
    { line: 77, desc: "Confirm high voltage isolation", hours: 0.5, laborCat: "mechanical", manual: true },
    { line: 78, oper: "Repl", desc: "Oil pump", partNumber: "PT00438287C", qty: 1, price: 207.0, hours: 1.0, laborCat: "mechanical" },
    { line: 82, oper: "Repl", desc: "Oil filter", partNumber: "PT00340699C", qty: 1, price: 19.0, hours: 0.2, laborCat: "mechanical" },
    { line: 102, oper: "Repl", desc: "Opt OEM RT & LT Front Pirelli Scorpion MS HL275/50R22 +34%", partNumber: "ITW", qty: 2, price: 1192.6 },
    { line: 105, oper: "Subl", desc: "Transport vehicle to sublet", price: 665.98, manual: true },
    { line: 106, oper: "Subl", desc: "Transport from sublet", price: 665.98, manual: true },
    { line: 109, desc: "Test wheel torque post-repair test drive", hours: 0.2, laborCat: "mechanical", manual: true },
    { line: 129, oper: "Repl", desc: "RT Strut assy", partNumber: "PT00964204B", qty: 1, price: 1980.0 },
    { line: 130, oper: "Repl", desc: "RT Axle assy dual/tri motor", partNumber: "PT00087074G", qty: 1, price: 770.0, hours: 1.6, laborCat: "mechanical" },
    { line: 134, oper: "R&I", desc: "R&I susp crossmember", hours: 4.8, laborCat: "mechanical" },
    { line: 135, oper: "Repl", desc: "Subframe", partNumber: "C200748804J", qty: 1, price: 2000.0 },
    { line: 144, oper: "R&I", desc: "Crossmember assy", hours: 1.0, laborCat: "body" },
    { line: 170, oper: "R&I", desc: "RT Water shield upper", hours: 0.2, laborCat: "body" },
    { line: 186, oper: "Rpr", desc: "Pre repair scan", hours: 1.0, laborCat: "mechanical", manual: true },
    { line: 188, oper: "Rpr", desc: "Research DTC's", hours: 0.5, laborCat: "mechanical", manual: true },
    { line: 199, oper: "Rpr", desc: "Calibrate Drivers Assistant camera(Driver assistance camera)", hours: 0.3, laborCat: "mechanical", manual: true },
    { line: 201, oper: "Rpr", desc: "Post repair scan", hours: 1.0, laborCat: "mechanical", manual: true },
    { line: 202, oper: "Rpr", desc: "Research DTC's", hours: 0.5, laborCat: "mechanical", manual: true },
    { line: 204, desc: "Test lug torque post safety test", hours: 0.2, laborCat: "mechanical", manual: true },
  ],
};

export const carrier: Estimate = {
  role: "carrier", fileName: "SOR-3 21995.pdf",
  vehicle: "2026 RIVI R1S w/Dual Motor Large Pack 4D UTV Electric",
  totals: {
    parts: 25500.94, misc: 0,
    labor: [
      { cat: "body", label: "Body Labor", hours: 27.6, rate: 65, cost: 1794.0 },
      { cat: "paint", label: "Paint Labor", hours: 8.4, rate: 65, cost: 546.0 },
      { cat: "mechanical", label: "Mechanical Labor", hours: 34.6, rate: 95, cost: 3287.0 },
      { cat: "frame", label: "Frame Labor", hours: 1.0, rate: 75, cost: 75.0 },
    ],
    paintSupplies: { hours: 8.4, rate: 44, cost: 369.6 },
    subtotal: 31572.54, tax: 1894.35, grandTotal: 33466.89,
  },
  altPartsUsage: { aftermarket: 0, optionalOem: 0, reconditioned: 0, recycled: 0 },
  lines: [
    { line: 5, oper: "Repl", desc: "Aim camera", qty: 1, hours: 2.1, laborCat: "mechanical",
      note: "LABOR: Time includes calibrate all surround view cameras. Time does not include calibrate windshield cameras." },
    { line: 19, oper: "R&I", desc: "Water pump powertrain", hours: 0.4, laborCat: "mechanical", supplement: "S03" },
    { line: 56, desc: "Prep, inspect, and secure all grounds and clamps", qty: 1, hours: 2.0, laborCat: "body", manual: true },
    { line: 57, desc: "Forklift frame from lot", qty: 1, manual: true, supplement: "S03" },
    { line: 59, oper: "Repl", desc: "High voltage system deactivate/activate", qty: 1, hours: 2.8, laborCat: "mechanical" },
    { line: 61, oper: "Repl", desc: "Oil pump", partNumber: "PT00438287C", qty: 1, price: 207.0 },
    { line: 62, oper: "Repl", desc: "External oil filter", qty: 1, price: 19.0, manual: true },
    { line: 63, oper: "Repl", desc: "Bolt", partNumber: "sc00007619-a", qty: 4, price: 23.0, manual: true },
    { line: 72, oper: "Repl", desc: "RT Side mount bolt M12x1_75", partNumber: "SC00007619A", qty: 4, price: 23.0, manual: true },
    { line: 90, oper: "Repl", desc: "RT Strut assy", partNumber: "PT00964204A", qty: 1, price: 1980.0 },
    { line: 98, oper: "Repl", desc: "RT Axle assy quad-motor", partNumber: "PT00462054D", qty: 1, price: 770.0, hours: 1.6, laborCat: "mechanical" },
    { line: 102, oper: "Repl", desc: "Susp subframe", partNumber: "PT00748804J", qty: 1, price: 2000.0, hours: 5.5, laborCat: "mechanical" },
    { line: 113, oper: "R&I", desc: "Crossmember assy", note: "PARTS: Part included with suspension subframe." },
    { line: 134, oper: "Repl", desc: "RT Water shield upper", partNumber: "PT00933930A", qty: 1, price: 63.47, hours: 0.2, laborCat: "body", note: "PARTS: Part cannot be reused/reinstalled." },
    { line: 152, oper: "Rpr", desc: "Pre-repair scan", hours: 0.5, laborCat: "mechanical" },
    { line: 153, oper: "Rpr", desc: "Post-repair scan", hours: 0.5, laborCat: "mechanical" },
    { line: 165, desc: "Concession in an attempt to secure an agreed price for rates", qty: 1, price: 3728.0, manual: true, supplement: "S03",
      note: "Shop's certified rates are: $90/hr body/refinish, $175/hr mech, $135/hr frame/structural" },
    { line: 169, desc: "Damper Module Assembly", qty: 1, price: 1980.0, manual: true, supplement: "S02" },
    { line: 171, desc: "Tow to sublet", qty: 1, price: 497.0, manual: true },
    { line: 172, oper: "Subl", desc: "Rivian Service +25%", qty: 1, price: 2293.38, manual: true },
  ],
};
