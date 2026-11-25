# The Thankfulness Tree

Live: https://thankfulness-tree.vercel.app/

A cozy Thanksgiving web interactive. Visitors hold their palm up to the webcam, and MediaPipe hand tracking turns the hand's outline into their leaf shape. They finish the sentence "I am thankful for ___", [Pangram](https://www.pangram.com) scores how genuine (human-written) it sounds (which sets the leaf's color, from withered brown to bright red), and the leaf flies onto the tree. Hover or tap any leaf to read it and see its score.

## Design

The look of the tree was designed in [Paper](https://paper.design). See the design file: [https://app.paper.design/file/01M885NE3CY1H9W5EM1WBNZT93](https://app.paper.design/file/01M885NE3CY1H9W5EM1WBNZT93/p-2-0)

## Run it

```bash
cp .env.example .env   # put your Pangram key in PANGRAM_API_KEY
npm start              # http://localhost:3000
```

No dependencies beyond Node 22+. The camera needs HTTPS (or localhost). Hand tracking runs entirely in the browser, and no video leaves the device; only the 21 hand points that make the leaf shape are sent to the server.

The Pangram key stays on the server, which only scores sentences. Leaves are never saved: each visitor's tree lives in their browser tab and starts empty again on reload. The tree holds 17 leaves; when a new one arrives, the oldest falls into a pile on the ground (the newest 30 fallen leaves are kept).

Stuck? **Give me an idea** types a random finish for the sentence into the box from a curated list of 15 answers, skipping any that are already on the tree.

## Rooms

**Make a room** creates a 5-character code, and friends join by typing it in or opening the invite link (`/?room=CODE`). Everyone in a room shares one tree in real time: new leaves, where leaves sit, live drags, deletions, tree shakes, and each person's webcam hand (their fingertips and pinch cursor show up on everyone's tree in their own color). If you make a room, your current leaves come with you. If you join one, you start from the room's tree.

Peers connect directly over WebRTC using [Trystero](https://github.com/dmotz/trystero), which uses public Nostr relays only to help them find each other. No server or account is needed, so it works on Vercel as-is. As with solo play, nothing is saved: a room's tree lasts as long as someone has it open. Webcam video never leaves your browser; only hand points are shared.

## Deploy to Vercel

The site deploys as static files from `public/` plus one Vercel function (`api/index.js`) that handles Pangram scoring. Add `PANGRAM_API_KEY` under **Settings → Environment Variables** and deploy; nothing else is needed.

## Playing with the tree

- Drag any leaf on the tree with the mouse (or a finger) to move it.
- Wiggle the cursor quickly across the tree to shake it; hovering a leaf rustles it.
- **Play with the tree** uses the webcam: wave to shake, pinch a leaf to pick it up, open your fingers to place it.
- Day, Sunset, and Night skies, plus synthesized sounds (a note per leaf color as a new leaf lands, rustles, pick-up and put-down sounds). Sound starts on the first click and can be muted.

## Removing leaves

Hover any leaf and press × to remove it.
