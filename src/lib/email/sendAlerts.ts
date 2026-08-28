import { Resend } from "resend";

// Constructed lazily (mirrors src/lib/billing/stripe.ts): a top-level
// `new Resend(...)` throws immediately when RESEND_API_KEY is unset, which
// crashed `next build`'s page-data collection for every route that imports
// this module transitively, in any environment without the key configured.
let resend: Resend | null | undefined;
function getResend(): Resend | null {
  if (resend === undefined) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    resend = apiKey ? new Resend(apiKey) : null;
  }
  return resend;
}

export async function sendPurchaseAlert(params: {
  serviceType: string;
  serviceName: string;
  userId: string;
  userEmail: string;
  userName?: string;
  sessionId: string;
  claimId?: string;
}): Promise<void> {
  const {
    serviceType,
    serviceName,
    userId,
    userEmail,
    userName,
    sessionId,
    claimId,
  } = params;

  const adminEmail = "vinny@collision.academy";

  const emailBody = `
A new purchase has been made in Collision iQ:

Service: ${serviceName} (${serviceType})
User ID: ${userId}
User Email: ${userEmail}
User Name: ${userName || "—"}
Session ID: ${sessionId}
Claim ID: ${claimId || "—"}
Timestamp: ${new Date().toISOString()}
  `.trim();

  const client = getResend();
  if (!client) {
    console.warn("[sendPurchaseAlert] RESEND_API_KEY not set — skipping alert email.");
    return;
  }
  try {
    await client.emails.send({
      from: "reports@collision-iq.ai",
      to: adminEmail,
      subject: `[Value IQ] Purchase Alert: ${serviceName}`,
      text: emailBody,
    });
  } catch (error) {
    console.error("[sendPurchaseAlert] Failed to send alert email:", error);
    // Don't throw — log and continue. A failed alert shouldn't block the checkout flow.
  }
}

export async function sendSubscriptionAlert(params: {
  subscriptionType: string;
  subscriptionName: string;
  userId: string;
  userEmail: string;
  userName?: string;
  sessionId: string;
}): Promise<void> {
  const {
    subscriptionType,
    subscriptionName,
    userId,
    userEmail,
    userName,
    sessionId,
  } = params;

  const adminEmail = "vinny@collision.academy";

  const emailBody = `
A new subscription has been created in Collision iQ:

Subscription: ${subscriptionName} (${subscriptionType})
User ID: ${userId}
User Email: ${userEmail}
User Name: ${userName || "—"}
Session ID: ${sessionId}
Timestamp: ${new Date().toISOString()}
  `.trim();

  const client = getResend();
  if (!client) {
    console.warn("[sendSubscriptionAlert] RESEND_API_KEY not set — skipping alert email.");
    return;
  }
  try {
    await client.emails.send({
      from: "reports@collision-iq.ai",
      to: adminEmail,
      subject: `[Collision iQ] Subscription Alert: ${subscriptionName}`,
      text: emailBody,
    });
  } catch (error) {
    console.error("[sendSubscriptionAlert] Failed to send alert email:", error);
    // Don't throw — log and continue.
  }
}
