"""Canonical item name normalization.

Maps user-typed item names to canonical ingredient names from the DB.
Silent best-effort: always returns a usable name, never blocks the user.
"""

from __future__ import annotations

import re

from sqlalchemy import text

from souschef.database import DictConnection


# Cached ingredient index — built once per process, cleared on None conn
_ingredient_cache: dict[str, tuple[str, int]] | None = None
_ingredient_names: list[tuple[str, int]] | None = None


def _build_cache(conn: DictConnection) -> None:
    """Load all ingredient names into an in-memory index."""
    global _ingredient_cache, _ingredient_names
    rows = conn.execute(text("SELECT id, name FROM ingredients")).fetchall()
    _ingredient_cache = {}
    _ingredient_names = []
    for r in rows:
        canonical = r["name"].lower()
        _ingredient_cache[canonical] = (r["name"], r["id"])
        _ingredient_names.append((canonical, r["id"]))


def _ensure_cache(conn: DictConnection) -> None:
    if _ingredient_cache is None:
        _build_cache(conn)


def invalidate_cache() -> None:
    """Call when ingredients table changes (e.g., new ingredient added)."""
    global _ingredient_cache, _ingredient_names
    _ingredient_cache = None
    _ingredient_names = None


def _norm(name: str) -> str:
    """Normalize: lowercase, strip non-alphanumeric except spaces."""
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


def _compact(name: str) -> str:
    """Strip everything but alphanumeric."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


_PLURAL_SUFFIXES = [
    ("ies", "y"),    # berries → berry
    ("ves", "f"),    # loaves → loaf
    ("ses", "s"),    # sauces → sauce (but also passes → pass)
    ("es", ""),      # tomatoes → tomato
    ("s", ""),       # beans → bean
]


def _depluralize(word: str) -> str:
    """Simple English depluralization."""
    for suffix, replacement in _PLURAL_SUFFIXES:
        if word.endswith(suffix) and len(word) > len(suffix) + 1:
            return word[:-len(suffix)] + replacement
    return word


def _pluralize(word: str) -> str:
    """Simple English pluralization."""
    if word.endswith("y") and not word.endswith(("ay", "ey", "oy", "uy")):
        return word[:-1] + "ies"
    if word.endswith(("s", "sh", "ch", "x", "z", "o")):
        return word + "es"
    return word + "s"


def normalize_item_name(conn: DictConnection, raw_name: str) -> tuple[str, int | None]:
    """Normalize a user-typed item name to a canonical ingredient name.

    Returns (canonical_name, ingredient_id).
    If no match found, returns (raw_name.lower(), None).
    Never raises — always returns a usable name.
    """
    _ensure_cache(conn)

    name = raw_name.strip().lower()
    if not name:
        return (name, None)

    # 1. Exact match
    if name in _ingredient_cache:
        return _ingredient_cache[name]

    # 2. Plural/singular variants
    deplu = _depluralize(name)
    if deplu != name and deplu in _ingredient_cache:
        return _ingredient_cache[deplu]
    plu = _pluralize(name)
    if plu in _ingredient_cache:
        return _ingredient_cache[plu]

    # Also try depluralize on last word (e.g., "green bean" → check "green beans")
    words = name.split()
    if len(words) > 1:
        last_plu = " ".join(words[:-1]) + " " + _pluralize(words[-1])
        if last_plu in _ingredient_cache:
            return _ingredient_cache[last_plu]
        last_deplu = " ".join(words[:-1]) + " " + _depluralize(words[-1])
        if last_deplu != name and last_deplu in _ingredient_cache:
            return _ingredient_cache[last_deplu]

    # 3. Compact match (ignoring spaces/hyphens: "mac n cheese" vs "mac and cheese")
    name_compact = _compact(name)
    if len(name_compact) >= 3:
        for canonical, ing_id in _ingredient_names:
            if _compact(canonical) == name_compact:
                return (canonical, ing_id)

    # 4. Fuzzy: stem-aware word overlap (same logic as reconcile.py)
    name_words = set(_norm(name).split())
    if name_words:
        best_score = 0.0
        best_match = None
        for canonical, ing_id in _ingredient_names:
            can_words = set(canonical.split())
            # Word subset: user typed all words in ingredient name
            if can_words and can_words.issubset(name_words):
                score = len(can_words) / len(name_words)
                if score > best_score:
                    best_score = score
                    best_match = (canonical, ing_id)
                continue
            if name_words.issubset(can_words):
                score = len(name_words) / len(can_words)
                if score > best_score:
                    best_score = score
                    best_match = (canonical, ing_id)
                continue
            # Stem overlap
            overlap = 0
            for nw in name_words:
                for cw in can_words:
                    if nw.startswith(cw) or cw.startswith(nw):
                        overlap += 1
                        break
            total = max(len(name_words), len(can_words))
            score = overlap / total if total else 0
            if score > best_score:
                best_score = score
                best_match = (canonical, ing_id)

        if best_score >= 0.7 and best_match:
            return best_match

    # 5. Substring containment (bidirectional, like regulars._match_ingredient)
    #    Only for short names to avoid false positives
    if len(name) >= 4:
        for canonical, ing_id in _ingredient_names:
            if canonical in name or name in canonical:
                # Require reasonable length ratio to avoid "oil" matching "broil"
                ratio = min(len(name), len(canonical)) / max(len(name), len(canonical))
                if ratio >= 0.5:
                    return (canonical, ing_id)

    # No match — fall through gracefully
    return (name, None)
