// MOTOR DaaS HTTP client (server-only). Credentials come from MOTOR_DAAS_*
// env vars — NEVER NEXT_PUBLIC_*, never sent to the client bundle, never
// logged. Logging is metadata-only per MOTOR_DAAS_LOG_LEVEL. Every failure is
// non-fatal to callers: they receive a null payload and keep going.

import "server-only";

export type MotorDaasConfig = {
  enabled: boolean;
  dtcEnabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  attributeStandard: string;
  /** Route template for vehicle-specific DTC details. Tunable via env to match
   * the live api.motor.com/v1 documentation without code changes. */
  dtcVehicleRouteTemplate: string;
  /** Optional general/reference DTC route. Only used when explicitly set —
   * i.e. after the route is verified to work without a vehicle/application id. */
  dtcGeneralRouteTemplate: string | null;
};

export function getMotorDaasConfig(env: NodeJS.ProcessEnv = process.env): MotorDaasConfig {
  return {
    enabled: env.MOTOR_DAAS_ENABLED === "true",
    dtcEnabled: env.MOTOR_DAAS_DTC_ENABLED === "true",
    baseUrl: (env.MOTOR_DAAS_BASE_URL || "https://api.motor.com/v1").replace(/\/$/, ""),
    timeoutMs: Number(env.MOTOR_DAAS_TIMEOUT_MS) > 0 ? Number(env.MOTOR_DAAS_TIMEOUT_MS) : 15000,
    attributeStandard: env.MOTOR_DAAS_ATTRIBUTE_STANDARD || "MOTOR",
    dtcVehicleRouteTemplate:
      env.MOTOR_DAAS_DTC_VEHICLE_ROUTE_TEMPLATE ||
      "/Information/Vehicles/{motorVehicleId}/DiagnosticTroubleCodes/{code}",
    dtcGeneralRouteTemplate: env.MOTOR_DAAS_DTC_GENERAL_ROUTE_TEMPLATE || null,
  };
}

export function isMotorDtcLookupConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = getMotorDaasConfig(env);
  return (
    config.enabled &&
    config.dtcEnabled &&
    Boolean(env.MOTOR_DAAS_PUBLIC_KEY?.trim()) &&
    Boolean(env.MOTOR_DAAS_PRIVATE_KEY?.trim())
  );
}

export type MotorDaasResponse = {
  ok: boolean;
  status: number | null;
  /** Parsed JSON body on success; null otherwise. */
  body: unknown;
  route: string;
};

/**
 * GET a MOTOR DaaS route. Auth uses the sandbox public/private key pair as
 * basic credentials. Times out via AbortController; never throws.
 */
export async function motorDaasGet(
  route: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<MotorDaasResponse> {
  const config = getMotorDaasConfig(env);
  const publicKey = env.MOTOR_DAAS_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.MOTOR_DAAS_PRIVATE_KEY?.trim() ?? "";
  const url = `${config.baseUrl}${route.startsWith("/") ? route : `/${route}`}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${publicKey}:${privateKey}`).toString("base64")}`,
        AttributeStandard: config.attributeStandard,
      },
      signal: controller.signal,
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    if (!response.ok && env.MOTOR_DAAS_LOG_LEVEL !== "silent") {
      // Metadata only — never payloads or credentials.
      console.warn("[motor-daas] request failed", { route, status: response.status });
    }
    return { ok: response.ok, status: response.status, body, route };
  } catch (error) {
    if (env.MOTOR_DAAS_LOG_LEVEL !== "silent") {
      console.warn("[motor-daas] request errored", {
        route,
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
    return { ok: false, status: null, body: null, route };
  } finally {
    clearTimeout(timer);
  }
}
