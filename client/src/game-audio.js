export const SOUND_STORAGE_KEY = "katarik_sound_enabled";

const SOUND_PATTERNS = {
  cards: [
    { frequency: 180, duration: 0.045, gain: 0.035, type: "triangle" },
    {
      frequency: 120,
      duration: 0.055,
      gain: 0.025,
      type: "square",
      delay: 0.035,
    },
  ],
  pass: [
    { frequency: 330, duration: 0.09, gain: 0.035, type: "sine" },
    { frequency: 220, duration: 0.12, gain: 0.03, type: "sine", delay: 0.08 },
  ],
  alarm: [
    { frequency: 880, duration: 0.16, gain: 0.055, type: "square" },
    {
      frequency: 660,
      duration: 0.16,
      gain: 0.05,
      type: "square",
      delay: 0.2,
    },
    {
      frequency: 880,
      duration: 0.2,
      gain: 0.055,
      type: "square",
      delay: 0.4,
    },
  ],
  win: [
    { frequency: 523.25, duration: 0.13, gain: 0.045, type: "sine" },
    {
      frequency: 659.25,
      duration: 0.13,
      gain: 0.045,
      type: "sine",
      delay: 0.12,
    },
    { frequency: 783.99, duration: 0.2, gain: 0.05, type: "sine", delay: 0.24 },
  ],
  lose: [
    { frequency: 392, duration: 0.14, gain: 0.04, type: "sine" },
    {
      frequency: 329.63,
      duration: 0.14,
      gain: 0.04,
      type: "sine",
      delay: 0.13,
    },
    {
      frequency: 261.63,
      duration: 0.22,
      gain: 0.045,
      type: "sine",
      delay: 0.26,
    },
  ],
};

export function readSoundEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeSoundEnabled(enabled, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SOUND_STORAGE_KEY, String(Boolean(enabled)));
  } catch {
    // Sound preferences are optional when storage is unavailable.
  }
}

export function getGameSounds(previousGame, nextGame, playerId) {
  if (!nextGame) return [];

  if (previousGame?.status !== "finished" && nextGame.status === "finished") {
    return [didPlayerWin(nextGame, playerId) ? "win" : "lose"];
  }

  if (!previousGame) return [];

  const sounds = [];
  const previousPasses = new Set(previousGame.passedPlayerIds || []);
  const hasNewPass = (nextGame.passedPlayerIds || []).some(
    (id) => !previousPasses.has(id),
  );
  const passFinishedTrick =
    Boolean(previousGame.table) &&
    !nextGame.table &&
    previousGame.status === "playing" &&
    nextGame.status === "playing";
  if (hasNewPass || passFinishedTrick) sounds.push("pass");

  if (
    nextGame.table &&
    tableSignature(previousGame.table) !== tableSignature(nextGame.table)
  ) {
    sounds.push("cards");
  }

  return sounds;
}

export function createGameAudio(
  AudioContextConstructor = globalThis.AudioContext ||
    globalThis.webkitAudioContext,
) {
  let context = null;

  function getContext() {
    if (!AudioContextConstructor) return null;
    context ||= new AudioContextConstructor();
    return context;
  }

  async function unlock() {
    const current = getContext();
    if (current?.state === "suspended") {
      await current.resume();
    }
  }

  function play(effect, startDelay = 0) {
    const current = getContext();
    const pattern = SOUND_PATTERNS[effect];
    if (!current || !pattern) return;

    void unlock()
      .then(() => {
        const startAt = current.currentTime + Math.max(0, startDelay);
        pattern.forEach((note) => {
          const oscillator = current.createOscillator();
          const gain = current.createGain();
          const noteStart = startAt + (note.delay || 0);
          const noteEnd = noteStart + note.duration;

          oscillator.type = note.type;
          oscillator.frequency.setValueAtTime(note.frequency, noteStart);
          gain.gain.setValueAtTime(0.0001, noteStart);
          gain.gain.exponentialRampToValueAtTime(note.gain, noteStart + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
          oscillator.connect(gain);
          gain.connect(current.destination);
          oscillator.start(noteStart);
          oscillator.stop(noteEnd + 0.01);
        });
      })
      .catch(() => {});
  }

  return { play, unlock };
}

function tableSignature(table) {
  if (!table) return "";
  return `${table.playerId || ""}:${(table.cards || [])
    .map((card) => card.id)
    .join(",")}`;
}

function didPlayerWin(game, playerId) {
  if (game.mode === "classic" && game.loserId) {
    return game.loserId !== playerId;
  }

  return game.roundWinnerId === playerId;
}
