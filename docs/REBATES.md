# Referral cases and Medicare rebates

HappyDays manages Cliniko referral cases and prepares **fully paid patient claims** through the Tyro Health SDK. Bulk billing is outside this workflow. Actual Tyro submission requires partner onboarding, domain allowlisting and credentials; no Tyro claim has been tested against a live or staging account yet.

## Staff workflow

Open **Cliniko → Medicare Rebates** (`/bookings/rebates`).

1. Create a Medicare referral case manually, or import an emailed plan. The case's issue date, optional recorded expiry, notes and session limit are stored in Cliniko. The manual form is also available from a patient's Cases panel.
2. For automatic imports, configure a Gmail filter to label incoming referral emails `HappyDays/Referrals`, then enable automatic imports on the rebate page. Only messages received after activation, seen by incremental Gmail history sync and already carrying that label are considered. A message must have exactly one supported PDF/photo attachment and match one Cliniko patient by exact full name and DOB. Otherwise staff receive an in-app notification to review it manually. There is no historic mailbox import and no automatic verification of clinical validity. Applying a label later to an existing email does not trigger this workflow; use its manual import button.
3. Select the appointment and case, link them, and verify the original referral against the current Cliniko case. Subsequent edits to the case invalidate that verification.
4. Confirm that the patient attended. An elapsed appointment time never establishes attendance. Cancelled, archived, deleted and did-not-arrive appointments are ineligible.
5. Ensure the session invoice is fully paid. Cliniko status **20 (Paid)** qualifies; **30 (Closed)** does not. A full HappyDays booking payment is checked live in Stripe, including refunds and disputes, even if Cliniko still says Paid. A verified full payment can also qualify an open session invoice. Deposits do not qualify. Exactly one active Cliniko session invoice is required; consolidate/reconcile unusual billing arrangements in Cliniko before using this workflow. Payment is not inferred from an unrelated Stripe invoice, a report payment or a payer's email address.
6. Confirm Medicare entitlement for the service, including annual usage at other clinics, and that no claim was already submitted in Cliniko, Tyro or elsewhere. The local case count is not a Medicare entitlement check. Enter the service's MBS item and referring provider number. The treating provider number must match the appointment's practitioner and business location in Cliniko. Add an adult claimant for a patient under 15.
7. Open the Tyro review flow. Select the **already-paid patient claim** option; HappyDays has already verified payment and does not need to charge the patient again. Confirm the claim in Tyro. This version prepares and tracks claims; it does not submit unattended background claims.

## Go-live cutoff

There is no planned launch date. Leave the cutoff unset during development. When HappyDays is ready, use **Go live now → Record go-live now**. The server records the current instant in a dedicated table. It cannot be changed through normal settings or by pressing the button again.

Appointments that took place before HappyDays went live are not eligible for rebate processing through HappyDays. Appointment start must be on or after the cutoff; appointment end must be at or before the current time. A later attendance confirmation or payment cannot qualify an earlier appointment. Dates are displayed and referral/service dates are evaluated in Australia/Melbourne, including daylight saving.

The case's last allocated session remains claimable: the appointment's chronological allocation within the referral is checked, rather than requiring an unused booking slot after that appointment has already been linked. Future bookings do not displace earlier sessions. Cancelled/DNA counting follows the case's settings. Incomplete case pagination blocks claiming.

## Tyro setup before enabling submission

Obtain an App ID and staging business credentials from Tyro Health partnerships, register the practice/provider numbers, and have HappyDays' origin allowlisted. Use Tyro's supplied synthetic patients for staging validation; the app intentionally does not send live Cliniko patient records to a staging account.

Configure these **server-side Convex environment variables** after partner acceptance:

- `TYRO_ENV=prod`
- `TYRO_API_KEY`: business admin API key
- `TYRO_APP_ID`: approved partner App ID
- `TYRO_BUSINESS_ID`: the business that owns the claims

HappyDays exchanges the admin key for a five-minute SDK token on the server. The admin key is never returned to the browser. The SDK is installed as `@medipass/partner-sdk`; CSP permits its specific hosted iframe origins.

The token endpoint and transaction lookup by invoice reference follow Tyro's SDK documentation and the installed SDK. Confirm them, the already-paid flow, required declarations, adult claimant behavior, response shapes and origin allowlisting against the partner sandbox before production activation. The public documentation does not establish approval for unattended Direct API submissions, so no undocumented claim-creation endpoint is used.

## Claim history and recovery

A Convex transaction reserves each appointment before handing the claim to Tyro. Concurrent attempts conflict; subsequent requests cannot silently double-submit. An opaque reference (16 characters) correlates the local attempt to Tyro. The client never decides whether Medicare approved a claim. **Check Tyro** and a ten-minute scheduled reconciliation read the authoritative transaction by that reference.

Opening/closing a browser window, a timeout or an SDK error does not prove that no claim was lodged. Those attempts remain locked pending reconciliation. A failure to obtain a token *before* handoff is safe to retry. A confirmed rejection/cancellation permits a fresh attempt. For an abandoned flow with no Tyro transaction, staff must check Tyro and have an administrator reconcile the unresolved local record; the app deliberately offers no unchecked reset button. Do not delete history to retry.

Approved claims are not downgraded by delayed pending responses. Tyro's patient-claim approval is kept separate from confirmation that the benefit reached the patient's bank account. Polling rotates through all unresolved attempts, at most 25 per pass, including attempts whose previous lookup failed. Paginated claim history lets staff inspect and reconcile older attempts. Case-level reservations also prevent an allocation being reused after appointments are moved or removed in Cliniko.

Case creation uses a source reservation. Email documents use a SHA-256 digest so importing the same attachment again, including a forwarded copy, does not create another case. A Cliniko timeout after POST leaves an uncertain reservation: check Cliniko before retrying. No clinical document or Medicare card number is persisted in HappyDays' claim tables; these contain linkage, service/claim metadata and verification audit records.

## Validation

| Before | After |
| --- | --- |
| Patient cases could be created with only a name. | A labelled referral form captures issue date, session allowance, optional expiry and notes. |
| Email extraction required manual patient selection and left referral allocation in notes. | Exact patient matching can create a case, with editable date and allocation for manual creation. |
| No Medicare rebate workspace. | A navigation entry and patient shortcut open session selection, eligibility reasons, referral verification, provider/item/claimant fields and Tyro review. |
| Elapsed appointments could appear attended. | Attendance remains unconfirmed until explicitly recorded. |
| No launch boundary or import controls. | An unset-cutoff notice, permanent go-live confirmation and opt-in Gmail import control explain the available actions. |
| No claim tracking or reconciliation. | Paginated history shows fee, reference and server-verified status, with reconciliation controls. |
| New rebate controls had no presentation rules. | Controls use labelled fields and at least 40 px targets; changing numeric values use tabular figures; rebate dates and times display in Melbourne time. |

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Tests use synthetic data, mocked network responses and an isolated Convex database. They cover cutoff boundaries, attendance, payment states, referral changes, final-session allocation, concurrent reservations, automatic patient matching and source deduplication. No real claim is submitted by the test suite.

References:
- https://docs.api.cliniko.com/openapi/patient-case
- https://docs.api.cliniko.com/openapi/attendee
- https://docs.api.cliniko.com/openapi/invoice/invoice
- https://docs.tyrohealth.com/developer-portal/sdk/setup
- https://docs.tyrohealth.com/developer-portal/medicare/medicare-attributes
- https://docs.tyrohealth.com/developer-portal/medicare/webhooks
- https://www.servicesaustralia.gov.au/mbs-billing-rules-for-mental-health-services
