# The Thankfulness Tree

A cozy Thanksgiving web interactive. Visitors hold their palm up to the webcam, and MediaPipe hand tracking turns the hand's outline into their leaf shape. They finish the sentence "I am thankful for ___", [Pangram](https://www.pangram.com) scores how human it sounds (which sets the leaf's color, from withered brown to bright red), and the leaf flies onto a shared tree. Hover or tap any leaf to read it and see its score.

## Run it

```bash
cp .env.example .env   # put your Pangram key in PANGRAM_API_KEY
npm start              # http://localhost:3000
```

No dependencies beyond Node 22+. The camera needs HTTPS (or localhost). Hand tracking runs entirely in the browser, and no video leaves the device; only the 21 hand points that make the leaf shape are sent to the server.

The Pangram key stays on the server. Leaves are saved to `data/leaves.json`, and the tree holds the 17 newest.

## Removing leaves

Whoever hangs a leaf can remove it from the same browser (hover it and press ×). To moderate every leaf, set `ADMIN_TOKEN` and open the site once with `?admin=<token>`.
