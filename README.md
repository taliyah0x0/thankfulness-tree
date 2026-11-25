# The Thankfulness Tree

A cozy Thanksgiving web interactive. Visitors hold their palm up to the webcam, and MediaPipe hand tracking turns the hand's outline into their leaf shape. They finish the sentence "I am thankful for ___", [Pangram](https://www.pangram.com) scores how genuine (human-written) it sounds (which sets the leaf's color, from withered brown to bright red), and the leaf flies onto a shared tree. Hover or tap any leaf to read it and see its score.

## Run it

```bash
cp .env.example .env   # put your Pangram key in PANGRAM_API_KEY
npm start              # http://localhost:3000
```

No dependencies beyond Node 22+. The camera needs HTTPS (or localhost). Hand tracking runs entirely in the browser, and no video leaves the device; only the 21 hand points that make the leaf shape are sent to the server.

The Pangram key stays on the server. Leaves are saved to `data/leaves.json`. The tree holds 17 leaves; when a new one arrives, the oldest falls into a pile on the ground (the newest 30 fallen leaves are kept).

Stuck? **Give me an idea** types a random finish for the sentence into the box, mixed from a hand-written list of people and cozy moments.

## Playing with the tree

- Drag any leaf on the tree with the mouse (or a finger) to move it; the new spot is saved for everyone.
- Wiggle the cursor quickly across the tree to shake it; hovering a leaf rustles it.
- **Play with the tree** uses the webcam: wave to shake, pinch a leaf to pick it up, open your fingers to place it.
- Day, Sunset, and Night skies, plus synthesized sounds (a note per leaf color as a new leaf lands, rustles, pick-up and put-down sounds). Sound starts on the first click and can be muted.

## Removing leaves

Whoever hangs a leaf can remove it from the same browser (hover it and press ×). To moderate every leaf, set `ADMIN_TOKEN` and open the site once with `?admin=<token>`.
