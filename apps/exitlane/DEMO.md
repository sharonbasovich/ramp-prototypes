# ExitLane — 30-second booth script

Start: `npm start`, open `http://localhost:5315/ramp-prototypes/exitlane/`.

**0:00–0:08 — The problem.**
"The off-site was canceled. The bills weren't." Point at the table: five linked
bookings, a summary card showing **$550 estimated recoverable cash** plus $140 of
future charges avoided — kept on separate lines so nobody mistakes credit for
cash back.

**0:08–0:15 — It's a real engine, not a mock.**
Open the Room details: the policy tiers show an exact UTC cutoff
(12:00 PM Toronto Friday, 24 h before check-in). Click **Past room cutoff** in
the toolbar — the clock jumps, the room's refund collapses to $0 on the exact
boundary, and any prior approval flips **stale** before a provider could be
touched. DST-safe: the engine evaluates the instant, never the wall label.

**0:15–0:22 — Cancel, review, execute.**
Click **Cancel event** → the packet preview lists per-booking estimates and the
exclusions (the decor booking's policy isn't machine-readable → manual review,
never a guessed number). Approve, then **Execute packet** — scripted sandbox
providers confirm three bookings; StageRight fails with a simulated 503, its
booking stays active, and Retry succeeds with the attempt history intact.

**0:22–0:30 — Honesty.**
Point at the header badge (`SQLite backend sandbox`) and the confirmations
card: nothing claims "sent" before execution, confirmed ≠ received, and the
export packet is labeled SIMULATED. Close on the Refund-received button —
receipt is recorded exactly once.
