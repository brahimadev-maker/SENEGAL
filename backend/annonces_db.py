"""
Accès à Supabase (projet « agrivoix ») : utilisateurs, annonces, messages, audios.

- Base : toutes les opérations passent par des fonctions SQL (voir migrations),
  appelables uniquement avec la clé secrète. Chaque appel reçoit le hash SHA-256
  du jeton de session de l'utilisateur ; la base retrouve l'utilisateur et vérifie
  ses droits (ses annonces, ses conversations).
- Matching vendeur / acheteur : fait dans la base, de façon atomique, à la création.
- Audios : bucket privé « audios » (mp3). Lecture par liens signés temporaires.

Variables (secrets.env) :
  SUPABASE_URL         https://<ref>.supabase.co
  SUPABASE_SECRET_KEY  clé secrète (service_role)
"""

import hashlib
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "audios"
SIGNED_URL_TTL = 6 * 3600  # secondes


class DatabaseError(Exception):
    """Erreur à renvoyer au client. `code` : unauthorized, phone_taken, not_matched, config, …"""

    def __init__(self, message: str, code: str = "error"):
        super().__init__(message)
        self.code = code


MESSAGES = {
    "unauthorized": "Session expirée : reconnectez-vous.",
    "phone_taken": "Ce numéro est déjà inscrit : connectez-vous avec votre code.",
    "bad_pin": "Le code doit comporter 4 chiffres.",
    "bad_login": "Numéro ou code incorrect.",
    "no_pin": "Ce compte n'a pas encore de code : ouvrez l'application sur l'appareil de l'inscription et créez-en un.",
    "locked": "Trop d'essais : réessayez dans 15 minutes.",
    "not_matched": "Cette annonce n'a pas (ou plus) de correspondance.",
}


# --- Configuration -----------------------------------------------------------

def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not url or not key:
        raise DatabaseError(
            "Base de données non configurée : renseignez SUPABASE_URL et SUPABASE_SECRET_KEY dans secrets.env.",
            "config",
        )
    return url, key


def require_config() -> None:
    _config()


def is_configured() -> bool:
    try:
        _config()
        return True
    except DatabaseError:
        return False


# --- Jetons de session -------------------------------------------------------

def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --- HTTP --------------------------------------------------------------------

def _request(method: str, path: str, body: bytes | None = None, content_type: str = "application/json"):
    url, key = _config()
    req = urllib.request.Request(
        f"{url}{path}",
        data=body,
        method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        try:
            msg = json.loads(raw).get("message", "")
        except (ValueError, AttributeError):
            msg = ""
        if msg in MESSAGES:
            raise DatabaseError(MESSAGES[msg], msg) from exc
        raise DatabaseError(f"Erreur base de données ({exc.code}) : {(msg or raw)[:300]}") from exc
    except urllib.error.URLError as exc:
        raise DatabaseError(f"Base de données injoignable : {exc.reason}") from exc


def _rpc(name: str, params: dict):
    return _request("POST", f"/rest/v1/rpc/{name}", json.dumps(params).encode("utf-8"))


# --- Stockage des audios -----------------------------------------------------

def upload_audio(folder: str, user_id: str, mp3: bytes) -> str:
    """Enregistre un mp3 dans le bucket ; renvoie son chemin (ex. annonces/<user>/<id>.mp3)."""
    path = f"{folder}/{user_id}/{secrets.token_hex(12)}.mp3"
    _request("POST", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}", mp3, "audio/mpeg")
    return path


def signed_urls(paths: list[str]) -> dict[str, str]:
    """Liens de lecture temporaires pour une liste de chemins."""
    paths = sorted({p for p in paths if p})
    if not paths:
        return {}
    url, _ = _config()
    res = _request(
        "POST",
        f"/storage/v1/object/sign/{BUCKET}",
        json.dumps({"expiresIn": SIGNED_URL_TTL, "paths": paths}).encode("utf-8"),
    )
    return {item["path"]: f"{url}/storage/v1{item['signedURL']}" for item in res or [] if item.get("signedURL")}


def with_audio_urls(items: list[dict]) -> list[dict]:
    """Ajoute `audio_url` à chaque élément ayant un `audio_path`."""
    urls = signed_urls([i.get("audio_path") for i in items])
    for i in items:
        i["audio_url"] = urls.get(i.get("audio_path") or "")
    return items


# --- Utilisateurs ------------------------------------------------------------

def register(name: str, phone: str, lat: float | None, lng: float | None, place: str, token: str, pin: str) -> dict:
    return _rpc("register_user", {
        "p_name": name, "p_phone": phone, "p_lat": lat, "p_lng": lng,
        "p_place": place, "p_token_hash": token_hash(token), "p_pin": pin,
    })


def login(phone: str, pin: str, token: str) -> dict:
    """Ouvre une session sur cet appareil (5 essais, puis blocage de 15 minutes)."""
    profile = _rpc("login_user", {"p_phone": phone, "p_pin": pin, "p_token_hash": token_hash(token)})
    if not profile:
        raise DatabaseError(MESSAGES["bad_login"], "bad_login")
    return profile


def set_pin(token: str, pin: str) -> dict:
    return _rpc("set_pin", {"p_token_hash": token_hash(token), "p_pin": pin})


def logout(token: str) -> None:
    _rpc("logout_user", {"p_token_hash": token_hash(token)})


def profile(token: str) -> dict:
    return _rpc("get_profile", {"p_token_hash": token_hash(token)})


# --- Annonces ----------------------------------------------------------------

def create_annonce(token: str, *, source: str, kind: str, product: str, quantity: str, place: str,
                   transcript_fr: str, transcript_bam: str = "", audio_path: str = "") -> dict:
    """Enregistre l'annonce, tente le matching, renvoie l'annonce (avec `partner` si trouvé)."""
    return _rpc("create_annonce", {
        "p_token_hash": token_hash(token), "p_source": source, "p_kind": kind, "p_product": product,
        "p_quantity": quantity, "p_place": place, "p_transcript_fr": transcript_fr,
        "p_transcript_bam": transcript_bam, "p_audio_path": audio_path,
    })


def list_annonces(token: str) -> list[dict]:
    # Le paramètre SQL s'appelle encore p_device_id (signature conservée) : c'est le hash du jeton.
    return _rpc("list_annonces", {"p_device_id": token_hash(token)}) or []


def cancel_annonce(token: str, annonce_id: str) -> bool:
    return bool(_rpc("cancel_annonce", {"p_device_id": token_hash(token), "p_id": annonce_id}))


# --- Messages ----------------------------------------------------------------

def list_messages(token: str, annonce_id: str) -> list[dict]:
    return _rpc("list_messages", {"p_token_hash": token_hash(token), "p_annonce_id": annonce_id}) or []


def send_message(token: str, annonce_id: str, text: str, audio_path: str, duration_ms: int | None) -> dict:
    return _rpc("send_message", {
        "p_token_hash": token_hash(token), "p_annonce_id": annonce_id, "p_text": text,
        "p_audio_path": audio_path, "p_duration_ms": duration_ms,
    })


# --- Assistant ---------------------------------------------------------------

def save_assistant_vocal(token: str, audio_path: str, transcript_bam: str, question_fr: str, answer_fr: str) -> None:
    _rpc("save_assistant_vocal", {
        "p_token_hash": token_hash(token), "p_audio_path": audio_path, "p_transcript_bam": transcript_bam,
        "p_question_fr": question_fr, "p_answer_fr": answer_fr,
    })
