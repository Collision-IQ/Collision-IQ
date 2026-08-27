"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMON_INSURERS = void 0;
exports.extractEstimateFacts = extractEstimateFacts;
exports.extractMileageReadings = extractMileageReadings;
exports.carriersNamedIn = carriersNamedIn;
exports.findForeignOrganizationMentions = findForeignOrganizationMentions;
exports.detectDominantKnownCarrier = detectDominantKnownCarrier;
exports.extractInsurerMentions = extractInsurerMentions;
exports.normalizeInsurer = normalizeInsurer;
exports.resolveCanonicalInsurerCandidate = resolveCanonicalInsurerCandidate;
const estimateExtractor_1 = require("./estimateExtractor");
const vehicleContext_1 = require("../vehicleContext");
exports.COMMON_INSURERS = [
    "GEICO",
    "Progressive",
    "State Farm",
    "Allstate",
    "Liberty Mutual",
    "USAA",
    "Nationwide",
    "Travelers",
    "Farmers",
    "Erie",
    "AAA",
    "Root Insurance",
    "Root",
    "American Family",
    "The Hartford",
    "Economy Preferred",
    "Economy Premier",
    "Foremost",
    "Safeco",
    "Chubb",
    "Amica",
    "MetLife",
    "Auto-Owners",
    "National General",
];
// Carriers whose names are also ordinary words or vendor brands; only accept
// them when the insurer sense is present (company suffix or an
// insurance-context label). "AAA" must never be picked up from a tire/service
// vendor line like "AAA Car Care Center".
// NOTE: no leading \b on the phrase alternatives — CCC headers glue fields
// together ("…collision.comFOREMOST INSURANCE COMPANY"), and \b never fires
// between two letters.
const AMBIGUOUS_INSURER_CONTEXT = {
    Root: /\broot\s+insurance\b|\binsurance\s*(?:company|co\.?|:)?\s*root\b|\b(?:carrier|insurer|insurance company)\b[^\n]{0,20}\broot\b/i,
    AAA: /aaa\s+(?:insurance|casualty|club|mutual)\b|(?:carrier|insurer|insurance company)[^\n]{0,30}\baaa\b/i,
    Foremost: /foremost\s+(?:insurance|signature|county mutual)\b|(?:carrier|insurer|insurance company)[^\n]{0,30}foremost\b/i,
};
// Repair/parts vendors that must never land in the insurer slot even when a
// labeled field or fuzzy match surfaces them.
const INSURER_VENDOR_EXCLUSION = /\b(?:car care|tire|tires|glass|towing|rental|salvage|recycl|goodyear|mavis|discount)\b/i;
const LIKELY_PERSON_NAME_PATTERN = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/;
// Owner / insured names on CCC estimate headers are frequently rendered "LAST, FIRST"
// and often ALL-CAPS (e.g. "OLIVARES, ESMON"). The Titlecase person pattern above does
// not catch these, so an owner name could otherwise be scored into the insurer slot.
const OWNER_LASTNAME_FIRSTNAME_PATTERN = /^[A-Za-z][A-Za-z'.-]+\s*,\s*[A-Za-z][A-Za-z'.\s-]+$/;
const DOCUMENTED_HIGHLIGHT_RULES = [
    {
        label: "Procedure research/documentation",
        patterns: [/procedures? research/i, /oem procedures?/i, /repair research/i],
    },
    {
        label: "Work authorization",
        patterns: [/work authorization/i, /repair authorization/i],
    },
    {
        label: "Test fits",
        patterns: [/test fit/i, /fit check/i, /mock-?up/i],
    },
    {
        label: "Refrigerant service",
        patterns: [/refrigerant/i, /recover and recharge/i, /evac(?:uate)? and recharge/i],
    },
    {
        label: "Headlamp/fog aim",
        patterns: [/headlamp aim/i, /headlight aim/i, /fog aim/i, /lamp aim/i],
    },
    {
        label: "Cavity wax",
        patterns: [/cavity wax/i],
    },
    {
        label: "Final road test",
        patterns: [/final road test/i, /road test/i],
    },
    {
        label: "HV battery state-of-charge maintenance",
        patterns: [/state of charge/i, /high voltage battery/i, /\bhv battery\b/i],
    },
];
function extractEstimateFacts(params) {
    const text = params.text.replace(/\r/g, "\n");
    const parsed = (0, estimateExtractor_1.parseEstimate)(text);
    const inferredVehicle = (0, vehicleContext_1.extractVehicleIdentityFromText)(text, "attachment");
    const vehicle = (0, vehicleContext_1.mergeVehicleIdentity)((0, vehicleContext_1.normalizeVehicleIdentity)(params.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(inferredVehicle));
    const documentedProcedures = collectDocumentedProcedures(text, parsed);
    const documentedHighlights = collectDocumentedHighlights(text);
    return {
        vehicle,
        mileage: extractMileage(text),
        insurer: extractInsurer(text),
        estimateTotal: extractEstimateTotal(text, parsed.totalCost),
        documentedProcedures,
        documentedHighlights,
    };
}
function collectDocumentedProcedures(text, parsed) {
    const procedures = [];
    if ((0, estimateExtractor_1.hasLine)(parsed, /pre-?repair scan|pre scan|pre-scan|diagnostic scan/i)) {
        procedures.push("Pre-repair scan");
    }
    if ((0, estimateExtractor_1.hasLine)(parsed, /in-?process repair scan|in process repair scan|in-?proc(?:ess)? scan|in-?process scan/i)) {
        procedures.push("In-process scan");
    }
    if ((0, estimateExtractor_1.hasLine)(parsed, /post-?repair scan|post scan|post-scan|final scan/i)) {
        procedures.push("Post-repair scan");
    }
    if (/headlamp aim|headlight aim|fog aim|lamp aim/i.test(text)) {
        procedures.push("Headlamp aiming check");
    }
    if (/cavity wax/i.test(text)) {
        procedures.push("Cavity wax");
    }
    if (/road test/i.test(text)) {
        procedures.push("Final road test");
    }
    if (/refrigerant/i.test(text)) {
        procedures.push("Refrigerant service");
    }
    if (/work authorization|repair authorization/i.test(text)) {
        procedures.push("Work authorization");
    }
    if (/procedures? research|oem procedures?|repair research/i.test(text)) {
        procedures.push("Procedure research/documentation");
    }
    if (/test fit|fit check|mock-?up/i.test(text)) {
        procedures.push("Test fits");
    }
    if (/state of charge|high voltage battery|\bhv battery\b/i.test(text)) {
        procedures.push("HV battery state-of-charge maintenance");
    }
    return [...new Set(procedures)];
}
function collectDocumentedHighlights(text) {
    return DOCUMENTED_HIGHLIGHT_RULES
        .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
        .map((rule) => rule.label);
}
function extractMileage(text) {
    const candidates = [
        // CCC/Audatex headers label this "Mileage In:" / "Mileage Out:" (the
        // "In"/"Out" qualifier sits between the word and the value). The label is
        // often concatenated to the previous field with no delimiter
        // (e.g. "...BLACKMileage In:106,732"), so no leading word boundary is used.
        text.match(/mileage(?:\s*(?:in|out))?\b\s*[:#-]?\s*([\d,]{2,})/i)?.[1],
        text.match(/odometer(?:\s*(?:reading|in|out))?\b\s*[:#-]?\s*([\d,]{2,})/i)?.[1],
        text.match(/\b([\d,]{2,})\s*(?:mi|miles)\b/i)?.[1],
    ]
        .filter(Boolean)
        .map((value) => Number(String(value).replace(/,/g, "")))
        .filter((value) => Number.isFinite(value) && value > 0 && value < 1000000);
    return candidates[0];
}
/**
 * All distinct mileage/odometer readings found across the (combined) estimate
 * text, ascending. Two estimates commonly disagree slightly on odometer (a
 * "Mileage In" vs an "Odometer" reading), which is a minor discrepancy worth
 * surfacing rather than hiding behind a single value.
 */
function extractMileageReadings(text) {
    const readings = new Set();
    const patterns = [
        /mileage(?:\s*(?:in|out))?\b\s*[:#-]?\s*([\d,]{2,})/gi,
        /odometer(?:\s*(?:reading|in|out))?\b\s*[:#-]?\s*([\d,]{2,})/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const value = Number(String(match[1]).replace(/,/g, ""));
            if (Number.isFinite(value) && value > 0 && value < 1000000) {
                readings.add(value);
            }
        }
    }
    return [...readings].sort((a, b) => a - b);
}
/**
 * True when the carrier name appears in the text. Ambiguous names go through
 * their context guard; multi-word names match WITHOUT a leading \b because
 * CCC headers glue fields together ("…collision.comFOREMOST INSURANCE").
 */
function carrierAppearsInText(carrier, text) {
    const contextGuard = AMBIGUOUS_INSURER_CONTEXT[carrier];
    if (contextGuard)
        return contextGuard.test(text);
    const words = carrier.split(/\s+/).map(escapeRegExp);
    if (words.length > 1) {
        return new RegExp(`${words.join("\\s+")}\\b`, "i").test(text);
    }
    if (new RegExp(`\\b${words[0]}\\b`, "i").test(text))
        return true;
    // Glued text layers ("withProgressive", "…comUSAA") put word characters on
    // both sides, so \b never fires. Fall back to a case-transition boundary:
    // the carrier's exact casing, not preceded by an uppercase letter and not
    // followed by a lowercase letter ("progressively" stays excluded).
    return new RegExp(`(?<![A-Z])${escapeRegExp(carrier)}(?![a-z])`).test(text);
}
/** Every known carrier named anywhere in the given text (context-guarded for
 * ambiguous names). Used to flag notes that name a carrier other than the
 * file's resolved insurer. */
function carriersNamedIn(text) {
    if (!text)
        return [];
    return exports.COMMON_INSURERS.filter((carrier) => carrierAppearsInText(carrier, text));
}
/** Legitimate contexts where naming ANOTHER carrier is correct, not a defect
 * (U-6): subrogation, prior-loss references, third-party-claim language.
 * Better to under-fire than to accuse an adjuster of copy-paste falsely. */
const CARRIER_MISMATCH_SUPPRESSION = /\b(?:subrogat\w*|prior\s+(?:loss|claim|damage)|previous\s+(?:loss|claim)|third[-\s]?party|other\s+(?:\w+\s+)?claim|uninsured\s+motorist|underinsured|liability\s+carrier|claimant'?s?\s+carrier)\b/i;
/** Organization shapes that are NOT carriers: shops, dealers, suppliers,
 * sublet vendors, salvage/recyclers, DRP networks. */
const NON_CARRIER_ENTITY_SHAPE = /\b(?:auto\s*body|collision|body\s*shop|repair|motors?|dealer(?:ship)?|parts|supply|supplier|salvage|towing|glass|recycl\w+|vendor|sublet|network|academy)\b/i;
/** Corporate-suffix shape of an insurance organization name. */
const CARRIER_ORG_NAME_SHAPE = /\b([A-Z][A-Za-z&'.]+(?:\s+[A-Z][A-Za-z&'.]+){0,3}\s+(?:Insurance(?:\s+(?:Company|Co\.?|Group))?|Ins\.?(?:\s+Co\.?)?|Mutual|Casualty|Assurance|Underwriters|Indemnity))\b/g;
/**
 * U-6 general identity check: every organization-like name in a note that is
 * NOT the file's resolved carrier and NOT a known non-carrier entity shape.
 * Two detection lanes: the known-carrier lexicon (exact) and the corporate
 * insurance-suffix shape (open-world — a carrier never seen before still
 * flags). Suppressed entirely in legitimate other-carrier contexts.
 */
function findForeignOrganizationMentions(noteText, resolvedCarrier) {
    if (!noteText)
        return [];
    if (CARRIER_MISMATCH_SUPPRESSION.test(noteText))
        return [];
    const resolved = (resolvedCarrier ?? "").toLowerCase();
    const out = [];
    const push = (name) => {
        const trimmed = name.trim();
        if (!trimmed)
            return;
        const lower = trimmed.toLowerCase();
        if (resolved && (lower === resolved || lower.includes(resolved) || resolved.includes(lower)))
            return;
        if (NON_CARRIER_ENTITY_SHAPE.test(trimmed))
            return;
        if (!out.some((existing) => existing.toLowerCase() === lower))
            out.push(trimmed);
    };
    for (const known of carriersNamedIn(noteText))
        push(known);
    for (const match of noteText.matchAll(CARRIER_ORG_NAME_SHAPE))
        push(match[1]);
    return out;
}
/** The known carrier that DOMINATES the non-note text: most occurrences,
 * earliest occurrence breaking ties. Never list-order dependent. */
function detectDominantKnownCarrier(text) {
    const scanText = stripInsurerNoiseLines(text ?? "");
    let best;
    let bestCount = 0;
    let bestFirstIndex = Number.POSITIVE_INFINITY;
    for (const carrier of exports.COMMON_INSURERS) {
        if (!carrierAppearsInText(carrier, scanText))
            continue;
        const pattern = new RegExp(`\\b${carrier.split(/\s+/).map(escapeRegExp).join("\\s+")}\\b`, "gi");
        const matches = [...scanText.matchAll(pattern)];
        const count = matches.length;
        const firstIndex = matches[0]?.index ?? Number.POSITIVE_INFINITY;
        if (count > bestCount || (count === bestCount && firstIndex < bestFirstIndex)) {
            best = carrier;
            bestCount = count;
            bestFirstIndex = firstIndex;
        }
    }
    return best;
}
/** Lines that must NEVER feed the insurer scan: line notes and quoted note
 * prose ("already agreed upon with <carrier>") name carriers that are not
 * this file's insurer. */
function stripInsurerNoiseLines(text) {
    return text
        .split(/\r?\n/)
        .filter((line) => {
        const trimmed = line.trim();
        if (/^\s*note\b\s*[:.-]/i.test(trimmed) || /^NOTE\b/.test(trimmed))
            return false;
        // quoted/evidence prose that embeds note text without the NOTE prefix
        if (/\bagreed upon with\b/i.test(trimmed))
            return false;
        return true;
    })
        .join("\n");
}
function extractInsurer(text) {
    const scanText = stripInsurerNoiseLines(text);
    const lines = scanText.split(/\r?\n/);
    // Source hierarchy (a document's own header identity always beats a carrier
    // name found in free text):
    // 1. LETTERHEAD — a known carrier named in the document's opening lines.
    const letterheadZone = lines.slice(0, 15).join("\n");
    const letterhead = exports.COMMON_INSURERS.find((carrier) => carrierAppearsInText(carrier, letterheadZone));
    // 2. LABELED, same line — "Insurance Company: X".
    const labeledRaw = scanText.match(/\b(?:insurer|insurance company|insurance co(?:mpany)?)\b[ \t]*[:#-][ \t]*([A-Za-z][A-Za-z .&'-]{1,40})/i)?.[1]?.trim();
    const labeled = labeledRaw && INSURER_VENDOR_EXCLUSION.test(labeledRaw) ? undefined : labeledRaw;
    // 3. LABELED, next line — CCC's three-column headers put "Insurance
    //    Company:" on one line and the value on the next. Only a KNOWN carrier
    //    may be read from the following line (arbitrary next-line text is the
    //    owner column as often as the carrier column).
    let labeledNextLine;
    for (let index = 0; index < lines.length - 1 && !labeledNextLine; index += 1) {
        if (/\b(?:insurance company|insurer)\b[ \t]*:?[ \t]*$/i.test(lines[index].trim())) {
            // CCC's three-column headers can interleave one or two other columns'
            // values before the carrier value — scan the next few lines.
            const windowText = lines.slice(index + 1, index + 4).join("\n");
            const candidate = exports.COMMON_INSURERS.find((carrier) => carrierAppearsInText(carrier, windowText));
            if (candidate)
                labeledNextLine = candidate;
        }
    }
    // 4. DOMINANT carrier — the known carrier that appears MOST OFTEN in the
    //    non-note text (earliest occurrence breaks ties). Never "first entry of
    //    the hard-coded list that happens to appear once, somewhere".
    const knownFromText = detectDominantKnownCarrier(text);
    // Capture the owner/insured/claimant name (if labeled) so it can never be selected as
    // the insurer, even when it appears as a prior/extracted candidate.
    const ownerName = text
        .match(/\b(?:owner\/insured|owner|insured|claimant|policyholder|customer)\b\s*[:#-]\s*([A-Za-z][A-Za-z ,.&'-]{1,40})/i)?.[1]
        ?.trim();
    return resolveCanonicalInsurerCandidate({ excludeNames: ownerName ? [ownerName] : [] }, { value: letterhead, source: "letterhead" }, { value: labeled, source: "labeled" }, { value: labeledNextLine, source: "labeled" }, { value: knownFromText, source: "known_carrier" });
}
/**
 * Return the distinct known insurer identities that appear in the combined text.
 * Used to surface an insurer metadata conflict (e.g. carrier Estimate of Record
 * from one insurer, shop estimate insurance field naming another) instead of
 * silently collapsing to a single insurer. Pair-agnostic: it names whatever
 * distinct carriers are present, not a hard-coded pair.
 */
function extractInsurerMentions(text) {
    if (!text)
        return [];
    const found = new Set();
    for (const carrier of exports.COMMON_INSURERS) {
        if (carrierAppearsInText(carrier, text)) {
            found.add(normalizeInsurer(carrier));
        }
    }
    // Collapse "Root" into "Root Insurance" when both matched.
    if (found.has("Root Insurance"))
        found.delete("Root");
    return [...found];
}
function normalizeInsurer(value) {
    const compact = value.replace(/\s+/g, " ").trim();
    const known = exports.COMMON_INSURERS.find((carrier) => carrier.toLowerCase() === compact.toLowerCase());
    return known ?? compact;
}
function resolveCanonicalInsurerCandidate(...args) {
    const excluded = new Set();
    const candidates = [];
    for (const arg of args) {
        if (arg && typeof arg === "object" && "excludeNames" in arg) {
            for (const name of arg.excludeNames) {
                const normalized = normalizeInsurer(name);
                if (normalized)
                    excluded.add(normalized.toLowerCase());
            }
            continue;
        }
        candidates.push(arg);
    }
    const scored = candidates
        .map((candidate) => {
        if (typeof candidate === "string" || candidate == null) {
            return buildInsurerCandidateScore(candidate, "prior");
        }
        return buildInsurerCandidateScore(candidate.value, candidate.source ?? "prior");
    })
        .filter((candidate) => Boolean(candidate))
        .filter((candidate) => !excluded.has(candidate.normalized.toLowerCase()));
    if (scored.length === 0) {
        return undefined;
    }
    scored.sort((left, right) => right.score - left.score);
    return scored[0]?.normalized;
}
function buildInsurerCandidateScore(value, source) {
    if (!value)
        return null;
    const normalized = normalizeInsurer(value);
    if (!normalized)
        return null;
    // Owner / insured names (e.g. "OLIVARES, ESMON") can never be the insurer. Known
    // carriers always pass; anything in "LAST, FIRST" owner format is dropped outright.
    if (!isKnownCarrier(normalized) && OWNER_LASTNAME_FIRSTNAME_PATTERN.test(normalized)) {
        return null;
    }
    // The labeled header field ("Insurance Company: X") outranks a carrier name
    // found anywhere in the text — free text can quote OTHER carriers (prior
    // claims, agreed-upon notes) and must never beat the document's own header.
    let score = source === "letterhead" ? 640 : source === "known_carrier" ? 300 : source === "labeled" ? 520 : 100;
    if (isKnownCarrier(normalized))
        score += 400;
    if (looksLikeLikelyPersonName(normalized))
        score -= 250;
    if (normalized.length <= 2)
        score -= 200;
    return { normalized, score };
}
function isKnownCarrier(value) {
    return exports.COMMON_INSURERS.some((carrier) => carrier.toLowerCase() === value.toLowerCase());
}
function looksLikeLikelyPersonName(value) {
    if (!value)
        return false;
    if (isKnownCarrier(value))
        return false;
    if (/[&/]/.test(value))
        return false;
    return LIKELY_PERSON_NAME_PATTERN.test(value.trim());
}
function extractEstimateTotal(text, parsedTotal) {
    if (typeof parsedTotal === "number" && parsedTotal >= 100) {
        return parsedTotal;
    }
    const candidates = collectEstimateTotalCandidates(text);
    if (typeof parsedTotal === "number" && parsedTotal > 0) {
        candidates.push({ value: parsedTotal, score: parsedTotal >= 100 ? 900 : 10 });
    }
    candidates.sort((left, right) => right.score - left.score || right.value - left.value);
    const substantial = candidates.find((candidate) => candidate.value >= 100);
    return substantial?.value ?? candidates[0]?.value;
}
function collectEstimateTotalCandidates(text) {
    const candidates = [];
    // Labels end with (?![a-z]) rather than \b: CCC welds the amount straight
    // onto the label ("Grand Total14,938.25", "Total Cost of Repairs8,285.25"),
    // and a digit after a letter is NOT a \b word boundary, so \b-terminated
    // labels silently miss the glued form (RO 21897 lost its total to this).
    const patterns = [
        { pattern: /\btotal cost of repairs?(?![a-z])[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/gi, score: 1000 },
        { pattern: /\bgrand total(?![a-z])[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/gi, score: 940 },
        { pattern: /\bestimate total(?![a-z])[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/gi, score: 920 },
        { pattern: /\b(?:carrier|shop)\s+total(?:\s+(?:cost|repairs?))?(?![a-z])[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/gi, score: 900 },
        { pattern: /\btotal(?:\s+(?:repairs?|amount|cost))?(?![a-z])[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/gi, score: 700 },
        // Net cost of repairs is AFTER deductible — never the comparison/display
        // basis. Kept only as a last resort when no gross repair total is present.
        { pattern: /\bnet cost of repairs?(?![a-z])[^\d$]{0,30}\$?\s*([\d,]+\.\d{2})/gi, score: 300 },
    ];
    for (const { pattern, score } of patterns) {
        for (const match of text.matchAll(pattern)) {
            const value = Number(String(match[1]).replace(/,/g, ""));
            if (!Number.isFinite(value) || value <= 0)
                continue;
            candidates.push({
                value,
                score: value < 100 ? score - 800 : score,
            });
        }
    }
    return candidates;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
