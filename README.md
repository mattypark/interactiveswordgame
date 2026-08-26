# ONE TWO

A fighting game you play with your hands. Your webcam is the controller: it tracks
your hands into a 3D scene, and you throw straight punches at your opponent's head
while trying not to eat one yourself. Live, against another person, eventually.

Repo is still called `interactiveswordgame` — it started as a sword and became a
fist fight.

Built after a demo seen at a YC hackathon. That build used **two** cameras for stereo depth and
a real **EMG armband** for grip force. This one does it with a single laptop webcam and no extra
hardware:

- **Depth from one camera** — MediaPipe's `worldLandmarks` are metric, so the apparent pixel size
  of a known hand bone solves absolute distance through a pinhole model.
- **Grip from vision** — finger curl drives the force bar, calibrated to *your* hand's open and
  closed range. Labelled `grip` / `vision linked`, not `EMG`, because there is no armband.

New to this kind of thing? **[docs/CONCEPTS.md](docs/CONCEPTS.md)** is a
glossary of the vocabulary — landmarks, pinhole depth, One Euro, hysteresis,
cooldowns — each tied to where it lives in this codebase.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

Allow camera access when the browser asks. `localhost` counts as a secure context, so
`getUserMedia` works in dev without HTTPS; a deployed build needs HTTPS.

```bash
npm run build    # typecheck + production bundle
npm test         # unit tests over the projection / grip / grab math (no camera needed)
```

## Live versus

Pick a name and an arena, press **Find a match**, and the fight starts the
moment someone else queues for the same arena. Two people, two cameras.

It needs a Convex deployment — Vercel can't hold a WebSocket open, and
matchmaking needs one. Fight and Sandbox work with no backend at all, and the
Versus screen says so plainly rather than failing when it isn't set up.

**[docs/DEPLOY.md](docs/DEPLOY.md)** has the whole thing: `npx convex dev`
once, `npx vercel --prod` to ship, and how to test a real match.

## Stack

Vanilla TypeScript, Vite, Three.js, MediaPipe Tasks-Vision. No framework — this is one canvas
and a DOM overlay, and a 60fps tracking loop is happier without a render tree in the way.

The MediaPipe WASM and the 7.8MB hand model are served from `public/`, so there is no CDN call
at runtime and the app works offline after first load.

## Stages

| # | Stage | State |
|---|-------|-------|
| 1 | Scaffold, grid scene, orbit camera, full HUD chrome | done |
| 2 | Webcam + MediaPipe tracking, live status readouts | done |
| 3 | 3D hand skeleton in world space | done |
| 4 | Grab: grip meter, calibration, pick up and move a block | done |
| 5 | Toolbar wiring: modes, primitives, undo/redo | |
| 6 | Throwing, the visible play box, depth readout, mirror toggle | done |
| 7 | Test dummy to hit | done |
| 8 | Depth direction, spawn point, hand colours | done |
| 9 | NPC, camera modes | done |
| 10 | Guided setup, solid hands | done |
| 11 | Welcome screen, map select, mode shell | done |
| 12 | Head tracking — your head is a target | |
| 13 | A fighter that moves and hits back | done |
| 14 | Live versus over Convex | done |

## Setup keys

Four things depend on your camera and how you read the scene, and all four are
instantly annoying if they're the wrong way round. So they're live toggles
rather than constants, and the HUD shows the current state of each.

| Key | What it does |
|-----|--------------|
| **M** | Flip left/right, if moving right sends the hand left. |
| **D** | Flip the depth axis. `push` (default) means moving your hand toward the camera pushes the object away into the scene; `literal` means toward the camera brings it toward you. |
| **H** | Swap which hand is blue and which is red, if the labels come out backwards. |
| **R** | Set a spawn point — see below. |
| **V** | First person vs third person. |

### Spawn point (R)

**It centres itself on the first hand it sees**, so wherever you happen to be
sitting becomes the middle of the box. Without that, the middle is the middle
of the camera frame at mid depth — which assumes you sit square to the lens at
exactly the right distance, and anyone closer than that starts pinned to the
far wall.

To re-centre later, hold your hand wherever it's comfortable and press **R**.
Press **R** with no hand in frame to go back to the raw mapping.

The depth band is 30–62cm: the range a forearm actually sweeps, not the full
range the tracker can resolve.

Your left hand draws blue, your right red.

## Reading depth

The wireframe box is the region your hand can actually reach; the ring on the
floor is where your hand is over it, and the line connects the two. Depth on a
flat screen is hard to judge, and a shadow on the ground is how you judge it.

The `depth: 42cm` readout is your real distance from the camera. Come closer
than 24cm or go further than 86cm and it says `out of range` and the marker
turns red — that's the edge where tracking gives out, so you can see it coming
instead of having the hand just stop responding.

Near the lens brings the block right up to the viewer; arm's length pushes it
deep into the scene. Perspective does the rest, so it grows and shrinks.

## Views (V)

**Third person** watches the box from outside; drag to orbit.
**First person** puts you where you're standing — your hand is right in front
of your face at arm's length, and the dummy and the NPC loom at real scale.
Orbit is off in first person, since orbiting would walk the camera off your own
head.

## Fighting

Straight punches only. A punch counts when your fist is moving fast **and**
travelling along the line to their head — a hook that happens to pass through
does nothing. That alignment requirement is what makes the game about aim
rather than about flailing at the camera.

Damage scales with speed and with how square you landed it. Their guard cuts
it to a third.

The opponent closes distance, backs off when you crowd it, and telegraphs
every punch with a visible wind-up — an opponent you can't read isn't
difficult, just unfair. It guards when it reads your wind-up, and how often it
manages that is the difficulty knob. Step back during its strike and it whiffs.

Two rounds wins the match. Ninety seconds a round; whoever's ahead on health
takes it if the clock runs out.

## The dummy and the NPC

Two things to hit, and they're different problems.

The **dummy** stands still. A pell-style training post at the back of the play volume. Punch it and
it rocks back and settles; the HUD counts hits and shows the speed of the last
one. Thrown blocks count too.

A strike needs speed — 1.2 m/s for a hand, less for a thrown block — so resting
your hand against it does nothing. There's a 260ms cooldown per target, because
without one a single swing registers sixty times a second. Hands carrying a
block don't strike, so you can move things past it.

The rocking is an under-damped spring rather than a critically damped one. The
overshoot on the way back is the part that reads as "that landed".

The **NPC** doesn't. It paces its beat, stops and turns to watch you when you
get close, and staggers backward when hit before getting on with it. Connecting
with something that moves is a different skill from connecting with something
that doesn't, which is the point of having both.

## Throwing

Release while your hand is moving and the block goes with it. Velocity is
measured over the last ~90ms rather than the last two frames — a two-frame
difference catches the exact moment your fingers open, which is when the hand
is already slowing, and throws come out limp. Blocks fly, bounce and settle;
the **Physics** button turns that off if you'd rather they hang where dropped.

## Setting up

**It walks you through it the first time it sees your hand.** Two steps:

1. Hold your hand open where it feels comfortable and keep still.
2. Make a fist and hold.

That measures both things it needs: how high and how far away you actually sit,
and how far your fingers travel between open and closed. Press **C** to run it
again, **Esc** to skip.

Every capture waits for your hand to be *still* first — but "still" is judged by
how far your hand has actually wandered over the last three-quarters of a
second, not by counting frames under a speed threshold. Tracking jitter throws
speed spikes constantly, and a consecutive-frame counter is reset by any one of
them, so it could sit there forever without telling you why. The spread is also
measured between the 15th and 85th percentiles, so an occasional wild frame
from the tracker doesn't count as you moving.

The bar goes amber when you're wobbling, eases back rather than snapping to
zero, and after seven seconds it just takes what it has — being roughly
calibrated beats being stuck. **Capture now** commits immediately.

It also shows the live reach reading under the bar. Open should read high,
around 1.8; a fist should read near 1.0. If it isn't moving between the two,
that's the thing to look at.

It refuses to store a hand that wasn't actually open, because that's the one
mistake there's no way back from: a low "open" reading makes the squeeze step
impossible to pass, and the old version would ask for a tighter fist forever.
Two failed squeezes send you back to redo the open pose. With both hands up it
reads whichever one is actually posed, rather than whichever the model listed
first.

Recentring covers height and distance only, never left/right — the middle of
the camera frame stays the middle of the box, because shifting that sideways
makes the middle of your view read as off to one side.

Squeeze past 60% to grab, relax below 40% to let go — the gap is deliberate,
so a grip hovering near the threshold doesn't drop what you're carrying.
