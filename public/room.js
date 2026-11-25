// Shared rooms: peers in the same room talk directly over WebRTC (Trystero),
// using public Nostr relays only to find each other. Nothing is stored on a server,
// so a room's tree lives as long as at least one person has it open.
const TRYSTERO = "https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm";
const APP_ID = "thankfulness-tree-v1";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export const makeCode = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(CODE_LENGTH)), (n) => ALPHABET[n % ALPHABET.length]).join("");

export const cleanCode = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

const throttle = (fn, ms) => {
  let last = 0, timer = null, latest;
  const run = () => {
    timer = null;
    last = performance.now();
    fn(latest);
  };
  const call = (value) => {
    latest = value;
    const wait = last + ms - performance.now();
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  call.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return call;
};

export const connect = async (code, handlers) => {
  const { joinRoom, selfId } = await import(TRYSTERO);
  const room = joinRoom({ appId: APP_ID, password: `thankful-${code}` }, code);
  const peers = () => Object.keys(room.getPeers());

  const action = (name, onMessage) => {
    const a = room.makeAction(name);
    a.onMessage = (data, { peerId }) => {
      try {
        onMessage(data, peerId);
      } catch (err) {
        console.warn(`Ignored a bad "${name}" message`, err);
      }
    };
    return (data, target) => a.send(data, target ? { target } : undefined).catch(() => {});
  };

  const sendSync = action("sync", handlers.onSync);
  const sendLeaves = action("leaves", handlers.onLeaves);
  const sendRemove = action("remove", handlers.onRemove);
  const sendMove = action("move", handlers.onMove);
  const sendHand = action("hand", handlers.onHand);
  const sendShake = action("shake", (_, peerId) => handlers.onShake(peerId));

  room.onPeerJoin = (peerId) => {
    sendSync(handlers.snapshot(), peerId);
    handlers.onPeers(peers());
  };
  room.onPeerLeave = (peerId) => {
    handlers.onPeerLeft(peerId);
    handlers.onPeers(peers());
  };

  const move = throttle(sendMove, 40);
  const hand = throttle(sendHand, 50);
  return {
    code,
    selfId,
    peers,
    upsert: (leaves) => {
      move.cancel();
      sendLeaves(leaves);
    },
    remove: (id) => sendRemove(id),
    move,
    hand,
    shake: () => sendShake(1),
    leave: () => {
      move.cancel();
      hand.cancel();
      room.leave();
    },
  };
};
