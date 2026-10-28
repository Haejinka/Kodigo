# Kodigo technical validation for RQ2

Assessment date: 27 October 2026 (Asia/Manila). Reviewer: Codex, an AI-assisted technical review. This report records executed verification and inspection, not human expert-survey ratings.

**Conclusion: conditional technical suitability; two confirmed authorization failures require remediation.**

The source thesis research design retains its separate qualified-evaluator survey. This review supplies implementation evidence and does not manufacture respondent participation, means, standard deviations, signatures, or acceptance scores.

## Executed checks

- TypeScript, lint and production build passed. Build size/import warnings remain.
- Existing unit tests: 17 passed, zero failed.
- Controlled live database scenarios: 20 passed, 2 failed. Synthetic identities and writes were rolled back. A follow-up query confirmed zero synthetic Auth identities, stores, products, and audit events remained.
- Four anonymous browser routes redirected to login.
- Backend TLS 1.3 and certificate check passed; three anonymous API/Edge requests returned 401.
- Credential-pattern scan: 105 client files, no matching private/secret/service-role credentials.
- Live metadata: RLS enabled on 36 public tables; invoker security on 8 public views.

Database tests simulate PostgreSQL roles and JWT claims. They do not validate signed JWT issuance, Auth login, actual TOTP challenge, or HTTP gateway behavior. The HTTPS tests are separate direct requests. The repository service-role integration harness was not run because its dedicated credential was unavailable.

## Controlled database scenario register

| ID | Expected behavior | Result | Observation |
|---|---|---|---|
| DB01 | Admin reads assigned-store product | PASS | observed_rows=1 |
| DB02 | Admin cannot read other-store product | PASS | observed_rows=0 |
| DB03 | Cashier reads assigned-store product | PASS | observed_rows=1 |
| DB04 | Cashier cannot edit product | PASS | observed_rows=0 |
| DB05 | Cashier cannot promote own role | PASS | sqlstate=42501 |
| DB06 | Server rejects tampered checkout totals | PASS | Submitted sale totals do not match current product prices, discount, or tax |
| DB07 | Rejected checkout leaves no sale and stock unchanged | PASS | stock=10, sale_rows=0 |
| DB08 | Valid checkout deducts stock and creates receipt | PASS | stock=8, receipt_rows=1 |
| DB09 | Repeated sale ID does not deduct twice | PASS | stock=8, sale_rows=1 |
| DB10 | Insufficient stock rejected | PASS | Insufficient base stock for synthetic fixture Product A. Available base units 8, required base units 100 |
| DB11 | Cross-store checkout rejected | PASS | User is not assigned to this store |
| DB12 | Inventory role edits assigned product | PASS | observed_rows=1 |
| DB13 | Inventory role cannot process POS sale | PASS | Only store admins or cashiers can process sales |
| DB14 | Unassigned Super Admin cannot read store product | PASS | observed_rows=0 |
| DB15 | Super Admin cannot process POS sale | PASS | Only store admins or cashiers can process sales |
| DB16 | Enrolled MFA user at AAL1 fails store authorization | PASS | store_access=False |
| DB17 | Enrolled MFA user at AAL1 cannot create store | FAIL | Store created despite missing second factor |
| DB18 | Enrolled MFA user at AAL2 passes assigned-store authorization | PASS | store_access=True |
| DB19 | Anonymous user cannot read product | PASS | sqlstate=42501 |
| DB20 | Anonymous user cannot insert audit event via RPC | FAIL | Unauthenticated audit event accepted |
| DB21 | Historical sale price survives current price change | PASS | snapshot_rows=1 |
| DB22 | Store A Admin cannot delete Store B profile | PASS | deleted_synthetic_rows=0 |

## Confirmed failures

DB17 — High priority: an MFA-enrolled synthetic Admin with AAL1 could create a store through create_store_with_owner. Apply the intended MFA assurance requirement in that privileged function, review parallel functions, and rerun DB16–DB18.

DB20 — Medium priority: the anonymous role could insert an audit event through log_audit_event. Review PUBLIC/anon execution privileges and enforce caller validation so that the audit trail cannot accept unauthenticated events. Retest both direct calls and legitimate nested business operations.

Priorities are technical-review judgments, not CVSS scores. These were confirmed with rollback-only synthetic writes. No production remediation was performed.

## Security Advisor findings

| Advisor check | Findings | Interpretation |
|---|---:|---|
| [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 1 | INFO; review in the context of actual function bodies and access design. |
| [Function Search Path Mutable](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) | 10 | WARN; review in the context of actual function bodies and access design. |
| [Public Can Execute SECURITY DEFINER Function](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) | 18 | WARN; review in the context of actual function bodies and access design. |
| [Signed-In Users Can Execute SECURITY DEFINER Function](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 38 | WARN; review in the context of actual function bodies and access design. |
| [Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 | WARN; review in the context of actual function bodies and access design. |

The 18 anonymous and 38 authenticated public security-definer execution notices are review targets, not a count of confirmed exploitable vulnerabilities. invoice_counters has RLS without policies; direct access is normally denied in the absence of an applicable policy.

## Deployment and scope limitations

The final live MFA helper exists despite its migration not being separately recorded in the retrieved ledger. The live refund function differs from the newer local refund migration concerning refunded_amount; this difference was inspected but not functionally exercised. Do not infer runtime state solely from migration filenames.

Not assessed: full real-account sign-in/MFA enrollment and code verification; exhaustive storage and file-access tests; all authenticated UI workflows; load/concurrency stress; backup restoration; external penetration testing; expert-survey ratings; RQ3 acceptability.

## Evidence and reproduction

Private evidence directory: `outputs/rq2-validation-2026-10-27/`. Key files: `run-checks.mjs`, `local-checks.json`, `controlled-security-checks.sql`, `controlled-security-results-v2.json`, `network-and-client-checks.mjs`, `network-and-client-results.json`, `live-metadata.json`, `function-metadata.json`, `live-initial-0.json`, `live-initial-1.json`, `live-initial-2.json`. No secret values are included in this report.

Run local checks with the recorded Node runtime. The controlled SQL harness creates synthetic fixtures inside a subtransaction and deliberately rolls them back; reproduce it only against an authorized environment. Failed scenarios should be rerun after a reviewed fix and recorded as a new dated assessment, preserving this original baseline.

Primary guidance: [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Advisors](https://supabase.com/docs/guides/observability/advisors).

## Revised thesis

The revised copy is `Chapter 1-4 Manuscript v3 RQ2 Technical Review.docx`. Its methods supplement is on page 36 and the RQ2 findings begin on page 91. Tables 4.6 and 4.7 are on pages 92 and 95. The final Word rendering has 105 pages. The original study data tables and all 35 embedded media assets were preserved; all 40 figure/table page references were verified. The original manuscript was not overwritten by this workflow.
