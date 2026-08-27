"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveVehicleApplicabilityContext = resolveVehicleApplicabilityContext;
exports.assessVehicleApplicability = assessVehicleApplicability;
exports.isVehicleContentApplicable = isVehicleContentApplicable;
exports.assessRetrievedDocumentApplicability = assessRetrievedDocumentApplicability;
exports.sanitizeVehicleSpecificText = sanitizeVehicleSpecificText;
const vehicleContext_1 = require("./vehicleContext");
const VEHICLE_TERM_GROUPS = [
    {
        family: "tesla",
        canonicalMake: "Tesla",
        manufacturerTerms: ["tesla", "tesla motors"],
        modelTerms: ["model 3", "model s", "model x", "model y", "cybertruck"],
    },
    {
        family: "stellantis",
        canonicalMake: "Chrysler",
        manufacturerTerms: [
            "chrysler",
            "dodge",
            "jeep",
            "ram",
            "fca",
            "fiat chrysler",
            "stellantis",
            "mopar",
        ],
        modelTerms: [
            "grand wagoneer",
            "wagoneer",
            "pacifica",
            "300",
            "charger",
            "challenger",
            "durango",
            "wrangler",
            "grand cherokee",
            "ram 1500",
            "ram 2500",
        ],
    },
    {
        family: "honda",
        canonicalMake: "Honda",
        manufacturerTerms: ["honda", "acura", "american honda", "honda acura"],
        modelTerms: ["accord", "civic", "cr v", "cr-v", "pilot", "odyssey", "tlx", "rdx", "mdx"],
    },
    {
        family: "hyundai",
        canonicalMake: "Hyundai",
        manufacturerTerms: ["hyundai", "hyundai motor", "genesis", "kia"],
        modelTerms: ["elantra", "sonata", "tucson", "santa fe", "palisade", "ioniq", "telluride", "sportage"],
    },
    {
        family: "bmw_group",
        canonicalMake: "BMW",
        manufacturerTerms: [
            "bmw",
            "bayerische motoren werke",
            "mini",
            "kafas",
            "xdrive",
            "sdrive",
        ],
        modelTerms: ["x1", "x3", "x5", "x7", "330i", "430i", "530i", "740i"],
    },
    {
        family: "volvo_cars",
        canonicalMake: "Volvo",
        manufacturerTerms: ["volvo", "volvo car corporation", "volvo cars"],
        modelTerms: ["xc40", "xc60", "xc90", "s60", "s90", "v60", "v90"],
    },
    {
        family: "subaru",
        canonicalMake: "Subaru",
        manufacturerTerms: ["subaru", "subaru corporation", "subaru of america", "eyesight"],
        modelTerms: ["forester", "outback", "crosstrek", "ascent", "legacy", "wrx", "impreza"],
    },
    {
        family: "nissan",
        canonicalMake: "Nissan",
        manufacturerTerms: ["nissan", "nissan north america", "nissan motor"],
        modelTerms: ["sentra", "altima", "maxima", "rogue", "murano", "pathfinder", "versa", "frontier"],
    },
    {
        family: "rivian",
        canonicalMake: "Rivian",
        manufacturerTerms: ["rivian", "rivian automotive", "rivi"],
        modelTerms: ["r1t", "r1s", "edv", "rct"],
    },
    {
        family: "lucid",
        canonicalMake: "Lucid",
        manufacturerTerms: ["lucid", "lucid motors", "lucid group"],
        modelTerms: ["air", "gravity"],
    },
    {
        family: "general_motors",
        canonicalMake: "Chevrolet",
        manufacturerTerms: ["chevrolet", "chevy", "general motors", "gm"],
        modelTerms: ["silverado", "equinox", "malibu", "tahoe", "suburban", "traverse", "camaro", "colorado"],
    },
    {
        family: "general_motors",
        canonicalMake: "GMC",
        manufacturerTerms: ["gmc"],
        modelTerms: ["sierra", "yukon", "acadia", "terrain", "canyon"],
    },
    {
        family: "general_motors",
        canonicalMake: "Cadillac",
        manufacturerTerms: ["cadillac", "buick"],
        modelTerms: ["escalade", "xt4", "xt5", "enclave", "envision"],
    },
    {
        family: "mercedes_benz",
        canonicalMake: "Mercedes-Benz",
        manufacturerTerms: ["mercedes", "mercedes benz", "daimler", "amg", "mbusa"],
        modelTerms: [
            "gla",
            "glb",
            "glc",
            "gle",
            "gls",
            "gle 350",
            "gle 450",
            "c class",
            "e class",
            "s class",
            "cla",
            "sprinter",
            "metris",
        ],
    },
    {
        family: "toyota",
        canonicalMake: "Toyota",
        manufacturerTerms: ["toyota", "lexus", "scion", "toyota motor"],
        modelTerms: ["camry", "corolla", "rav4", "highlander", "tacoma", "tundra", "4runner", "sienna", "prius", "rx 350", "es 350", "nx 300"],
    },
    {
        family: "ford",
        canonicalMake: "Ford",
        manufacturerTerms: ["ford", "lincoln", "motorcraft", "ford motor"],
        modelTerms: ["f 150", "f 250", "escape", "explorer", "mustang", "edge", "bronco", "ranger", "fusion", "navigator", "aviator", "maverick"],
    },
    {
        family: "volkswagen_group",
        canonicalMake: "Volkswagen",
        manufacturerTerms: ["volkswagen", "vw", "audi", "porsche"],
        modelTerms: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "q5", "q7", "a4", "a6", "macan", "cayenne", "taos"],
    },
    {
        family: "jaguar_land_rover",
        canonicalMake: "Land Rover",
        manufacturerTerms: ["jaguar", "land rover", "range rover", "jlr"],
        modelTerms: ["defender", "discovery", "evoque", "velar", "f pace", "e pace"],
    },
    {
        family: "mazda",
        canonicalMake: "Mazda",
        manufacturerTerms: ["mazda", "mazda north american"],
        modelTerms: ["cx 5", "cx 9", "cx 30", "cx 50", "cx 90", "mazda3", "mazda 3", "mazda6", "mazda 6", "mx 5", "miata"],
    },
];
const GENERIC_REPAIR_TERMS = [
    "bumper cover",
    "scan",
    "calibration",
    "bracket",
    "reinforcement",
    "alignment",
    "test fit",
    "park sensor",
    "front camera",
    "guide",
    "absorber",
    "duct",
    "ducting",
    "shutter",
];
function resolveVehicleApplicabilityContext(...candidates) {
    for (const candidate of candidates) {
        const normalized = (0, vehicleContext_1.normalizeVehicleIdentity)(candidate);
        if (!normalized)
            continue;
        const canonicalMake = canonicalizeMake(normalized.make ?? normalized.manufacturer);
        return {
            year: normalized.year,
            make: normalized.make,
            model: normalized.model,
            trim: normalized.trim,
            manufacturer: normalized.manufacturer,
            canonicalMake,
            manufacturerFamily: resolveManufacturerFamily(normalized.make, normalized.manufacturer),
        };
    }
    return {};
}
function assessVehicleApplicability(text, vehicle) {
    const haystack = normalizeHaystack(text);
    if (!haystack) {
        return {
            rating: "generic",
            mentionedFamilies: [],
            mentionedTerms: [],
        };
    }
    const mentionedGroups = VEHICLE_TERM_GROUPS.filter((group) => [...group.manufacturerTerms, ...group.modelTerms].some((term) => containsVehicleTerm(haystack, term)));
    const mentionedFamilies = [...new Set(mentionedGroups.map((group) => group.family))];
    const mentionedTerms = mentionedGroups.flatMap((group) => [...group.manufacturerTerms, ...group.modelTerms].filter((term) => containsVehicleTerm(haystack, term)));
    const actualFamily = vehicle?.manufacturerFamily;
    const actualCanonicalMake = vehicle?.canonicalMake;
    const actualModelTerms = buildActualModelTerms(vehicle);
    const mentionsGenericOnly = mentionedFamilies.length === 0 &&
        GENERIC_REPAIR_TERMS.some((term) => containsVehicleTerm(haystack, term));
    if (!actualFamily && !actualCanonicalMake) {
        // FAIL CLOSED: when the estimate vehicle's make could not be resolved, a
        // document that names a SPECIFIC manufacturer family cannot be treated as
        // matching — that is how a Rivian file collected GM position statements.
        // Make-specific documents rate as mismatched; only generic repair guidance
        // stays eligible.
        return {
            rating: mentionedFamilies.length > 0 ? "mismatched_vehicle" : "generic",
            mentionedFamilies,
            mentionedTerms,
        };
    }
    if (mentionedFamilies.length > 0 &&
        mentionedFamilies.some((family) => family !== actualFamily)) {
        return {
            rating: "mismatched_vehicle",
            mentionedFamilies,
            mentionedTerms,
        };
    }
    if (actualModelTerms.some((term) => containsVehicleTerm(haystack, term))) {
        return {
            rating: "exact_vehicle_match",
            mentionedFamilies,
            mentionedTerms,
        };
    }
    if ((actualCanonicalMake && containsVehicleTerm(haystack, actualCanonicalMake)) ||
        mentionedFamilies.includes(actualFamily ?? "")) {
        return {
            rating: "manufacturer_match",
            mentionedFamilies,
            mentionedTerms,
        };
    }
    return {
        rating: mentionsGenericOnly ? "generic" : "generic",
        mentionedFamilies,
        mentionedTerms,
    };
}
function isVehicleContentApplicable(text, vehicle) {
    return assessVehicleApplicability(text, vehicle).rating !== "mismatched_vehicle";
}
function assessRetrievedDocumentApplicability(params) {
    const combined = [params.title, params.excerpt, params.source].filter(Boolean).join(" ");
    const base = assessVehicleApplicability(combined, params.vehicle);
    const actualModelTerms = buildActualModelTerms(params.vehicle);
    const actualFamily = params.vehicle?.manufacturerFamily;
    const sameFamilyGroups = VEHICLE_TERM_GROUPS.filter((group) => group.family === actualFamily);
    const mentionedSameFamilyModelTerms = sameFamilyGroups.flatMap((group) => group.modelTerms.filter((term) => containsVehicleTerm(normalizeHaystack(combined), term)));
    const sameFamilyHasDifferentSpecificModel = mentionedSameFamilyModelTerms.length > 0 &&
        !mentionedSameFamilyModelTerms.some((term) => actualModelTerms.some((actual) => normalizeVehicleToken(actual) === normalizeVehicleToken(term)));
    if (base.rating === "mismatched_vehicle") {
        return {
            matchLevel: base.rating,
            keep: false,
            reason: "Retrieved document names a different make, manufacturer, or OEM-specific system than the submitted vehicle.",
            mentionedFamilies: base.mentionedFamilies,
            mentionedTerms: base.mentionedTerms,
        };
    }
    if (base.rating === "exact_vehicle_match") {
        return {
            matchLevel: base.rating,
            keep: true,
            reason: "Retrieved document matches the estimate vehicle or model-specific context.",
            mentionedFamilies: base.mentionedFamilies,
            mentionedTerms: base.mentionedTerms,
        };
    }
    if (base.rating === "manufacturer_match") {
        if (sameFamilyHasDifferentSpecificModel) {
            return {
                matchLevel: base.rating,
                keep: false,
                reason: "Retrieved document stays within the same manufacturer family but appears model-specific to a different vehicle.",
                mentionedFamilies: base.mentionedFamilies,
                mentionedTerms: base.mentionedTerms,
            };
        }
        return {
            matchLevel: base.rating,
            keep: true,
            reason: "Retrieved document matches the same manufacturer family without conflicting model-specific language.",
            mentionedFamilies: base.mentionedFamilies,
            mentionedTerms: base.mentionedTerms,
        };
    }
    return {
        matchLevel: "generic",
        keep: true,
        reason: "Retrieved document is vehicle-neutral and can support the repair topic without conflicting make-specific language.",
        mentionedFamilies: base.mentionedFamilies,
        mentionedTerms: base.mentionedTerms,
    };
}
function sanitizeVehicleSpecificText(value, vehicle) {
    const text = value?.trim();
    if (!text)
        return "";
    if (assessVehicleApplicability(text, vehicle).rating !== "mismatched_vehicle") {
        return text;
    }
    const segments = text
        .split(/(?<=[.!?])\s+|\n+/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    const kept = segments.filter((segment) => isVehicleContentApplicable(segment, vehicle));
    return kept.join(" ").trim();
}
function canonicalizeMake(value) {
    const normalized = normalizeVehicleToken(value);
    if (!normalized)
        return undefined;
    const matchedGroup = VEHICLE_TERM_GROUPS.find((group) => [group.canonicalMake, ...group.manufacturerTerms].some((term) => normalizeVehicleToken(term) === normalized));
    return matchedGroup?.canonicalMake ?? titleCaseVehicleToken(normalized);
}
function resolveManufacturerFamily(make, manufacturer) {
    const normalizedCandidates = [make, manufacturer]
        .map((value) => normalizeVehicleToken(value))
        .filter(Boolean);
    for (const candidate of normalizedCandidates) {
        const matchedGroup = VEHICLE_TERM_GROUPS.find((group) => [group.canonicalMake, ...group.manufacturerTerms].some((term) => normalizeVehicleToken(term) === candidate));
        if (matchedGroup) {
            return matchedGroup.family;
        }
    }
    return normalizedCandidates[0];
}
function buildActualModelTerms(vehicle) {
    const terms = [vehicle?.model, vehicle?.trim]
        .flatMap((value) => splitVehicleDescriptor(value))
        .filter(Boolean);
    return [...new Set(terms)];
}
function splitVehicleDescriptor(value) {
    const normalized = normalizeVehicleToken(value);
    if (!normalized)
        return [];
    const compact = normalized.replace(/\s+/g, " ").trim();
    const terms = new Set([compact]);
    for (const token of compact.split(/\s+/)) {
        if (token.length >= 2) {
            terms.add(token);
        }
    }
    return [...terms];
}
function normalizeVehicleToken(value) {
    return (value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function normalizeHaystack(value) {
    return ` ${normalizeVehicleToken(value)} `;
}
function containsVehicleTerm(haystack, term) {
    const normalizedTerm = normalizeVehicleToken(term);
    if (!normalizedTerm)
        return false;
    return haystack.includes(` ${normalizedTerm} `);
}
function titleCaseVehicleToken(value) {
    return value
        .split(" ")
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(" ");
}
