import { verifiedTyroStatus } from "./rebateRules";

/** Server-only credentials. SDK host/endpoints verified against partner-sdk 3.1.0. */
export function tyroConfig() {
  const apiKey = process.env.TYRO_API_KEY, appId = process.env.TYRO_APP_ID, businessId = process.env.TYRO_BUSINESS_ID;
  if (!apiKey || !appId || !businessId || process.env.TYRO_ENV !== "prod") throw new Error("Tyro partner access is not configured for production. Live patient claims are disabled.");
  return { apiKey, appId, businessId, base: "https://api-au.medipass.io/v3" };
}
async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const c = tyroConfig();
  const response = await fetch(`${c.base}${path}`, { ...init, signal: AbortSignal.timeout(20_000), headers: {
    Authorization: `Bearer ${c.apiKey}`, "x-appid": c.appId, "x-appver": "happydays-0.1.0", "Content-Type": "application/json",
  } });
  // Do not put upstream response bodies (which can contain patient data) in logs or errors.
  if (!response.ok) throw new Error(`Tyro request failed (${response.status}). Reconcile the claim before retrying.`);
  return await response.json() as Record<string, unknown>;
}
export async function sdkToken(): Promise<{ token: string; appId: string }> {
  const result = await request("/auth/token", { method: "POST", body: JSON.stringify({ audience: "aud:business-sdk", expiresIn: "5m" }) });
  if (typeof result.token !== "string" || !result.token) throw new Error("Tyro did not return an SDK token.");
  return { token: result.token, appId: tyroConfig().appId };
}
export async function readClaim(invoiceReference: string): Promise<{ transactionId: string; status: string }> {
  const { businessId } = tyroConfig();
  const transaction = await request(`/businesses/${encodeURIComponent(businessId)}/transactions/invoicereference/${encodeURIComponent(invoiceReference)}`);
  if (transaction.invoiceReference !== invoiceReference || typeof transaction._id !== "string") throw new Error("Tyro transaction reference did not match. Manual reconciliation is required.");
  const claims = Array.isArray(transaction.claims) ? transaction.claims as Array<{ status?: string }> : [];
  return { transactionId: transaction._id, status: verifiedTyroStatus({ claims, businessStatus: typeof transaction.businessStatus === "string" ? transaction.businessStatus : undefined }) };
}
