# Terms you need when the camera is the controller

Everything here shows up in this codebase. Each section says what the word
means, why it matters, and where it lives in `src/`.

---

## 1. Getting pixels

**getUserMedia** — the browser API that hands you a camera stream. It asks the
user for permission; you cannot skip that or pre-grant it. `src/hands/camera.ts`

**Secure context** — `getUserMedia` only exists on HTTPS or `localhost`. Open
the same file over `file://` or a plain-HTTP LAN address and the API is simply
missing, which looks like a bug and isn't. This is why the dev server works but
"just open the HTML" doesn't.

**Constraints** — what you *ask* the camera for (`1280x720`, front-facing). The
browser gives you the closest it can, which may not be what you asked. Always
read `video.videoWidth` back rather than trusting your request.

**facingMode: 'user'** — the front camera. Note it does **not** mirror the
stream. Mirroring is something you do yourself.

**Capture rate vs render rate** — the camera runs at ~30fps, your render loop at
60. Running detection every render frame would do the same work twice. Check
whether `video.currentTime` actually moved before spending a detection on it.
`src/hands/vision.ts`

---

## 2. Getting a hand out of the pixels

**Landmark** — one tracked point on the hand. MediaPipe gives 21 of them:
wrist, then four joints per finger. They are always in the same order, so
"landmark 8" always means the index fingertip. `src/hands/connections.ts`

**Topology / connections** — which landmarks are joined by a bone. 21 pairs.
This is what turns a cloud of dots into a hand you can see.

**Normalised coordinates** — landmark x and y come back as 0..1 across the
frame, not pixels. Resolution-independent, which is good, but it means you
multiply by frame size before you can measure anything in pixels.

**World landmarks** — the same 21 points in **metres**, origin at the hand's
geometric centre. This is the underrated one: it gives you real-world scale for
free, and it's what makes single-camera depth possible at all. `solveDepth`

**Handedness** — the model's guess at left vs right, with a confidence. Note it
describes the hand *in the raw image*, so mirroring your display flips what it
means to the viewer.

**Running mode** — `IMAGE` treats every frame as unrelated; `VIDEO` lets the
model track a hand it already found, which is faster and much steadier. Video
mode needs strictly increasing timestamps, so never pass the same one twice.

**Delegate** — `GPU` or `CPU`. GPU is dramatically faster; CPU is the fallback
on machines where WebGL is unavailable.

**WASM / fileset** — the model runs as compiled WebAssembly the browser fetches
separately from your JavaScript. Here both the WASM and the 7.8MB `.task` model
are vendored into `public/`, so there's no CDN call and it works offline.

**Detection vs tracking confidence** — the first is how sure it must be to
*find* a hand, the second how sure to *keep* one it already has. Lower tracking
confidence means fewer dropouts but more garbage frames.

**Dropout** — the model losing the hand for a frame or two. Extremely common.
If you react instantly the hand strobes, so you "coast" on the last good pose
for ~180ms before giving up. `HOLD_MS` in `src/hands/hands.ts`

---

## 3. Turning a 2D hand into a 3D position

**Pinhole camera model** — the standard simplification: light passes through
one point, so a thing of real size `L` at distance `Z` projects to `f·L/Z`
pixels. Every equation below is that one rearranged.

**Focal length in pixels** — not a lens spec, a number relating angles to
pixels: `f = 0.5·height / tan(fov/2)`. The unit is pixels because that's what
you're measuring in.

**Field of view (FOV)** — how wide an angle the camera sees. Browsers don't
expose it, so you assume (~60° vertical for a laptop webcam). If depth reads
consistently too near or too far, this is the number to tune.
`DEFAULT_FOV_Y` in `src/hands/project.ts`

**Projection / unprojection** — 3D to 2D, and back. Unprojection needs a depth,
because a pixel on its own is a whole ray of possible points.

**Monocular depth ambiguity** — the core problem. One camera can't tell a small
near thing from a big far one. A big hand at arm's length and a child's hand up
close look identical.

**Scale from known size** — the way out. If you know the real size of something
in view, its apparent size gives you distance. Here the known size comes from
world landmarks: measure the wrist-to-knuckle bone in metres *and* in pixels,
and `z = f·metres/pixels`. That bone is chosen because it spans the palm and
its length doesn't change when you close your fist — a fingertip-based
measurement would read "closer" every time you made a fist.

**Stereo depth** — two cameras, triangulating. What the original demo used.
More accurate, needs hardware you probably don't have.

**Play volume** — the box in the scene your hand maps onto. Depth from a single
camera has a usable band (here 24–86cm); outside it, tracking degrades. Making
this box visible turns "the hand stopped responding" into "I've reached the
edge". `src/scene/volume.ts`

**Mirroring / selfie view** — flipping horizontally so moving right moves right
on screen. Which way is correct depends on your camera and how you read the
scene, and getting it backwards is instantly infuriating — so make it a toggle,
not a constant. Press **M**.

---

## 4. Making a noisy signal usable

**Jitter** — the tracked position wobbling while your hand is still. Always
present. Model output is a per-frame estimate, not a measurement.

**Latency / lag** — the delay between moving and the screen responding.

**The smoothing trade-off** — the central tension. Any filter that removes
jitter also adds lag, and both are immediately visible. Tuning for a still hand
makes a moving one feel like syrup; tuning for a moving hand makes a still one
buzz.

**Exponential moving average (EMA)** — the obvious filter: blend a bit of the
new value into the old. One knob, and that knob *is* the trade-off above.

**One Euro filter** — the better answer. It measures how fast the value is
changing and adapts: heavy smoothing when slow, almost none when fast. Two
knobs — `minCutoff` (how still a still hand looks) and `beta` (how much speed
buys back). `src/hands/filter.ts`

> **`beta` is scaled by measured speed, so its size depends on your units.**
> These positions are in metres, where a fast hand moves 2–4 m/s, so `beta`
> needs to be order-1. Setting it to 0.02 — as this repo did at first — leaves
> the cutoff pinned at `minCutoff` and gives you a plain low-pass wearing a
> One Euro costume. A punch aimed at 43cm was landing at 18cm.

**Hysteresis / Schmitt trigger** — using two thresholds instead of one. Grab
above 0.6, release below 0.4. With a single threshold, a grip resting near it
flickers on and off many times a second and the block falls out of your hand.
`GRAB_ON` / `GRAB_OFF` in `src/interact/grab.ts`

**Debouncing** — requiring a state to hold for N frames before believing it.
Same goal as hysteresis, applied to discrete states rather than a continuous
value.

**Cooldown / refractory period** — after an event fires, ignore repeats for a
while. Without one, a single punch registers every frame the hand is inside the
target. `STRIKE_COOLDOWN_MS` in `src/interact/impact.ts`

**Velocity window** — measuring speed over ~90ms rather than between the last
two frames. Two-frame differences are mostly noise, and they sample the exact
instant your fingers open — which is when the hand is already slowing down, so
throws come out limp. `src/hands/velocity.ts`

**Median vs mean** — when a frame goes wrong it goes *very* wrong. A mean over
20 samples is wrecked by one outlier; a median shrugs it off. Used in
calibration. `src/hands/grip.ts`

**Calibration** — measuring one user's actual range and mapping it onto 0–100%.
Hands differ enough that a fixed threshold works for some people and not
others. Two poses: rest, then squeeze.

**Dead zone** — deliberately ignoring small inputs near neutral, so noise around
zero doesn't produce drift.

---

## 5. Interaction

**Degrees of freedom (DOF)** — how many independent ways a thing can move.
Position is 3, rotation is 3, so a carried object is 6-DOF. Tool modes here are
just a choice of which subset applies. `src/interact/hold.ts`

**Quaternion** — how rotation gets stored. Four numbers, no gimbal lock, and
they compose by multiplication. You rarely read one; you multiply and invert.

**Orthonormal basis** — three perpendicular unit vectors defining an
orientation. The hand's is built from the direction up the fingers and the
direction across the knuckles, with the palm normal as their cross product.
Degenerate when the palm is edge-on, so keep the previous frame's answer rather
than snapping to identity.

**AABB (axis-aligned bounding box)** — a box that doesn't rotate. Cheap to test
against and good enough for "is my palm inside that". Rotate the object and the
box loosens, which is the price you pay.

**Grab margin** — growing the box slightly before testing, because fingers close
*around* an object and the palm centre sits a little outside it at the moment a
grab should take.

**Kinematic vs dynamic** — kinematic objects are moved by you and ignore
physics; dynamic objects are moved by forces. A held block is kinematic; the
instant you let go it becomes dynamic. Getting the handover right is most of
what makes throwing feel real.

**Restitution** — how much speed survives a bounce. 1 is a superball, 0 is a
beanbag.

**Frame-rate independence** — the same input must produce the same result at
30fps and 144fps. Multiply accelerations by `dt`; for drag use `pow(keep, dt)`,
not `keep * dt`. Also clamp `dt` — a backgrounded tab hands you a five-second
frame and teleports everything across the room.

**Under-damped spring** — a spring that overshoots before settling. Used for the
dummy's recoil. Critically damped returns without overshoot and looks dead; the
overshoot is what sells the impact. `Wobble` in `src/interact/impact.ts`

**Occlusion** — one thing hiding another. Your fingers hide each other
constantly, and the model guesses at what it can't see. Poses that hide the
palm are the least reliable ones.

---

## 6. What the original demo used that this doesn't

**EMG (electromyography)** — reading electrical activity in muscle to measure
grip force directly. An armband. That build had one; this one derives grip from
finger curl instead, which is why the readout says `grip` and not `EMG`.

**Sensor fusion** — combining several sensors (two cameras plus EMG) into one
estimate. More accurate, more hardware, more to go wrong.

---

## 7. The short version

If you only remember five:

1. **World landmarks give you metres**, and metres are what make single-camera
   depth possible.
2. **Smoothing always costs latency.** One Euro lets you pay that cost only
   when the hand is still — but only if `beta` matches your units.
3. **Use two thresholds, never one.** Every on/off decision on a noisy signal
   needs hysteresis or it will chatter.
4. **Calibrate.** Hands vary more than you'd guess.
5. **Show the user the boundary.** An invisible limit is indistinguishable from
   a crash.
