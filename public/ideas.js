const IDEAS = [
  "the people who make ordinary days feel like home",
  "second chances, and the people who gave them to me",
  "a body that carries me through every day, even the hard ones",
  "friends who check in when I've gone quiet",
  "my morning coffee and the ten quiet minutes that come with it",
  "a warm bed on a cold night",
  "clean water, a full fridge, and a roof that doesn't leak",
  "songs that show up at exactly the right moment",
  "the hard seasons, because they showed me what I can get through",
  "the lessons I didn't want but needed",
  "how far I've come, even when it doesn't feel like much",
  "stretchy pants, especially this week",
  "whoever invented the nap",
  "leftovers, the best part of any holiday",
  "the mute button on group chats",
];

const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
let last = "";

export const randomIdea = (taken = []) => {
  const used = new Set(taken.map(normalize));
  const fresh = IDEAS.filter((idea) => !used.has(normalize(idea)) && idea !== last);
  const pool = fresh.length ? fresh : IDEAS.filter((idea) => idea !== last);
  last = pool[Math.floor(Math.random() * pool.length)];
  return last;
};
