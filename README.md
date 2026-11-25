# The Thankfulness Tree

A cozy Thanksgiving web interactive. Visitors finish the sentence "I am thankful for ___", [Pangram](https://www.pangram.com) scores how human the sentence sounds, and the words land on a fall leaf that flies onto a shared tree. Hover or tap any leaf to read it.

## Run it

```bash
cp .env.example .env   # then put your Pangram key in PANGRAM_API_KEY
npm start              # http://localhost:3000
```

No dependencies beyond Node 22+. The Pangram key stays on the server; the browser only talks to `/api/score` and `/api/leaves`. Leaves are saved to `data/leaves.json` (the newest 80 are kept).
