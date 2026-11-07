# Decisions needed

Where a decision was missing, the implementation denies sensitive access by default and keeps going. Each item says what the code does today.

1. **Teen anonymity.** Can 13–17 year olds submit anonymous surveys or issue reports? Today: no, teens submit named only.
2. **Captain election voters.** Who votes: athletes only, guardians, or both, and with what age limits? Today: active rostered athletes vote; guardians cannot vote on their behalf.
3. **Assistant coach scope.** Which of roster edits, messaging, scoring and feedback summaries do assistant coaches get? Today: view roster, attendance and practice planning only; no team-wide messaging, scoring or feedback summaries.
4. **Processing fee treatment.** Does the payer or the club pay card processing fees, at what rate, and how is it shown? Today: the module supports both (`packages/domain/src/money.ts`) but no rate is configured and checkout shows no fee.
5. **Staff plan pricing.** Price, trial and per-seat rules for the Staff plan. Today: the plan exists as an entitlement with no price; no purchase flow exists.
6. **Safeguarding ownership.** Who in a club holds the safeguarding grant that can read issue reports and resolve anonymous identity? Today: only an explicit `review_safeguarding` grant; owners do not get it automatically.
7. **Retention and season close.** How long are messages, survey responses, issue reports, consent evidence and audit events kept, and what does closing a season archive? Today: nothing is deleted automatically; no archive tooling.
8. **Verifiable parental consent provider.** Which provider and method satisfy under-13 consent? Today: a sandbox provider callback records `provider_verified`.
9. **Sport.** Synthetic seed data mixes soccer club names with basketball drills (from the DOBO role). Which sport(s) does the MVP target?
10. **Imports, scholarships, emergency and medical fields.** Not modelled. Medical data in particular needs a decision before any field exists.
