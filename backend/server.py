"""
API HTTP d'AgriVoix : expose la chaîne de pipeline.py et la base Supabase à l'application web.

Lancement (depuis le dossier backend/) :
  venv\\Scripts\\python.exe -m uvicorn server:app --port 8000

Routes (sauf health, inscription et localite : en-tête `X-User-Token` obligatoire) :
  GET    /api/health                       état du serveur et de la configuration
  GET    /api/localite?lat=&lng=           nom de la localité d'une position GPS
  POST   /api/inscription                  nom, téléphone, position -> jeton de session
  GET    /api/moi                          profil de l'utilisateur connecté
  POST   /api/assistant                    conseiller agricole (texte, photo ou vocal dioula / français / anglais)
  POST   /api/annonces                     annonce vocale/écrite : audio stocké, analyse, matching
  GET    /api/annonces                     mes annonces et leur correspondance
  DELETE /api/annonces/{id}                annule une annonce
  GET    /api/annonces/{id}/messages       conversation avec la correspondance
  POST   /api/annonces/{id}/messages       envoie un message (texte ou vocal)

Langues : la langue d'un vocal est détectée automatiquement (langues.py). Le dioula passe
par Djelia (ASR, traduction, voix) ; le français et l'anglais sont transcrits sur ce serveur
par Whisper, et la réponse vocale est lue par la synthèse vocale native du navigateur.

Les clés API restent sur ce serveur : le navigateur n'appelle que ces routes.
"""

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request

import anthropic
from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import annonces_db as db
import glossaire
import langues
import pipeline

app = FastAPI(title="AgriVoix API")
langues.precharger()

# En dev, Next.js relaie /api vers ce serveur (même origine). CORS utile seulement
# si le front appelle directement le port 8000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

PRODUCTS = ["Maïs", "Manioc", "Riz", "Tomate", "Igname", "Banane", "Cacao", "Café"]
IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_UPLOAD = 15 * 1024 * 1024
ANSWER_MAX_TOKENS = 2000  # marge pour la réflexion du modèle ; la réponse reste courte via le prompt
DEFAULT_COUNTRY_CODE = "+225"  # numéros locaux à 10 chiffres (Côte d'Ivoire)

WEB_HINT = (
    "\n\nSi l'utilisateur envoie une photo, décris brièvement ce que tu observes "
    "avant de conseiller. Si une information manque (culture, région), pose une seule question."
)

ANALYZE_PROMPT = (
    "Tu analyses une annonce agricole d'un producteur ou d'un acheteur ouest-africain. "
    "Détermine s'il VEND / propose (offer) ou s'il CHERCHE / veut acheter (need), "
    "le produit concerné parmi la liste fournie (ou \"Autre\"), la quantité telle "
    "qu'énoncée (ex. \"500 kg\", \"2 tonnes\") et le lieu (ville ou village) s'il est cité. "
    "Mets une chaîne vide pour une information absente. "
    "L'annonce peut être en français, en anglais ou en dioula. Pour un vocal dioula, tu reçois "
    "la transcription dioula et une traduction automatique qui confond souvent les noms de produits : "
    "la transcription dioula et le glossaire font foi. "
    "Dans `french`, réécris l'annonce en une phrase française correcte et fidèle, à la première personne "
    "(traduis-la si elle est en anglais)."
)

ANALYZE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["offer", "need"]},
        "product": {"type": "string", "enum": PRODUCTS + ["Autre"]},
        "quantity": {"type": "string"},
        "place": {"type": "string"},
        "french": {"type": "string"},
    },
    "required": ["kind", "product", "quantity", "place", "french"],
    "additionalProperties": False,
}


# --- Utilitaires -------------------------------------------------------------

def _read_upload(upload: UploadFile) -> bytes:
    data = upload.file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Fichier trop volumineux (15 Mo maximum).")
    if not data:
        raise HTTPException(400, "Fichier vide.")
    return data


class Audio:
    """Vocal du navigateur (webm/ogg/mp4…) converti une fois par ffmpeg :
    WAV 16 kHz mono pour la transcription, MP3 pour le stockage et la lecture."""

    def __init__(self, upload: UploadFile):
        if not shutil.which("ffmpeg"):
            raise HTTPException(500, "ffmpeg est requis sur le serveur pour traiter les vocaux.")
        self.dir = tempfile.mkdtemp(prefix="agrivoix-")
        suffix = os.path.splitext(upload.filename or "")[1] or ".webm"
        src = os.path.join(self.dir, "src" + suffix)
        with open(src, "wb") as f:
            f.write(_read_upload(upload))
        self.wav = os.path.join(self.dir, "voice.wav")
        mp3 = os.path.join(self.dir, "voice.mp3")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src,
             "-ac", "1", "-ar", "16000", self.wav,
             "-ac", "1", "-b:a", "64k", mp3],
            capture_output=True,
        )
        if proc.returncode != 0:
            self.close()
            raise HTTPException(400, "Audio illisible : " + proc.stderr.decode(errors="ignore")[:200])
        with open(mp3, "rb") as f:
            self.mp3 = f.read()

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _transcribe_to_french(wav_path: str) -> tuple[str, str]:
    """Vocal dioula -> (texte dioula normalisé, traduction française)."""
    text_bam = pipeline.transcribe_dioula(wav_path)
    text_bam = glossaire.normaliser_dioula(text_bam, pipeline.DICTIONNAIRE)
    return text_bam, pipeline.translate(text_bam, "bam_Latn", "fra_Latn")


def _lang_param(lang: str) -> str | None:
    """Langue imposée par l'application, ou None pour la détection automatique."""
    lang = (lang or "auto").strip().lower()
    if lang == "auto":
        return None
    if lang not in langues.LANGUES:
        raise HTTPException(400, "Langue inconnue (auto, dyu, fr ou en).")
    return lang


def _transcribe(wav_path: str, forced: str | None = None) -> dict:
    """Vocal -> {lang, transcript (langue d'origine), french (texte transmis à Claude)}.

    Langue détectée par Whisper : français / anglais transcrits par Whisper,
    tout le reste traité comme du dioula (Djelia).
    """
    lang = forced
    if lang is None:
        try:
            lang, _ = langues.detecter_audio(wav_path)
        except Exception as exc:  # noqa: BLE001 — sans détection, on garde le parcours dioula
            print(f"[langues] détection impossible : {exc}")
            lang = langues.DIOULA
    if lang == langues.DIOULA:
        text_bam, text_fr = _transcribe_to_french(wav_path)
        return {"lang": lang, "transcript": text_bam, "french": text_fr}
    try:
        text = langues.transcrire(wav_path, lang)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Transcription impossible : {exc}") from exc
    if not text:
        raise HTTPException(422, "Je n'ai rien entendu. Parlez plus près du micro et réessayez.")
    return {"lang": lang, "transcript": text, "french": text}


def _reply_language(lang: str) -> str:
    if lang == langues.ANGLAIS:
        return ("\n\nL'utilisateur parle anglais : réponds directement en anglais simple, sans "
                "mentionner la langue (mêmes règles : 3 à 5 phrases courtes, sans listes ni markdown, "
                "ta réponse sera lue à voix haute).")
    return ""


def _speak(answer_fr: str) -> tuple[str, str]:
    """Réponse française -> (texte dioula, mp3 en base64)."""
    answer_bam = pipeline.translate(answer_fr, "fra_Latn", "bam_Latn")
    out = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
    out.close()
    try:
        pipeline.speak_dioula(answer_bam, out.name)
        with open(out.name, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("ascii")
    finally:
        os.unlink(out.name)
    return answer_bam, audio_b64


def _text_of(response) -> str:
    if response.stop_reason == "refusal":
        return "Je ne peux pas répondre à cette demande. Posez-moi une question sur vos cultures ou vos animaux."
    return "".join(b.text for b in response.content if b.type == "text").strip()


def _claude_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, anthropic.RateLimitError):
        return HTTPException(429, "Trop de demandes, réessayez dans un instant.")
    if isinstance(exc, anthropic.AuthenticationError):
        return HTTPException(500, "Clé ANTHROPIC_API_KEY invalide.")
    if isinstance(exc, anthropic.APIConnectionError):
        return HTTPException(502, "Impossible de joindre l'API Claude.")
    if isinstance(exc, anthropic.APIStatusError):
        return HTTPException(502, f"Erreur API Claude : {exc.message}")
    return HTTPException(500, f"Erreur : {exc}")


def _db(call):
    """Exécute un appel base de données et traduit ses erreurs en réponses HTTP."""
    try:
        return call()
    except db.DatabaseError as exc:
        status = {"unauthorized": 401, "phone_taken": 409, "not_matched": 404, "config": 503}.get(exc.code, 502)
        raise HTTPException(status, str(exc)) from exc


def _token(x_user_token: str | None) -> str:
    if not x_user_token or len(x_user_token) < 20:
        raise HTTPException(401, "Inscrivez-vous pour continuer.")
    return x_user_token


def _normalize_phone(raw: str) -> str:
    phone = re.sub(r"[\s.\-()]", "", raw or "")
    if re.fullmatch(r"[0-9]{10}", phone):  # numéro local ivoirien (07…, 05…, 01…)
        phone = DEFAULT_COUNTRY_CODE + phone
    elif phone.startswith("00"):  # format international 00 225 …
        phone = "+" + phone[2:]
    elif not phone.startswith("+"):
        raise HTTPException(400, "Numéro invalide : 10 chiffres, ou format international (+225…).")
    if not re.fullmatch(r"\+[0-9]{8,15}", phone):
        raise HTTPException(400, "Numéro de téléphone invalide.")
    return phone


def _reverse_geocode(lat: float, lng: float) -> str:
    """Nom de la localité (ville, village…) d'une position, via OpenStreetMap Nominatim."""
    query = urllib.parse.urlencode({"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 12, "accept-language": "fr"})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/reverse?{query}",
        headers={"User-Agent": "AgriVoix/0.1 (prototype)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            addr = json.loads(res.read().decode("utf-8")).get("address", {})
    except Exception:  # noqa: BLE001 — la localité reste facultative
        return ""
    for key in ("city", "town", "village", "municipality", "suburb", "county", "state"):
        if addr.get(key):
            return addr[key]
    return ""


def _analyze(announce_fr: str, transcript_bam: str = "") -> dict:
    """Annonce -> {kind, product, quantity, place, french}.

    Pour un vocal, la transcription dioula est fournie avec la traduction automatique :
    le modèle de traduction confond des noms de produits (ex. « kaba », maïs), le glossaire corrige.
    """
    content = (
        f"Transcription dioula (fait foi) : {transcript_bam}\nTraduction automatique (peut se tromper) : {announce_fr}"
        if transcript_bam
        else announce_fr
    )
    try:
        response = pipeline.claude.messages.create(
            model=pipeline.CLAUDE_MODEL,
            max_tokens=1000,
            system=ANALYZE_PROMPT + "\nProduits : " + ", ".join(PRODUCTS) + ".\n\n" + glossaire.vers_prompt(pipeline.DICTIONNAIRE),
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": ANALYZE_SCHEMA}},
            messages=[{"role": "user", "content": content}],
        )
    except Exception as exc:  # noqa: BLE001
        raise _claude_errors(exc) from exc
    try:
        return json.loads(_text_of(response))
    except ValueError as exc:
        raise HTTPException(502, "Analyse illisible, réessayez.") from exc


# --- Routes : état et inscription --------------------------------------------

@app.get("/api/health")
def health():
    return {
        "ok": True,
        "model": pipeline.CLAUDE_MODEL,
        "asr_model": pipeline.ASR_MODEL,
        "whisper_model": langues.WHISPER_MODEL,
        "languages": list(langues.LANGUES),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "database_configured": db.is_configured(),
    }


@app.get("/api/localite")
def localite(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    return {"place": _reverse_geocode(lat, lng)}


@app.post("/api/inscription")
def inscription(
    name: str = Form(...),
    phone: str = Form(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    place: str = Form(""),
):
    name = name.strip()
    if not 2 <= len(name) <= 80:
        raise HTTPException(400, "Indiquez votre nom (2 à 80 caractères).")
    phone = _normalize_phone(phone)
    if (lat is None) != (lng is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180)):
        raise HTTPException(400, "Position invalide.")
    place = place.strip() or (_reverse_geocode(lat, lng) if lat is not None else "")
    if lat is None and not place:
        raise HTTPException(400, "Activez la localisation ou indiquez votre ville / village.")

    token = db.new_token()
    profile = _db(lambda: db.register(name, phone, lat, lng, place, token))
    return {"token": token, "profile": profile}


@app.get("/api/moi")
def moi(x_user_token: str | None = Header(None)):
    return _db(lambda: db.profile(_token(x_user_token)))


# --- Route : assistant -------------------------------------------------------

@app.post("/api/assistant")
def assistant(
    history: str = Form("[]"),
    text: str = Form(""),
    voice_reply: bool = Form(False),
    lang: str = Form("auto"),
    audio: UploadFile | None = File(None),
    image: UploadFile | None = File(None),
    x_user_token: str | None = Header(None),
):
    """Conseiller agricole.

    - `history` : JSON [{role: "user"|"assistant", text}] des échanges précédents.
    - `text` : question écrite (français ou anglais, détecté).
    - `audio` : question vocale, langue détectée (dioula, français ou anglais).
      Dioula : chaîne Djelia complète, réponse vocale dioula (`audio_b64`).
      Français / anglais : réponse dans la même langue, lue par le navigateur (`speak`).
      Le vocal et ses transcriptions sont enregistrés (Supabase) pour l'utilisateur connecté.
    - `image` : photo de plantation analysée par Claude.
    - `voice_reply` : lire aussi la réponse d'une question écrite.
    - `lang` : auto (défaut), dyu, fr ou en pour imposer la langue.
    """
    if not text.strip() and audio is None and image is None:
        raise HTTPException(400, "Envoyez un texte, une photo ou un vocal.")

    forced = _lang_param(lang)
    result: dict = {"lang": forced or (langues.detecter_texte(text) if text.strip() else langues.FRANCAIS)}
    question = text.strip()
    voice: Audio | None = None

    try:
        if audio is not None:
            voice = Audio(audio)
            heard = _transcribe(voice.wav, forced)
            result["lang"] = heard["lang"]
            result["question"] = heard["transcript"]
            if heard["lang"] == langues.DIOULA:
                result["question_bam"] = heard["transcript"]
                result["question_fr"] = heard["french"]
            question = (question + "\n" + heard["french"]).strip()
            voice_reply = True

        content: list = []
        if image is not None:
            if image.content_type not in IMAGE_TYPES:
                raise HTTPException(415, "Format d'image non pris en charge (JPEG, PNG, WebP, GIF).")
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.content_type,
                    "data": base64.standard_b64encode(_read_upload(image)).decode("ascii"),
                },
            })
        content.append({"type": "text", "text": question or "Que vois-tu sur cette photo de ma plantation ?"})

        messages = []
        try:
            for m in json.loads(history)[-20:]:
                if m.get("role") in ("user", "assistant") and m.get("text"):
                    messages.append({"role": m["role"], "content": m["text"]})
        except (ValueError, AttributeError):
            pass
        while messages and messages[0]["role"] != "user":
            messages.pop(0)
        messages.append({"role": "user", "content": content})

        try:
            response = pipeline.claude.messages.create(
                model=pipeline.CLAUDE_MODEL,
                max_tokens=ANSWER_MAX_TOKENS,
                system=pipeline.SYSTEM_PROMPT + WEB_HINT + _reply_language(result["lang"]),
                output_config={"effort": "low"},
                messages=messages,
            )
        except Exception as exc:  # noqa: BLE001
            raise _claude_errors(exc) from exc

        result["answer"] = _text_of(response)
        result["answer_fr"] = result["answer"]  # ancien nom du champ (front pas encore redéployé)

        # Archive du vocal (audio + transcriptions) : n'empêche jamais la réponse.
        if voice is not None and x_user_token:
            try:
                uid = db.profile(x_user_token)["id"]
                path = db.upload_audio("assistant", uid, voice.mp3)
                db.save_assistant_vocal(
                    x_user_token, path, result.get("question_bam", ""),
                    result.get("question_fr") or result["question"], result["answer"],
                )
            except Exception as exc:  # noqa: BLE001
                result["save_error"] = f"Vocal non archivé : {exc}"
    finally:
        if voice is not None:
            voice.close()

    if voice_reply and result["answer"]:
        if result["lang"] == langues.DIOULA:
            try:
                result["answer_bam"], result["audio_b64"] = _speak(result["answer"])
            except Exception as exc:  # noqa: BLE001 — la réponse écrite reste utile
                result["voice_error"] = f"Réponse vocale indisponible : {exc}"
        else:
            result["speak"] = True  # lue par la synthèse vocale native du navigateur

    return result


# --- Routes : annonces et mise en relation -----------------------------------

@app.post("/api/annonces")
def create_annonce(
    text: str = Form(""),
    lang: str = Form("auto"),
    audio: UploadFile | None = File(None),
    x_user_token: str | None = Header(None),
):
    """Vocal ou texte (dioula, français ou anglais) : audio stocké, transcription, analyse, enregistrement, matching."""
    token = _token(x_user_token)
    me = _db(lambda: db.profile(token))  # vérifie la session avant de payer transcription + analyse
    if audio is None and not text.strip():
        raise HTTPException(400, "Annonce vide.")

    forced = _lang_param(lang)
    transcript_bam, audio_path = "", ""
    announce = text.strip()
    detected = forced or (langues.detecter_texte(announce) if announce else langues.FRANCAIS)
    original = announce
    if audio is not None:
        with Audio(audio) as voice:
            heard = _transcribe(voice.wav, forced)
            detected, original, announce = heard["lang"], heard["transcript"], heard["french"]
            if detected == langues.DIOULA:
                transcript_bam = original
            audio_path = _db(lambda: db.upload_audio("annonces", me["id"], voice.mp3))

    info = _analyze(announce, transcript_bam)
    annonce = _db(lambda: db.create_annonce(
        token,
        source="voice" if audio is not None else "text",
        kind=info["kind"],
        product=info["product"],
        quantity=info.get("quantity", ""),
        place=info.get("place", ""),
        # Français écrit : tel quel. Vocal ou anglais : version française corrigée par l'analyse
        # (pour le dioula, à l'aide de la transcription et du glossaire).
        transcript_fr=announce if audio is None and detected == langues.FRANCAIS else (info.get("french") or announce),
        transcript_bam=transcript_bam,
        audio_path=audio_path,
    ))
    annonce = _db(lambda: db.with_audio_urls([annonce])[0])
    return {**annonce, "lang": detected, "transcript": original}


@app.get("/api/annonces")
def list_annonces(x_user_token: str | None = Header(None)):
    token = _token(x_user_token)
    return _db(lambda: db.with_audio_urls(db.list_annonces(token)))


@app.delete("/api/annonces/{annonce_id}")
def cancel_annonce(annonce_id: str, x_user_token: str | None = Header(None)):
    token = _token(x_user_token)
    return {"cancelled": _db(lambda: db.cancel_annonce(token, annonce_id))}


@app.get("/api/annonces/{annonce_id}/messages")
def list_messages(annonce_id: str, x_user_token: str | None = Header(None)):
    token = _token(x_user_token)
    return _db(lambda: db.with_audio_urls(db.list_messages(token, annonce_id)))


@app.post("/api/annonces/{annonce_id}/messages")
def send_message(
    annonce_id: str,
    text: str = Form(""),
    duration_ms: int | None = Form(None),
    audio: UploadFile | None = File(None),
    x_user_token: str | None = Header(None),
):
    token = _token(x_user_token)
    if audio is None and not text.strip():
        raise HTTPException(400, "Message vide.")
    if len(text) > 2000:
        raise HTTPException(400, "Message trop long (2000 caractères maximum).")
    audio_path = ""
    if audio is not None:
        me = _db(lambda: db.profile(token))
        with Audio(audio) as voice:
            audio_path = _db(lambda: db.upload_audio("messages", me["id"], voice.mp3))
    message = _db(lambda: db.send_message(token, annonce_id, text, audio_path, duration_ms))
    return _db(lambda: db.with_audio_urls([message])[0])
