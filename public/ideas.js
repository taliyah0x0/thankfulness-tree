const PEOPLE = [
  "my grandma", "my little brother", "my big sister", "my best friend", "my roommate", "my mom", "my dad",
  "my dog", "my cat", "my neighbor", "my cousins", "my coworkers", "my partner", "my old teacher",
];

const DEEDS = [
  "who always saves me the last slice of pie",
  "who texts me just to check in",
  "who laughs at my terrible jokes",
  "who still calls me by my childhood nickname",
  "who taught me how to make gravy from scratch",
  "who sits next to me when the house gets loud",
  "who never lets me leave without leftovers",
  "who shows up with soup when I'm sick",
  "who remembers every story I tell",
  "who drags me outside on sunny days",
  "who sends me terrible memes at midnight",
  "who makes every holiday feel like home",
];

const MOMENTS = [
  "the first cold morning that calls for a big sweater",
  "warm socks straight out of the dryer",
  "the smell of cinnamon drifting out of the kitchen",
  "crunchy leaves on the walk home",
  "leftover turkey sandwiches at midnight",
  "a long nap after a big dinner",
  "the board game fight we have every single year",
  "my favorite mug and a quiet morning",
  "the group chat that never stops buzzing",
  "the window seat on a rainy afternoon",
  "second helpings of mashed potatoes",
  "porch lights left on for late arrivals",
  "the playlist my family argues about every car ride",
  "pumpkin bread that never lasts more than a day",
  "a good book and a blanket that's way too big",
];

let last = "";

export const randomIdea = () => {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  let idea = last;
  while (idea === last) idea = Math.random() < 0.5 ? `${pick(PEOPLE)} ${pick(DEEDS)}` : pick(MOMENTS);
  last = idea;
  return idea;
};
