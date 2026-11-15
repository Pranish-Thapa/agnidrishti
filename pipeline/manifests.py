"""Manifest and JSON persistence helpers."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    import time

    last_error = None
    for _ in range(5):
        fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
        try:
            with open(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
                handle.flush()
            try:
                Path(tmp).replace(path)
                return
            except PermissionError as error:
                last_error = error
                time.sleep(0.5)
        finally:
            Path(tmp).unlink(missing_ok=True)
    if last_error is not None:
        raise last_error


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {"manifest_version": 1, "entries": []}
    try:
        payload = read_json(path)
    except (OSError, ValueError):
        return {"manifest_version": 1, "entries": []}
    if not isinstance(payload, dict) or "entries" not in payload:
        return {"manifest_version": 1, "entries": []}
    return payload


def save_manifest(path: Path, payload: dict) -> None:
    payload = dict(payload)
    payload.setdefault("manifest_version", 1)
    write_json(path, payload)


def find_entries(manifest: dict, predicate) -> list[dict]:
    return [entry for entry in manifest.get("entries", []) if predicate(entry)]
