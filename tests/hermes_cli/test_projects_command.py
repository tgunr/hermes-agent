"""``/projects``: listing the profile's Projects and moving the CLI session's working folder.

The TUI/Desktop client owns the live session and moves it over ``session.cwd.set`` (vitest covers
`ui-tui/src/app/slash/commands/projects.ts`); this is the classic-REPL path, where the agent's
tools follow this process's cwd and ``TERMINAL_CWD``.
"""

import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from hermes_cli import projects_db as pdb
from hermes_cli.cli_session_mixin import CLISessionMixin, _project_lines, _resolve_project


def _make_project(name: str, path: Path, *, primary: bool = True) -> str:
    path.mkdir(parents=True, exist_ok=True)
    with pdb.connect_closing() as conn:
        return pdb.create_project(conn, name=name, folders=[str(path)], primary_path=str(path) if primary else None)


def _cli(**kwargs) -> Any:
    """The bare object ``_handle_projects_command`` needs (it never touches the rest of the CLI)."""
    return SimpleNamespace(**{"is_slash_worker": False, **kwargs})


def test_switch_moves_the_process_and_terminal_cwd(tmp_path, monkeypatch, capsys):
    project_path = tmp_path / "work" / "designs"
    _make_project("designs", project_path)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.delenv("TERMINAL_CWD", raising=False)

    CLISessionMixin._handle_projects_command(_cli(), "/projects designs")

    assert os.getcwd() == str(project_path)
    assert os.environ["TERMINAL_CWD"] == str(project_path)
    assert "designs" in capsys.readouterr().out
    with pdb.connect_closing() as conn:
        assert pdb.get_active_id(conn) is not None


def test_slug_and_case_insensitive_name_resolve(tmp_path, monkeypatch):
    project_path = tmp_path / "proj" / "camel"
    _make_project("CamelCase", project_path)
    monkeypatch.chdir(tmp_path)

    with pdb.connect_closing() as conn:
        projects = pdb.list_projects(conn)

    assert _resolve_project(projects, "camelcase") is not None
    assert _resolve_project(projects, "camel-case") is not None or _resolve_project(projects, projects[0].slug)
    assert _resolve_project(projects, "nope") is None


def test_missing_folder_refuses_the_move(tmp_path, monkeypatch, capsys):
    project_path = tmp_path / "gone"
    _make_project("gone", project_path)
    project_path.rmdir()
    monkeypatch.chdir(tmp_path)

    CLISessionMixin._handle_projects_command(_cli(), "/projects gone")

    assert os.getcwd() == str(tmp_path)
    assert "no usable folder" in capsys.readouterr().out


def test_slash_worker_reports_it_cannot_move_the_live_session(tmp_path, monkeypatch, capsys):
    """The TUI's slash worker is a shadow process: claiming a move there would be a lie."""
    project_path = tmp_path / "proj" / "tui"
    _make_project("tui", project_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TERMINAL_CWD", raising=False)

    CLISessionMixin._handle_projects_command(_cli(is_slash_worker=True), "/projects tui")

    assert os.getcwd() == str(tmp_path)
    assert "TERMINAL_CWD" not in os.environ
    assert "live session" in capsys.readouterr().out


def test_listing_marks_the_active_and_the_current_project(tmp_path):
    first = tmp_path / "a"
    second = tmp_path / "b"
    _make_project("alpha", first)
    _make_project("beta", second)
    with pdb.connect_closing() as conn:
        projects = pdb.list_projects(conn)
        pdb.set_active(conn, projects[0].id)
        active = pdb.get_active_id(conn)

    lines = _project_lines(projects, active, str(second / "nested" / "dir"))

    alpha, beta = lines
    assert "●" in alpha and "← here" not in alpha
    assert "← here" in beta and "●" not in beta
