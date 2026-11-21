"""
Détection de la langue parlée et transcription français / anglais.

Whisper (faster-whisper, exécuté sur ce serveur, sans clé API) reconnaît le français
et l'anglais mais pas le dioula : un vocal qu'il n'identifie pas clairement comme
français ou anglais est traité comme du dioula et transcrit par Djelia.

Variables d'environnement (facultatives) :
  WHISPER_MODEL      taille du modèle (défaut : base ; small = plus précis, plus lent)
  LANG_MIN_PROB      probabilité minimale pour retenir fr/en (défaut : 0.6)
"""

import os
import re
import threading

DIOULA, FRANCAIS, ANGLAIS = "dyu", "fr", "en"
LANGUES = {DIOULA: "Dioula", FRANCAIS: "Français", ANGLAIS: "English"}

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
MIN_PROB = float(os.environ.get("LANG_MIN_PROB", "0.6"))

_model = None
_lock = threading.Lock()


def _whisper():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _model


def precharger() -> None:
    """Charge le modèle en arrière-plan au démarrage (téléchargement au premier lancement)."""
    threading.Thread(target=lambda: _safe(_whisper), daemon=True).start()


def _safe(fn):
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 — l'erreur réapparaîtra à la première requête
        print(f"[langues] modèle Whisper non chargé : {exc}")


def detecter_audio(wav_path: str) -> tuple[str, float]:
    """Langue d'un vocal : ("fr" | "en" | "dyu", probabilité de fr/en)."""
    model = _whisper()
    from faster_whisper.audio import decode_audio

    audio = decode_audio(wav_path, sampling_rate=16000)
    lang, prob, all_probs = model.detect_language(audio)
    probs = dict(all_probs or [(lang, prob)])
    best = max((FRANCAIS, ANGLAIS), key=lambda code: probs.get(code, 0.0))
    p = probs.get(best, 0.0)
    return (best if p >= MIN_PROB else DIOULA), p


def transcrire(wav_path: str, langue: str) -> str:
    """Vocal français ou anglais -> texte."""
    segments, _ = _whisper().transcribe(wav_path, language=langue, beam_size=5, vad_filter=True)
    return " ".join(s.text.strip() for s in segments).strip()


_MOTS = {
    FRANCAIS: set("je j tu il elle nous vous ils le la les un une des du de est et pour avec dans sur que qui "
                  "mon ma mes pas ne au aux comment quoi quand où mais ou sont veux vends cherche bonjour merci".split()),
    ANGLAIS: set("i you he she we they the a an is are and for with in on that what who my your not do does how "
                 "when where but or want sell buy looking hello thanks thank have has of to".split()),
}


def detecter_texte(text: str) -> str:
    """Langue d'un texte écrit : anglais si ses mots courants l'emportent, sinon français."""
    words = re.findall(r"[a-zà-ÿ']+", text.lower())
    score = {code: sum(w in mots for w in words) for code, mots in _MOTS.items()}
    return ANGLAIS if score[ANGLAIS] > score[FRANCAIS] else FRANCAIS
