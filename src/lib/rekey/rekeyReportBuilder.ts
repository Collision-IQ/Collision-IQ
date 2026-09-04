/**
 * Plain-text rendering of the rekey sheet and its verification, plus the
 * report-history record.
 *
 * The sheet is written to be worked top-down at a keyboard: the profile block
 * first (because it explains every downstream number), then CCC groups in CCC
 * order with a per-group footer to spot-check against, then the totals the
 * keyed estimate must reach.
 *
 * Findings are written in plain labels. Internal resolution names never reach
 * the page (existing report hygiene rule).
 */

import type { RekeySheet } from "./rekeyTypes";
import type { RekeyVerification } from "./rekeyVerification";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

const RESOLUTION_LABEL: Record<string, string> = {
  exact: "matches",
  value_delta: "value differs",
  missing_in_keyed: "not keyed",
  unmatched: "could not be matched",
};

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `$${value.toFixed(2)}`;
}

function hours(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

export function buildRekeySheetText(sheet: RekeySheet): string {
  const lines: string[] = [];
  lines.push("REKEY SHEET");
  lines.push(`Source document: ${sheet.sourceFile}`);
  const identity = [
    sheet.identity.vehicle ? `Vehicle: ${sheet.identity.vehicle}` : null,
    sheet.identity.vin ? `VIN: ${sheet.identity.vin}` : null,
    sheet.identity.claimNumber ? `Claim: ${sheet.identity.claimNumber}` : null,
    sheet.identity.roNumber ? `RO: ${sheet.identity.roNumber}` : null,
  ].filter(Boolean);
  if (identity.length > 0) lines.push(identity.join(" · "));
  lines.push("");

  lines.push("SET THESE PROFILE VALUES BEFORE KEYING");
  for (const field of sheet.profile) {
    const basis =
      field.basis === "printed"
        ? "from the source"
        : field.basis === "derived"
          ? "derived"
          : field.basis === "instruction"
            ? "keying instruction"
            : "not available";
    lines.push(`  ${field.field}: ${field.display}  (${basis})${field.note ? ` — ${field.note}` : ""}`);
  }
  lines.push("");

  for (const group of sheet.groups) {
    lines.push(`${group.group}${group.mapped ? "" : "  (no CCC group matched — choose one when keying)"}`);
    for (const row of group.rows) {
      const supplement = row.supplementTag ? `${row.supplementTag} ` : "";
      const labor = row.labor
        .map((entry) => `${entry.type} ${entry.included ? "Incl." : entry.hours.toFixed(1)}`)
        .join(" · ");
      const parts = [
        `${supplement}${row.sourceLine ?? "—"}`,
        row.operationCcc,
        row.descriptionCcc,
        row.partNumber ? `#${row.partNumber}` : null,
        row.partTypeCcc !== "None" ? row.partTypeCcc : null,
        row.vendor ? `vendor ${row.vendor}` : null,
        row.qty !== null ? `qty ${row.qty}` : null,
        row.price !== null ? money(row.price) : null,
        labor || null,
        row.misc ? `misc ${money(row.misc.amount)}${row.misc.sublet ? " (sublet)" : ""}` : null,
        row.flags.length > 0 ? `[${row.flags.join(", ")}]` : null,
      ].filter(Boolean);
      lines.push(`  ${row.keyable ? "" : "(do not key) "}${parts.join("  |  ")}`);
      for (const note of row.notes) lines.push(`      note: ${note}`);
    }
    lines.push(
      `  — ${group.totals.lines} line${group.totals.lines === 1 ? "" : "s"}; body ${hours(group.totals.body)} h · paint ${hours(
        group.totals.paint
      )} h · mech ${hours(group.totals.mech)} h${
        group.totals.other > 0 ? ` · other labor ${hours(group.totals.other)} h` : ""
      } · parts ${money(group.totals.parts)} · misc ${money(group.totals.misc)}`
    );
    lines.push("");
  }

  if (sheet.expectedTotals) {
    lines.push("THE KEYED ESTIMATE SHOULD READ");
    for (const category of sheet.expectedTotals.categories) {
      lines.push(
        `  ${category.category}: ${category.hours === null ? "" : `${hours(category.hours)} h @ ${money(category.rate)} = `}${money(
          category.cost
        )}`
      );
    }
    lines.push(`  Tax: ${money(sheet.expectedTotals.tax)}`);
    lines.push(`  Gross total: ${money(sheet.expectedTotals.grandTotal)}`);
    lines.push("");
  }

  if (sheet.reconciliation && sheet.reconciliation.rows.length > 0) {
    lines.push(
      sheet.reconciliation.closes
        ? "THE ROWS ABOVE ADD UP TO THE PRINTED TOTALS"
        : "THE ROWS ABOVE DO NOT ADD UP TO THE PRINTED TOTALS — DO NOT KEY FROM THIS SHEET"
    );
    for (const row of sheet.reconciliation.rows) {
      const format = (value: number | null) =>
        value === null ? "not printed" : row.unit === "hours" ? `${value.toFixed(1)} h` : money(value);
      lines.push(
        `  ${row.closes ? "ok " : "-> "}${row.category}: rows ${format(row.derived)} · printed ${format(row.printed)}${
          row.delta === null || row.closes ? "" : ` · difference ${row.delta > 0 ? "+" : ""}${row.delta.toFixed(row.unit === "hours" ? 1 : 2)}`
        }`
      );
    }
    for (const failure of sheet.reconciliation.failures) lines.push(`  -> ${failure}`);
    lines.push("");
  }

  if (sheet.partsVendorsBlock.length > 0) {
    lines.push("PARTS VENDORS AS PRINTED ON THE SOURCE");
    for (const line of sheet.partsVendorsBlock) lines.push(`  ${line}`);
    lines.push("");
  }

  if (sheet.warnings.length > 0) {
    lines.push("BEFORE YOU RELY ON THIS SHEET");
    for (const warning of sheet.warnings) lines.push(`  - ${warning}`);
    lines.push("");
  }

  lines.push(
    `Read ${sheet.stats.sourceRows} source line${sheet.stats.sourceRows === 1 ? "" : "s"} into ${
      sheet.stats.keyableRows
    } keying row${sheet.stats.keyableRows === 1 ? "" : "s"}, ${sheet.stats.foldedRefinishRows} refinish line${
      sheet.stats.foldedRefinishRows === 1 ? "" : "s"
    } folded into their part line, ${sheet.stats.nonKeyableRows} row${
      sheet.stats.nonKeyableRows === 1 ? "" : "s"
    } marked do-not-key.`
  );
  return lines.join("\n");
}

export function buildRekeyVerificationText(verification: RekeyVerification): string {
  const lines: string[] = [];
  lines.push("REKEY VERIFICATION");
  lines.push(`Vehicle identity: ${verification.identity.detail}`);

  if (verification.blocked) {
    lines.push("");
    lines.push(verification.blockedReason ?? "No verification was produced.");
    return lines.join("\n");
  }

  lines.push(
    verification.summary.pass
      ? "Result: PASS — every line and every total matched."
      : "Result: DIFFERENCES FOUND — see below."
  );
  lines.push("");

  lines.push("PROFILE");
  if (verification.profileFindings.length === 0) {
    lines.push("  No profile difference was found.");
  } else {
    lines.push("  A profile difference explains every downstream number, so fix these first:");
    for (const finding of verification.profileFindings) {
      lines.push(`  - ${finding.field}: should be ${finding.expected}, is ${finding.found}`);
    }
  }
  lines.push("");

  lines.push("TOTALS");
  for (const row of verification.totals) {
    const unit = row.unit === "hours" ? "h" : "";
    const format = (value: number | null) =>
      value === null ? "—" : row.unit === "hours" ? `${value.toFixed(1)} h` : money(value);
    lines.push(
      `  ${row.matches ? "ok " : "-> "}${row.label}: source ${format(row.source)} · keyed ${format(row.keyed)}${
        row.delta === null ? "" : ` · difference ${row.delta > 0 ? "+" : ""}${row.delta.toFixed(row.unit === "hours" ? 1 : 2)}${unit}`
      }`
    );
  }
  lines.push("");

  const unresolved = verification.lineFindings.filter((finding) => finding.resolution !== "exact");
  lines.push("LINES");
  lines.push(
    `  ${verification.summary.exact} of ${verification.summary.keyableRows} rows matched exactly.`
  );
  for (const finding of unresolved) {
    lines.push(
      `  - ${finding.description}${finding.partNumber ? ` (#${finding.partNumber})` : ""} — ${
        RESOLUTION_LABEL[finding.resolution] ?? finding.resolution
      }`
    );
    for (const delta of finding.deltas) {
      lines.push(`      ${delta.field}: source ${delta.expected}, keyed ${delta.found}`);
    }
  }
  if (verification.extraLines.length > 0) {
    lines.push("");
    lines.push("KEYED LINES WITH NO SOURCE LINE");
    for (const extra of verification.extraLines) {
      lines.push(`  - ${extra.description}${extra.partNumber ? ` (#${extra.partNumber})` : ""} ${money(extra.price)}`);
    }
  }
  if (verification.subletNormalization.length > 0) {
    lines.push("");
    lines.push("SUBLET");
    for (const sublet of verification.subletNormalization) {
      lines.push(`  - ${sublet.description}: ${money(sublet.amount)} (${sublet.laborType} on the source side)`);
    }
  }
  if (verification.notes.length > 0) {
    lines.push("");
    lines.push("NOTES");
    for (const note of verification.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

/** Report-history record, so a rekey sheet is recoverable like any other report. */
export function buildRekeyHistoryReport(params: {
  sheet: RekeySheet;
  verification: RekeyVerification | null;
}): RepairIntelligenceReport {
  const { sheet, verification } = params;
  const unresolved = verification
    ? verification.summary.valueDelta + verification.summary.missing + verification.summary.extra
    : 0;
  // No verification yet is not a low-risk finding — it is no finding. The
  // sheet alone carries no risk claim, so it sits at the neutral middle.
  const riskScore: "low" | "moderate" | "high" = !verification
    ? "moderate"
    : verification.summary.pass
      ? "low"
      : unresolved > 5
        ? "high"
        : "moderate";

  const text = [
    buildRekeySheetText(sheet),
    verification ? "" : null,
    verification ? buildRekeyVerificationText(verification) : null,
  ]
    .filter((part) => part !== null)
    .join("\n");

  return {
    summary: {
      riskScore,
      confidence: sheet.rows.length === 0 ? "low" : "moderate",
      criticalIssues: unresolved,
      evidenceQuality: sheet.expectedTotals ? "moderate" : "weak",
    },
    vehicle: {
      vin: sheet.identity.vin ?? undefined,
    } as RepairIntelligenceReport["vehicle"],
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: [],
    evidence: [],
    recommendedActions: verification
      ? verification.summary.pass
        ? ["Keep the verification with the file as proof the rekeyed estimate matches the source."]
        : [
            "Correct the profile differences first — they change every downstream number.",
            "Work the line differences in the order listed, then re-export and re-verify.",
          ]
      : ["Set the profile values first, then key the sheet group by group.", "Re-run with the keyed estimate to verify."],
    sourceEstimateText: text,
    ingestionMeta: {
      active: true,
      reportKind: "rekey_sheet",
    } as RepairIntelligenceReport["ingestionMeta"],
  };
}
