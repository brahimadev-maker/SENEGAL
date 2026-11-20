"""
Assistant agricole vocal en dioula.

Chaîne :
  audio dioula (user)
    -> transcription dioula (Djelia ASR)          [ASR_MODEL]
    -> traduction dioula -> français (Djelia)     [banjugu-1]
    -> réponse agricole (Claude API)
    -> traduction français -> dioula (Djelia)     [banjugu-1]
    -> synthèse vocale dioula (Djelia TTS)        [jifili-1, voix moussa]
    -> fichier voix.mp3 lu chez l'utilisateur

Usage :
  python pipeline.py question.ogg                 # audio -> réponse audio
  python pipeline.py --text "Mi ka se ..."        # texte dioula -> réponse audio (test)
  python pipeline.py question.ogg --play          # lit le mp3 à la fin

Variables d'environnement :
  DJELIA_API_KEY, ANTHROPIC_API_KEY
  DJELIA_ASR_MODEL (optionnel, défaut : sunjata-1)
"""

import argparse
import os
import shutil
import subprocess
import sys

from dotenv import load_dotenv
from openai import OpenAI
from anthropic import Anthropic

import glossaire

# Charge les clés depuis le fichier .env (à côté de ce script)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "secrets.env"))

# --- Configuration -----------------------------------------------------------

DJELIA_BASE_URL = "https://api.djelia.cloud/openai/v1"
TRANSLATE_MODEL = "banjugu-1"
TTS_MODEL = "jifili-1"
TTS_VOICE = "moussa"
# Modèle de transcription (ASR) Djelia : sunjata-1 (vérifié via la liste des modèles du compte).
ASR_MODEL = os.environ.get("DJELIA_ASR_MODEL", "sunjata-1")

CLAUDE_MODEL = "claude-haiku-5-5"
MAX_ANSWER_TOKENS = 400  # réponses courtes = audio court et compréhensible

SYSTEM_PROMPT = (
    "Tu es un conseiller agricole pour de petits producteurs ouest-africains "
    "(cultures vivrières, maraîchage, anacarde, coton, élevage de base). "
    "Réponds en français simple, en 3 à 5 phrases courtes, sans listes ni "
    "markdown, car ta réponse sera traduite puis lue à voix haute. "
    "Donne des conseils pratiques et prudents. Si la question n'est pas "
    "agricole, dis-le poliment et propose de poser une question sur l'agriculture. "
    "En cas de maladie grave des animaux ou des plantes, conseille de consulter "
    "un agent agricole local."
)

# Dictionnaire agricole français-dioula : variantes normalisées avant traduction
# et glossaire injecté dans le prompt de Claude.
DICTIONNAIRE = glossaire.charger()
SYSTEM_PROMPT = SYSTEM_PROMPT + "\n\n" + glossaire.vers_prompt(DICTIONNAIRE)

# --- Clients -----------------------------------------------------------------

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value or value.startswith("remplacer_par"):
        sys.exit(
            f"Variable {name} absente ou non renseignée.\n"
            f"Vérifiez que le fichier .env existe dans : {os.path.dirname(ENV_FILE)}\n"
            f"et qu'il contient une ligne {name}=votre_cle (sans guillemets)."
        )
    return value


djelia = OpenAI(base_url=DJELIA_BASE_URL, api_key=require_env("DJELIA_API_KEY"))
claude = Anthropic(api_key=require_env("ANTHROPIC_API_KEY"))


# --- Étapes ------------------------------------------------------------------

def transcribe_dioula(audio_path: str) -> str:
    """Audio dioula -> texte dioula (Latin)."""
    with open(audio_path, "rb") as f:
        result = djelia.audio.transcriptions.create(
            model=ASR_MODEL,
            file=f,
            extra_body={"djelia": {"source_language": "bam_Latn"}},
        )
    return result.text


def translate(text: str, source: str, target: str) -> str:
    """Traduction via le modèle Djelia banjugu-1 (codes NLLB : bam_Latn, fra_Latn)."""
    response = djelia.chat.completions.create(
        model=TRANSLATE_MODEL,
        messages=[{"role": "user", "content": text}],
        extra_body={"djelia": {"source_language": source, "target_language": target}},
    )
    return response.choices[0].message.content


def ask_claude(question_fr: str) -> str:
    """Question française -> réponse agricole française."""
    response = claude.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_ANSWER_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": question_fr}],
    )
    return "".join(block.text for block in response.content if block.type == "text")


def speak_dioula(text_bam: str, output_path: str) -> str:
    """Texte dioula -> fichier audio mp3."""
    audio = djelia.audio.speech.create(
        model=TTS_MODEL,
        voice=TTS_VOICE,
        input=text_bam,
    )
    audio.write_to_file(output_path)
    return output_path


def play(path: str) -> None:
    """Lecture locale (ffplay ou mpg123 si présents)."""
    for player, args in (
        ("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", path]),
        ("mpg123", ["-q", path]),
    ):
        if shutil.which(player):
            subprocess.run([player, *args], check=False)
            return
    print(f"Aucun lecteur trouvé. Ouvrez le fichier manuellement : {path}")


# --- Orchestration -----------------------------------------------------------

def run(audio_path: str | None, text_bam: str | None, output_path: str, do_play: bool) -> None:
    if text_bam is None:
        if not os.path.isfile(audio_path):
            sys.exit(f"Fichier audio introuvable : {os.path.abspath(audio_path)}")
        print("1/5 Transcription dioula...")
        text_bam = transcribe_dioula(audio_path)
    text_bam = glossaire.normaliser_dioula(text_bam, DICTIONNAIRE)
    print(f"    Dioula (normalisé) : {text_bam}")

    print("2/5 Traduction dioula -> français...")
    question_fr = translate(text_bam, "bam_Latn", "fra_Latn")
    print(f"    Français : {question_fr}")

    print("3/5 Réponse agricole (Claude)...")
    answer_fr = ask_claude(question_fr)
    print(f"    Réponse : {answer_fr}")

    print("4/5 Traduction français -> dioula...")
    answer_bam = translate(answer_fr, "fra_Latn", "bam_Latn")
    print(f"    Dioula : {answer_bam}")

    print("5/5 Synthèse vocale...")
    speak_dioula(answer_bam, output_path)
    print(f"Audio écrit : {output_path}")

    if do_play:
        play(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Assistant agricole vocal en dioula")
    parser.add_argument("audio", nargs="?", help="fichier audio de la question en dioula")
    parser.add_argument("--text", help="question en dioula écrite (saute la transcription)")
    parser.add_argument("--out", default="voix.mp3", help="fichier audio de sortie")
    parser.add_argument("--play", action="store_true", help="lire la réponse à la fin")
    args = parser.parse_args()

    if not args.audio and not args.text:
        parser.error("indiquer un fichier audio ou --text")

    try:
        run(args.audio, args.text, args.out, args.play)
    except Exception as exc:  # message clair plutôt que trace brute
        print(f"Erreur : {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()