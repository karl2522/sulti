import type { SpeakHandlers, SpeakOptions, Synth } from "./speechQueue.js";

/** Adapts window.speechSynthesis to the queue's Synth interface. */
export function createWebSpeech(): (Synth & { unlock(): void; voices(): SpeechSynthesisVoice[] }) | null {
  const ss = globalThis.speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === "undefined") return null;
  // Safari can garbage-collect an utterance mid-speech and never fire onend;
  // holding a reference prevents that.
  let current: SpeechSynthesisUtterance | null = null;
  let unlocked = false;

  return {
    speak(text: string, opts: SpeakOptions, h: SpeakHandlers) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate;
      const voice = opts.voiceName ? ss.getVoices().find((v) => v.name === opts.voiceName) : undefined;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.onend = () => {
        if (current === u) current = null;
        h.onEnd();
      };
      u.onerror = (e) => {
        if (current === u) current = null;
        h.onError(e.error);
      };
      current = u;
      ss.speak(u);
    },
    cancel: () => ss.cancel(),
    pause: () => ss.pause(),
    resume: () => ss.resume(),
    get speaking() {
      return ss.speaking;
    },
    get paused() {
      return ss.paused;
    },
    voices: () => ss.getVoices(),
    /** iOS only allows speech after a user gesture; call this from a tap. */
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      ss.speak(u);
    },
  };
}
