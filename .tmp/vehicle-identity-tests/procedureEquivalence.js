"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_PROCEDURES = void 0;
exports.findProcedureMatches = findProcedureMatches;
exports.hasProcedure = hasProcedure;
exports.CANONICAL_PROCEDURES = [
    {
        key: "pre_scan",
        label: "Pre-repair scan",
        aliases: [
            "pre-repair scan",
            "pre repair scan",
            "pre-scan",
            "pre scan",
            "preliminary diagnostics",
            "diagnostic scan before repair",
        ],
    },
    {
        key: "in_process_scan",
        label: "In-process scan",
        aliases: [
            "in-proc repair scan",
            "in-proc scan",
            "in process scan",
            "in-process scan",
            "repair scan",
        ],
    },
    {
        key: "post_scan",
        label: "Post-repair scan",
        aliases: [
            "post-repair scan",
            "post repair scan",
            "post-scan",
            "post scan",
            "final scan",
        ],
    },
    {
        key: "fault_clear",
        label: "Fault clear",
        aliases: [
            "scan and clear faults",
            "clear faults",
            "faults cleared",
            "clear fault memory",
        ],
    },
    {
        key: "headlamp_aim",
        label: "Headlamp aim",
        aliases: [
            "aim headlamps",
            "aim headlamp",
            "headlamp aim",
            "headlamp aiming",
            "aim headlights",
            "headlight aim",
            "headlight aiming",
        ],
    },
    {
        key: "fog_lamp_aim",
        label: "Fog lamp aim",
        aliases: [
            "aim fog lamps",
            "aim fog lamp",
            "fog lamp aim",
            "fog lamp aiming",
            "fog light aim",
            "fog light aiming",
        ],
    },
    {
        key: "wheel_alignment",
        label: "Wheel alignment",
        aliases: [
            "four wheel suspension alignment",
            "four wheel alignment",
            "4 wheel alignment",
            "suspension alignment",
            "wheel alignment",
            "alignment",
        ],
    },
    {
        key: "seat_belt_check",
        label: "Seat belt system check",
        aliases: [
            "seat belt dynamic function test",
            "seat belt system operational check",
            "inspect seat belt system",
            "seatbelt system inspection",
            "seat belt check",
            "restraint inspection",
        ],
    },
    {
        key: "front_camera_calibration",
        label: "Front camera calibration",
        aliases: [
            "front camera calibration",
            "forward camera calibration",
            "windscreen camera calibration",
            "kafas calibration",
            "adas camera calibration",
            "camera dynamic calibration",
            "camera static calibration",
        ],
    },
    {
        key: "rear_camera_calibration",
        label: "Rear camera calibration",
        aliases: [
            "rear camera calibration",
            "backup camera calibration",
            "rear view camera calibration",
            "rvc calibration",
            "trsvc calibration",
            "top rear side view camera calibration",
        ],
    },
    {
        key: "side_camera_calibration",
        label: "Side camera calibration",
        aliases: [
            "side camera calibration",
            "mirror camera calibration",
            "right side camera calibration",
            "left side camera calibration",
            "side view camera calibration",
        ],
    },
    {
        key: "surround_camera_calibration",
        label: "All-around / surround camera calibration",
        aliases: [
            "all-around cameras static calibration",
            "all around cameras static calibration",
            "all-around vision camera",
            "all around vision camera",
            "surround view calibration",
            "surround camera calibration",
            "peripheral camera calibration",
            "360 camera calibration",
            "all-around camera calibration",
        ],
        implies: [
            "front_camera_calibration",
            "rear_camera_calibration",
            "side_camera_calibration",
        ],
    },
    {
        key: "front_side_radar_calibration",
        label: "Front side radar calibration",
        aliases: [
            "front side radar static calibration",
            "side radar sensor - front",
            "front side radar calibration",
            "side radar calibration",
        ],
        implies: [
            "lane_change_calibration",
            "lane_departure_calibration",
        ],
    },
    {
        key: "rear_side_radar_calibration",
        label: "Rear side radar calibration",
        aliases: [
            "rear side radar calibration",
            "rear radar sensor calibration",
            "blind spot radar calibration",
        ],
    },
    {
        key: "acc_radar_calibration",
        label: "ACC / front radar calibration",
        aliases: [
            "acc calibration",
            "adaptive cruise control calibration",
            "adaptive cruise control static alignment",
            "radar calibration",
            "front radar calibration",
            "acc radar calibration",
            "frs calibration",
            "frsf calibration",
        ],
    },
    {
        key: "steering_angle_calibration",
        label: "Steering angle calibration",
        aliases: [
            "steering angle sensor calibration",
            "steering angle calibration",
            "sas reset",
            "steering angle sensor reset",
        ],
    },
    {
        key: "lane_departure_calibration",
        label: "Lane departure / lane keeping coverage",
        aliases: [
            "lane departure warning",
            "lane keeping assistant",
            "lane detection",
            "responsible for lane detection",
        ],
    },
    {
        key: "lane_change_calibration",
        label: "Lane change warning coverage",
        aliases: [
            "lane change calibration",
            "lane change warning",
            "blind spot detection",
            "active blind spot detection",
            "front side radar static calibration",
        ],
    },
    {
        key: "adas_report",
        label: "ADAS report",
        aliases: [
            "adas report",
            "revvadas report",
            "please see adas report",
        ],
    },
];
function normalizeText(value) {
    return value
        .toLowerCase()
        .replace(/[^\w\s/-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function findProcedureMatches(text) {
    const normalized = normalizeText(text);
    const matches = [];
    for (const procedure of exports.CANONICAL_PROCEDURES) {
        for (const alias of procedure.aliases) {
            const normalizedAlias = normalizeText(alias);
            if (normalized.includes(normalizedAlias)) {
                matches.push({
                    key: procedure.key,
                    matchedAlias: alias,
                    evidence: text.trim(),
                });
            }
        }
    }
    return dedupeMatches(expandImplications(matches));
}
function expandImplications(matches) {
    const expanded = [...matches];
    for (const match of matches) {
        const procedure = exports.CANONICAL_PROCEDURES.find((p) => p.key === match.key);
        if (!procedure?.implies?.length)
            continue;
        for (const implied of procedure.implies) {
            expanded.push({
                key: implied,
                matchedAlias: `[implied by ${match.key}]`,
                evidence: match.evidence,
            });
        }
    }
    return expanded;
}
function dedupeMatches(matches) {
    const seen = new Map();
    for (const match of matches) {
        const key = `${match.key}:${match.evidence.toLowerCase()}`;
        if (!seen.has(key))
            seen.set(key, match);
    }
    return [...seen.values()];
}
function hasProcedure(matches, key) {
    return matches.some((match) => match.key === key);
}
