"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatAnalysisOutputJsonSchema = exports.CHATBOT_TASK_TYPES = void 0;
exports.CHATBOT_TASK_TYPES = [
    "estimate_review",
    "repairability_analysis",
    "document_comparison",
    "photo_review",
    "part_lookup",
    "oem_procedure_insight",
    "web_assisted_question",
    "general_chat",
];
exports.chatAnalysisOutputJsonSchema = {
    name: "chat_analysis_output",
    strict: true,
    schema: {
        type: "object",
        additionalProperties: false,
        required: [
            "schemaVersion",
            "taskType",
            "finalAnswer",
            "summary",
            "repairStrategy",
            "estimatePosture",
            "keyDrivers",
            "strengths",
            "weaknesses",
            "missingOperations",
            "oemInsights",
            "negotiationPoints",
            "diminishedValue",
            "vehicleIdentification",
            "evidenceMapping",
        ],
        properties: {
            schemaVersion: {
                type: "string",
                enum: ["1.0"],
            },
            taskType: {
                type: "string",
                enum: [...exports.CHATBOT_TASK_TYPES],
            },
            finalAnswer: {
                type: "string",
                description: "Natural-language answer shown in the chat transcript.",
            },
            summary: {
                type: "object",
                additionalProperties: false,
                required: ["headline", "overview"],
                properties: {
                    headline: { type: "string" },
                    overview: { type: "string" },
                },
            },
            repairStrategy: {
                type: "object",
                additionalProperties: false,
                required: [
                    "overallAssessment",
                    "repairVsReplace",
                    "structuralImplications",
                    "calibrationImplications",
                ],
                properties: {
                    overallAssessment: { type: "string" },
                    repairVsReplace: {
                        type: "array",
                        items: { type: "string" },
                    },
                    structuralImplications: {
                        type: "array",
                        items: { type: "string" },
                    },
                    calibrationImplications: {
                        type: "array",
                        items: { type: "string" },
                    },
                },
            },
            estimatePosture: {
                type: "object",
                additionalProperties: false,
                required: ["label", "rationale"],
                properties: {
                    label: {
                        type: "string",
                        enum: [
                            "balanced",
                            "conservative",
                            "aggressive",
                            "incomplete",
                            "access_driven",
                            "damage_driven",
                            "unknown",
                        ],
                    },
                    rationale: { type: "string" },
                },
            },
            keyDrivers: {
                type: "array",
                items: { type: "string" },
            },
            strengths: {
                type: "array",
                items: { type: "string" },
            },
            weaknesses: {
                type: "array",
                items: { type: "string" },
            },
            missingOperations: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["operation", "severity", "reason"],
                    properties: {
                        operation: { type: "string" },
                        severity: {
                            type: "string",
                            enum: ["low", "medium", "high"],
                        },
                        reason: { type: "string" },
                    },
                },
            },
            oemInsights: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["topic", "applies", "insight", "sourceIds"],
                    properties: {
                        topic: { type: "string" },
                        applies: { type: "boolean" },
                        insight: { type: "string" },
                        sourceIds: {
                            type: "array",
                            items: { type: "string" },
                        },
                    },
                },
            },
            negotiationPoints: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["title", "point", "leverage", "sourceIds"],
                    properties: {
                        title: { type: "string" },
                        point: { type: "string" },
                        leverage: {
                            type: "string",
                            enum: ["low", "medium", "high"],
                        },
                        sourceIds: {
                            type: "array",
                            items: { type: "string" },
                        },
                    },
                },
            },
            diminishedValue: {
                type: "object",
                additionalProperties: false,
                required: ["likelyApplicable", "rationale"],
                properties: {
                    likelyApplicable: { type: "boolean" },
                    rangeLow: { type: "number" },
                    rangeHigh: { type: "number" },
                    rationale: { type: "string" },
                },
            },
            vehicleIdentification: {
                type: "object",
                additionalProperties: false,
                required: ["source", "confidence"],
                properties: {
                    year: { type: "number" },
                    make: { type: "string" },
                    model: { type: "string" },
                    trim: { type: "string" },
                    manufacturer: { type: "string" },
                    vin: { type: "string" },
                    source: {
                        type: "string",
                        enum: ["attachment", "user", "inferred", "vin_decoded", "unknown"],
                    },
                    confidence: {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                    },
                },
            },
            evidenceMapping: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "claim", "summary", "confidence", "sources"],
                    properties: {
                        id: { type: "string" },
                        claim: { type: "string" },
                        summary: { type: "string" },
                        confidence: {
                            type: "string",
                            enum: ["low", "medium", "high"],
                        },
                        sources: {
                            type: "array",
                            items: {
                                type: "object",
                                additionalProperties: false,
                                required: ["sourceType", "sourceId", "label"],
                                properties: {
                                    sourceType: {
                                        type: "string",
                                        enum: [
                                            "attachment",
                                            "drive_oem",
                                            "internal_rule",
                                            "web",
                                            "user_message",
                                            "inference",
                                        ],
                                    },
                                    sourceId: { type: "string" },
                                    label: { type: "string" },
                                    excerpt: { type: "string" },
                                    page: { type: "number" },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};
