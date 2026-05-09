# Report Regression Checklist

Use this checklist with the same policy packet, shop estimate, carrier estimate, and support-document bundle used for launch QA. Record PASS or FAIL for each item and attach the generated PDFs or screenshots to the release note.

## 1. Policy & Rights Recognizes Uploaded Policy

PASS if:

- The uploaded policy packet is classified as `policy_document`.
- Policy & Rights Review shows uploaded policy evidence.
- Pennsylvania jurisdiction is document-supported when policy, declarations, or ID-card evidence exists.
- The report does not say "no uploaded policy" or "no verified policy language" when policy evidence exists.

FAIL if policy evidence is treated only as generic support, if jurisdiction remains unconfirmed despite uploaded Pennsylvania policy evidence, or if the report contradicts the uploaded policy packet.

## 2. Annotated Estimate Scrubber Selects Lower-Cost Estimate

PASS if:

- Multiple estimates are detected.
- The lower-cost carrier estimate is selected as the scrub target by default.
- The report title or introduction identifies the scrubbed estimate.
- Annotations are attached to carrier or lower-cost estimate lines or sections.

FAIL if the report scrubs the higher estimate by default, omits the scrub target, or produces only narrative findings without estimate-line anchors.

## 3. Estimate QA Findings Are Paragraph Form

PASS if:

- No pipe-separated format appears, such as `Operation: X | Status: Y | Severity: Z`.
- Each finding has a clear heading and professional paragraph explanation.
- Each finding explains current file support, the concern, and the requested revision or documentation.

FAIL if findings look like serialized fields, raw JSON, parser fragments, or generic AI fallback language.

## 4. Side-By-Side Estimate Comparison Is Gone

PASS if:

- No standalone Side-By-Side Estimate Comparison button, export, or report type appears.
- It is not included in bundle exports.
- Reusable comparison logic is used internally only.

FAIL if users can select or download a standalone Side-By-Side Estimate Comparison report.

## 5. Supplement Support Package Is Removed

PASS if:

- No standalone Supplement Support Package button, export, or report type appears.
- It is not included in bundle exports.
- Useful supplement logic is folded into Annotated Estimate Scrubber and Estimator Change Request.

FAIL if users can select or download a standalone Supplement Support Package report.

## 6. Direct Estimate Lines Are Not Labeled Only Inferred

PASS if operations directly found in uploaded estimates are marked `VERIFIED` or `REFERENCED`, not merely `INFERRED`.

Examples to verify:

- Test fit lines.
- Frame setup, measure, or pull lines.
- Pre-scan and post-scan lines.
- Alignment line.
- Cavity wax or corrosion-protection lines.
- ADAS, report, or calibration-related lines.

FAIL if direct estimate lines are downgraded to inferred-only support.

## Smoke Test Command

Run:

```powershell
node src\lib\ai\exportPdfBuilders.test.cjs
```

The smoke test should assert the lower-cost scrub target, removed Side-By-Side and Supplement Support selectable report types, paragraph QA language, policy-document recognition, and direct estimate evidence support posture.
