"""Shared Project listing/switching helpers for every surface that offers ``/projects``.

The TUI and Desktop clients resolve projects themselves (they own the live session and move it
with an RPC), the classic CLI moves its own process, and the gateway can only list. Keeping the
resolution rules and the list rendering here means all of them agree on which folder a project
opens into and on what the list looks like.
"""

from __future__ import annotations

import os
from typing import Iterable, Optional


def primary_path(project) -> str:
    """The folder a project opens into: ``primary_path``, else the folder flagged primary, else the
    first one recorded — the same precedence as ``tools/project_tools.py::_primary_path``."""
    if getattr(project, "primary_path", None):
        return project.primary_path
    folders = getattr(project, "folders", None) or []
    for folder in folders:
        if getattr(folder, "is_primary", False):
            return folder.path
    return folders[0].path if folders else ""


def resolve(projects: Iterable, token: str):
    """Exact id/slug/name first, then case-insensitive slug/name (``project_tools._resolve``)."""
    token = (token or "").strip()
    if not token:
        return None
    for project in projects:
        if token in (project.id, project.slug) or project.name == token:
            return project
    low = token.lower()
    for project in projects:
        if project.slug.lower() == low or project.name.lower() == low:
            return project
    return None


def holds(path: Optional[str], cwd: str) -> bool:
    """True when *cwd* is *path* itself or below it."""
    if not path or not cwd:
        return False
    return cwd == path or cwd.startswith(path.rstrip(os.sep) + os.sep)


def lines(projects, active_id: Optional[str], cwd: str) -> list[str]:
    """One line per project: ``●`` the active selection, ``← here`` the one holding *cwd*."""
    width = min(24, max([4, *(len(p.name) for p in projects)]))
    out = []
    for project in projects:
        path = primary_path(project)
        marker = "\u25cf" if project.id == active_id else " "
        out.append(f" {marker} {project.name.ljust(width)}  {path or '(no folder)'}"
                   + ("   \u2190 here" if holds(path, cwd) else ""))
    return out
