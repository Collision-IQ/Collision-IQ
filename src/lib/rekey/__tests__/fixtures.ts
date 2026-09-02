/**
 * Synthetic estimate fixtures for the rekey modules.
 *
 * Deliberately synthetic: VIN, claim, part numbers and prices are invented for
 * the test and match no real repair order. They exercise the SHAPES the
 * modules must handle (word-spelled operations, refinish-only lines, an
 * aggregate clear-coat allowance, a sublet line with labor, a materials line
 * that belongs in the profile, a diagnostics line in a catch-all section).
 */

/** Source estimate: operations spelled as words, supplement-tagged lines. */
export const SOURCE_ESTIMATE_TEXT = `Estimate ID: 25-000000000-01
Claim #: TESTCLAIM0001
VIN: 1FTFW1E84PKE00000

HOOD
S2 21 Remove / Replace Hood Panel Alum New FO1230344C 1 776.00 1.6 2.8
S2 22 Refinish Only Hood Outside 2.8
S2 23 Refinish Only Hood Underside 1.4
900501 Reconcile with invoice
FRONT BUMPER
S2 30 Remove / Install Bumper Cover 0.8
S2 31 Repair Bumper Reinforcement Existing 1.2
S2 32 Remove / Replace Grille Aftermarket Certified FO1200600C 1 210.50 0.4
ADDITIONAL COSTS
S2 75 Paint Materials 701.40
S2 76 Hazardous Waste 4.00
S2 77 Add for Clear Coat 3.1
S2 79 Remove / Replace Front Sensor Qual Recycled Part FO1500900 1 320.00 0.6
ADDITIONAL OPERATIONS
S2 80 Pre-Repair Diagnostic Scan 1 125.00

ESTIMATE TOTALS
Body Labor 4.6 hrs @ $ 61.00 /hr 280.60
Refinish Labor 10.1 hrs @ $ 61.00 /hr 616.10
Parts 1,306.50
Paint Supplies 701.40
Miscellaneous 129.00
Subtotal 3,033.60
Sales Tax 182.02
Grand Total 3,215.62
`;

/** The same scope keyed into the other platform, using CCC op codes. */
export const KEYED_ESTIMATE_TEXT = `Workfile ID: cbf00000
Claim #: TESTCLAIM0001
VIN: 1FTFW1E84PKE00000

HOOD
1 Repl Hood Panel Alum FO1230344C 1 776.00 1.6 7.0
FRONT BUMPER
2 R&I Bumper Cover 0.8
3 Rpr Bumper Reinforcement 1.2
4 Repl Grille A/M CAPA FO1200600C 1 210.50 0.4
MISCELLANEOUS OPERATIONS
5 Add Hazardous Waste 4.00
6 Add for Clear Coat 3.1
7 Repl Front Sensor LKQ FO1500900 1 320.00 0.6
VEHICLE DIAGNOSTICS
8 Add Pre-Repair Diagnostic Scan 1 125.00

ESTIMATE TOTALS
Body Labor 4.6 hrs @ $ 61.00 /hr 280.60
Refinish Labor 10.1 hrs @ $ 61.00 /hr 616.10
Parts 1,306.50
Paint Supplies 701.40
Miscellaneous 129.00
Subtotal 3,033.60
Sales Tax 182.02
Grand Total 3,215.62
`;
