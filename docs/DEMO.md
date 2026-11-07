# Demo script

Start the stack as in the [README](../README.md) (`pnpm db:reset`, `pnpm dev:gateway`, `pnpm dev:web`) and open http://localhost:5173. Every person below is synthetic. Sign out between parts.

Run `pnpm db:reset` first if you want a clean seed; the gateway's workers process queued sends every two seconds.

## 1. Parent: Pat Parent

1. Sign in as **Pat Parent**. "Acting as" lists Family for Mia (U12 Blue) and Leo (U15 Red).
2. On Home, the schedule shows both children's events. Set Mia's RSVP for the next practice.
3. Under Forms, sign the current waiver by typing the name. Older versions cannot be signed.
4. Under Fees, press **Pay** on an open fee. The sandbox checkout page opens and says no card is collected. Complete it; the fee shows as paid after the signed sandbox webhook lands.
5. Point out what Pat cannot see: other families' RSVPs and fees, and anything from Mesa Valley SC.

## 2. Coach: Casey Coach

1. Sign in as **Casey Coach** (head coach, U12 Blue, Staff plan).
2. Home: the RSVP summary, attendance (present, late, absent, excused) and scoring with a version check.
3. Open **Staff Room**. Prepare a **Practice plan**. The Practice Prep Coach drafts a plan; open it, edit it and save it through the normal planner.
4. Prepare an **RSVP reminder for next game**. Open the draft: recipients can be removed but not added. Propose it.
5. Approve it. The approval carries the exact revision and hash. The worker sends once to each family that has not replied, as sandbox deliveries.
6. Open the staff thread and post a message. The reply is a fixed sandbox response and says so: no AI provider is configured.

## 3. Director: Dana Director

1. Sign in as **Dana Director** (club owner, Front Range FC).
2. Home: finance summary across teams and the compliance view with certification gaps. The screen states that it does not certify anything.
3. **Staff Room**: press **Have staff check for work**, or prepare **Overdue fee reminders** and **Certification nudges** directly.
4. Select several items and approve them as a batch. Each item reports its own result, so a stale item fails without blocking the rest.
5. Note that Dana cannot read safeguarding issue reports: only **Sam Safeguard** holds that grant.

## 4. Context switching: Jordan Multi

1. Sign in as **Jordan Multi** (head coach U15 Red, guardian of Ava on U12 Blue, free tools only).
2. Switch "Acting as" between Coach: U15 Red and Family: Ava. Each switch clears the cached data, and the Staff Room tab only appears in the coach context.
3. In the coach context, the Staff Room shows the no-plan state. Every DIY tool (schedule, attendance, scoring, messages) still works.

## 5. Staff approval edge cases (any coach with a plan)

- Edit a prepared message in a second tab after opening it in the first, then approve from the first: it is refused with "This changed since you opened it".
- Change the team schedule after preparing a reminder: the work shows as needing refresh until you refresh it.
- Reject an action: nothing is sent. Retry creates a new revision that needs its own approval.

## Also worth showing

- **Leo Lopez** (teen) sees their own schedule and can RSVP. The refusal of private adult–minor conversations is enforced in the database and tested, but there is no screen yet for starting a DM.
- **Gail Fan** sees Mia's schedule and results only: no locations, RSVPs or roster.
- **Quinn Newcomer** has no roles and lands on "Join with an invitation".
