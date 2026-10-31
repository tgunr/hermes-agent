"""/projects on the messaging/desktop gateway: list everywhere, never claim a move it can't make."""

import asyncio

import pytest


class _Event:
    """Just enough MessageEvent for the handler: it reads only the command args."""

    def __init__(self, args=""):
        self.text = ("/projects " + args).strip()

    def get_command_args(self):
        return self.text.split(None, 1)[1] if " " in self.text else ""


@pytest.fixture()
def empty_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


def test_projects_is_a_handler_control_command():
    """The canonical transport admits /projects as a control command (not ``refused``)."""
    from gateway.session_commands import command_verdict

    assert command_verdict("projects") == "control"


def test_projects_is_dispatched_on_the_idle_path():
    """Idle dispatch resolves the name to a real handler, so the name cannot 400 at runtime."""
    from gateway.run_busy import GatewayBusySessionMixin
    from gateway.slash_commands_session import GatewaySessionCommandsMixin

    assert "projects" in GatewayBusySessionMixin._IDLE_COMMANDS

    class _Runner(GatewaySessionCommandsMixin, GatewayBusySessionMixin):
        _COMMAND_HANDLER_ALIASES = {}

    table = GatewayBusySessionMixin._command_handler_table(_Runner.__new__(_Runner), ["projects"])
    assert table["projects"].__name__ == "_handle_projects_command"


def test_projects_lists_on_a_fresh_profile(empty_home):
    """An empty profile says so instead of failing — listing works on every surface."""
    from gateway.slash_commands_session import GatewaySessionCommandsMixin

    out = asyncio.run(GatewaySessionCommandsMixin._handle_projects_command(object(), _Event()))
    assert "No Projects yet" in out


def test_projects_rejects_an_unknown_name(empty_home):
    from gateway.slash_commands_session import GatewaySessionCommandsMixin

    out = asyncio.run(GatewaySessionCommandsMixin._handle_projects_command(object(), _Event("nope")))
    assert "No Project matches" in out
