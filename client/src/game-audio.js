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
  triple: [
    { frequency: 196, duration: 0.16, gain: 0.05, type: "sawtooth" },
    {
      frequency: 246.94,
      duration: 0.16,
      gain: 0.055,
      type: "sawtooth",
      delay: 0.11,
    },
    {
      frequency: 293.66,
      duration: 0.22,
      gain: 0.06,
      type: "sawtooth",
      delay: 0.22,
    },
  ],
  quad: [
    { frequency: 164.81, duration: 0.14, gain: 0.055, type: "square" },
    {
      frequency: 220,
      duration: 0.14,
      gain: 0.06,
      type: "square",
      delay: 0.1,
    },
    {
      frequency: 329.63,
      duration: 0.14,
      gain: 0.065,
      type: "square",
      delay: 0.2,
    },
    {
      frequency: 440,
      duration: 0.25,
      gain: 0.07,
      type: "square",
      delay: 0.3,
    },
  ],
  bomb: [
    { frequency: 110, duration: 0.18, gain: 0.075, type: "sawtooth" },
    {
      frequency: 73.42,
      duration: 0.28,
      gain: 0.08,
      type: "sawtooth",
      delay: 0.1,
    },
    {
      frequency: 49,
      duration: 0.42,
      gain: 0.085,
      type: "square",
      delay: 0.22,
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

  const combinationSound = playedCombinationSound(previousGame, nextGame);
  if (previousGame?.status !== "finished" && nextGame.status === "finished") {
    return [
      ...(combinationSound ? [combinationSound] : []),
      didPlayerWin(nextGame, playerId) ? "win" : "lose",
    ];
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

  if (combinationSound) sounds.push(combinationSound);

  return sounds;
}

export function createGameAudio(
  AudioContextConstructor = globalThis.AudioContext ||
    globalThis.webkitAudioContext,
  AudioConstructor = globalThis.Audio,
  schedule = globalThis.setTimeout,
) {
  let context = null;
  let bombAudio = null;
  let blackJokerAudio = null;
  let redJokerAudio = null;

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
    const cardSample = resolveCardSample(effect);
    if (cardSample && AudioConstructor) {
      playCardSample(cardSample, startDelay);
      return;
    }

    if (effect === "blackJoker" && AudioConstructor) {
      blackJokerAudio ||= new AudioConstructor("/audio/black-joker-laugh.mp3");
      blackJokerAudio.currentTime = 0;
      blackJokerAudio.volume = 0.95;
      const playback = blackJokerAudio.play();
      playback?.catch(() => playSynth("cards", startDelay));
      return;
    }

    if (effect === "redJoker" && AudioConstructor) {
      redJokerAudio ||= new AudioConstructor("/audio/red-joker-sound.mp3");
      redJokerAudio.currentTime = 0;
      redJokerAudio.volume = 0.95;
      const playback = redJokerAudio.play();
      playback?.catch(() => playSynth("cards", startDelay));
      return;
    }

    if (effect === "bomb" && AudioConstructor) {
      bombAudio ||= new AudioConstructor("/audio/bomb.mp3");
      bombAudio.currentTime = 0;
      bombAudio.volume = 0.95;
      const playback = bombAudio.play();
      playback?.catch(() => playSynth(effect, startDelay));
      return;
    }

    playSynth(effect, startDelay);
  }

  function playCardSample({ count, interval }, startDelay) {
    for (let index = 0; index < count; index += 1) {
      const delayMs = Math.max(0, startDelay * 1000 + index * interval);
      const startSample = () => {
        const audio = new AudioConstructor("/audio/card-hit.mp3");
        audio.currentTime = 0;
        audio.volume = 0.9;
        const playback = audio.play();
        playback?.catch(() => playSynth("cards"));
      };

      if (delayMs > 0 && schedule) {
        schedule(startSample, delayMs);
      } else {
        startSample();
      }
    }
  }

  function playSynth(effect, startDelay = 0) {
    const current = getContext();
    const pattern = resolveSoundPattern(effect);
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

function resolveCardSample(effect) {
  if (effect === "cards") return { count: 1, interval: 0 };
  if (effect === "pair") return { count: 2, interval: 100 };
  if (effect.startsWith("row:")) {
    const count = Number.parseInt(effect.slice(4), 10);
    return {
      count: Math.max(1, Math.min(count || 1, 13)),
      interval: 90,
    };
  }

  return null;
}

function resolveSoundPattern(effect) {
  if (effect === "pair") return repeatCardPattern(2, 0.075);
  if (effect.startsWith("row:")) {
    const count = Number.parseInt(effect.slice(4), 10);
    return repeatCardPattern(Math.max(1, Math.min(count || 1, 13)), 0.08);
  }

  return SOUND_PATTERNS[effect];
}

function repeatCardPattern(count, interval) {
  return Array.from({ length: count }, (_, index) =>
    SOUND_PATTERNS.cards.map((note) => ({
      ...note,
      delay: (note.delay || 0) + index * interval,
    })),
  ).flat();
}

function playedCombinationSound(previousGame, nextGame) {
  if (
    !nextGame?.table ||
    tableSignature(previousGame?.table) === tableSignature(nextGame.table)
  ) {
    return null;
  }

  const comboType = nextGame.table.combo?.type;
  const playedCards = nextGame.table.cards || [];
  if (
    playedCards.length === 1 &&
    (playedCards[0].id === "BLACK_JOKER" ||
      playedCards[0].rank === "BLACK_JOKER")
  ) {
    return "blackJoker";
  }
  if (
    playedCards.length === 1 &&
    (playedCards[0].id === "RED_JOKER" || playedCards[0].rank === "RED_JOKER")
  ) {
    return "redJoker";
  }
  if (comboType === "pair") return "pair";
  if (comboType === "triple") return "triple";
  if (comboType === "quad") return "quad";
  if (comboType === "straight") {
    return `row:${nextGame.table.cards?.length || 1}`;
  }
  if (comboType === "doubleStraight") return "bomb";
  return "cards";
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
