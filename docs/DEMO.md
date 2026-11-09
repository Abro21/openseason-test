# Demo script

Start the stack as in the [README](../README.md) (`pnpm db:reset`, `pnpm dev:gateway`, `pnpm dev:web`) and open http://localhost:5173. Every person below is synthetic. Sign out between parts.

Run `pnpm db:reset` first if you want a clean seed; the gateway's workers process queued sends every two seconds.

## 1. Parent in two clubs: Pat Parent

1. Sign in as **Pat Parent**. The Role switcher shows Parent; the Child switcher lists Leo and Mia at Front Range FC and Nora at Mesa Valley SC.
2. On Home, the schedule shows the chosen child's events. Set Mia's RSVP for the next practice.
3. Under Forms, sign the current waiver by typing the name. Older versions cannot be signed.
4. Under Payments, press **Pay** on an open fee. The sandbox checkout page opens and says no card is collected. Complete it; the fee shows as paid after the signed sandbox webhook lands.
5. Switch the Child to Nora. Payments and Forms now show only Mesa Valley's dues and waiver; nothing from Front Range is shown, and the reverse holds too.

## 2. Coach: Casey Coach

1. Sign in as **Casey Coach** (head coach, U12 Blue, Staff plan).
2. Schedule: the RSVP summary, attendance (present, late, absent, excused) and scoring with a version check.
3. Staff check for work on their own. Under the next game, an **RSVP reminder** draft appears; under the next practice, a **practice plan**. "Waiting on you" at the top lists every draft.
4. Press **Review** on the RSVP reminder: recipients can be removed but not added. Approve it. The approval carries the exact revision and hash, and the worker sends once to each family that has not replied, as sandbox deliveries.
5. Open the team conversation in Messages: the week-ahead announcement draft sits there, ready to review.
6. In any draft, open **Talk to** and post a message. The reply is a fixed sandbox response and says so: no AI provider is configured.

## 3. Director: Dana Director

1. Sign in as **Dana Director** (club owner, Front Range FC). Role: Club Director.
2. Home: finance summary and compliance at a glance, then "Waiting on you". The compliance screen states that it does not certify anything.
3. Payments shows the overdue-fee reminder draft above the balances; Compliance shows certification nudges above the certifications.
4. On Home, tick several drafts and approve them together. Each item reports its own result, so a stale item fails without blocking the rest.
5. Note that Dana cannot read safeguarding issue reports: only **Sam Safeguard** holds that grant.

## 4. Several roles: Jordan Multi and Olivia Other

1. Sign in as **Jordan Multi** (head coach U15 Red, guardian of Ava on U12 Blue, free tools only). The Role switcher offers Coach and Parent. Each switch clears the cached data.
2. As Coach, Home explains the Staff plan once. Every tool (schedule, attendance, scoring, messages) works the same without it, and no staff drafts appear.
3. Sign in as **Olivia Other**: Club Director and Coach at Mesa Valley SC. Nothing from Front Range FC shows.

## 5. Staff approval edge cases (any coach with a plan)

- Edit a prepared message in a second tab after opening it in the first, then approve from the first: it is refused with "This changed since you opened it".
- Change the team schedule after preparing a reminder: the work shows as needing refresh until you refresh it.
- Reject an action: nothing is sent. Retry creates a new revision that needs its own approval.

## Also worth showing

- **Leo Lopez** (teen) sees their own schedule and can RSVP. The refusal of private adult–minor conversations is enforced in the database and tested, but there is no screen yet for starting a DM.
- **Gail Fan** sees Mia's schedule and results only: no locations, RSVPs or roster.
- **Quinn Newcomer** has no roles and lands on "Join with an invitation".
