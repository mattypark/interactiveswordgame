# Getting it online

The frontend is a static Vite build — it goes anywhere. Live versus needs a
Convex deployment alongside it, because Vercel's serverless functions can't
hold a WebSocket open and matchmaking needs one.

Fight and Sandbox work with no backend at all. If you only want to test those,
skip straight to step 2.

---

## 1. Convex (only needed for live versus)

Run once, from the project root:

```bash
npx convex dev
```

The first run signs you in, creates a deployment, and writes
`VITE_CONVEX_URL` into `.env.local` for you. Leave it running while you develop
— it pushes `convex/` up as you edit it.

To check it worked: reload the app, open **Versus**, and the "Find a match"
button should be enabled rather than showing the setup warning.

When you're ready to ship:

```bash
npx convex deploy
```

That gives you a production deployment URL. Put it in Vercel as
`VITE_CONVEX_URL` (see below).

---

## 2. Vercel

```bash
npx vercel          # first time: link the project
npx vercel --prod
```

`vercel.json` already sets the build command, the output directory, and a
one-year immutable cache on `/wasm` and `/models` — the hand model is 7.8MB and
should be fetched exactly once per visitor.

If you want live versus in production, add the environment variable in the
Vercel dashboard (Settings → Environment Variables):

| Name | Value |
|------|-------|
| `VITE_CONVEX_URL` | the URL `npx convex deploy` printed |

It's a build-time variable, so redeploy after adding it.

---

## Testing a live match

You need two cameras, which in practice means two devices or two people.

1. Both open the deployed URL and go to **Versus**.
2. Both pick the **same arena** — the queue is per-arena.
3. Both press **Find a match**. Whoever queues first waits; the second one
   pairs immediately and both drop into the fight.

A match ends when someone takes two rounds, or when either player leaves.

---

## Things worth knowing

**HTTPS is not optional.** `getUserMedia` only exists in a secure context.
Vercel gives you HTTPS automatically; `localhost` also counts, which is why dev
works without it. Opening the built `index.html` off the filesystem will not.

**Each client scores its own punches.** It reports a running total and the
other side applies the difference, so a dropped update costs nothing and a
duplicate repeats nothing. It does trust the other client — for a game you play
with friends that's the right trade, since server-side hit resolution would
need both players' full hand skeletons at 60Hz.

**State goes up 12 times a second**, not every frame. At 60Hz this would be
3,600 writes a minute per player, for motion the other end smooths out anyway.

**There's no shared clock.** The round timer sits at full during a live match
rather than showing two players two different numbers. Rounds end on a
knockout, not on time.
