/**
 * Lecture à voix haute des réponses en français / anglais par la synthèse vocale native
 * du navigateur (Web Speech API). Le dioula, lui, est lu par la voix Djelia (mp3 du serveur).
 */
import type { Lang } from './types';

const BCP47: Record<Exclude<Lang, 'dyu'>, string> = { fr: 'fr-FR', en: 'en-US' };

export const canSpeak = (lang?: Lang): lang is 'fr' | 'en' =>
  (lang === 'fr' || lang === 'en') && typeof window !== 'undefined' && 'speechSynthesis' in window;

function voiceFor(lang: 'fr' | 'en') {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang.replace('_', '-') === BCP47[lang]) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang));
}

/** Lit `text` ; `onEnd` est appelé à la fin (ou à l'interruption). */
export function speak(text: string, lang: 'fr' | 'en', onEnd?: () => void) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BCP47[lang];
  const voice = voiceFor(lang);
  if (voice) u.voice = voice;
  u.onend = u.onerror = () => onEnd?.();
  synth.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
