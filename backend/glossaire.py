"""
Utilisation du dictionnaire agricole français-dioula.

- normaliser_dioula : remplace les variantes orthographiques dioula par le mot
  canonique avant la traduction, pour que le modèle de traduction reconnaisse mieux les termes.
- vers_prompt : construit le glossaire injecté dans le prompt système de Claude,
  pour que ses réponses françaises utilisent les noms agricoles corrects.
"""

import json
import os
import re

CHEMIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dictionnaire_agricole.json")


def charger(chemin: str = CHEMIN) -> dict:
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def _entrees(data: dict):
    """Toutes les entrées {fr, dyu, variantes} du dictionnaire."""
    listes = [data.get("couleurs", []), data.get("vocabulaire_agricole", [])]
    listes += list(data.get("cultures", {}).values())
    for liste in listes:
        yield from liste


def normaliser_dioula(texte: str, data: dict) -> str:
    """Remplace chaque variante connue par le mot dioula canonique (insensible à la casse)."""
    correspondances = {}
    for e in _entrees(data):
        canonique = e.get("dyu")
        if not canonique:
            continue
        for variante in e.get("variantes", []):
            correspondances.setdefault(variante.lower(), canonique)

    if not correspondances:
        return texte

    motifs = sorted(correspondances, key=len, reverse=True)  # les plus longs d'abord
    pattern = re.compile(
        r"(?<!\w)(" + "|".join(re.escape(m) for m in motifs) + r")(?!\w)",
        re.IGNORECASE,
    )
    return pattern.sub(lambda m: correspondances[m.group(1).lower()], texte)


def vers_prompt(data: dict) -> str:
    """Glossaire lisible à injecter dans le prompt système de Claude."""
    lignes = [
        "Glossaire agricole de référence (français : mot dioula). "
        "Utilise les noms français ci-dessous. Ne confonds jamais une plante avec un plat cuisiné."
    ]
    for e in _entrees(data):
        if e.get("dyu"):
            lignes.append(f"- {e['fr']} : {e['dyu']}")
    return "\n".join(lignes)