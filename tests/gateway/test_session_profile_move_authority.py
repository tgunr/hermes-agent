"""``session.profile.move`` as served by the gateway session authority.

The desktop's local connection always has a session authority attached
(``gateway/run_api.py``), and ``tui_gateway/ws.py`` refuses to fall back to a legacy
handler for any ``session.*`` verb the authority answers ``-32601`` for. So the move
must live on the authority — these tests exercise that handler directly (no socket).
"""

import asyncio
from types import SimpleNamespace

import pytest


def _connection(source_home, capabilities=('session:control',), sessions=None):
    from gateway.session_controls import AuthorityConnection

    conn = AuthorityConnection.__new__(AuthorityConnection)  # no transport/identity needed here
    conn.authority = SimpleNamespace(profile_id=str(source_home), sessions=sessions or {})
    conn.actor = SimpleNamespace(capabilities=set(capabilities))
    return conn


def _homes(tmp_path, monkeypatch):
    from hermes_state import SessionDB

    root = tmp_path / "root"
    source = root
    target = root / "profiles" / "bee"
    target.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(root))
    return source, target, SessionDB


def _move(conn, **params):
    from gateway.session_controls import AuthorityConnection

    return asyncio.run(AuthorityConnection.profile_move(conn, None, params))


def test_moves_the_row_and_archives_the_source(tmp_path, monkeypatch):
    # Transcript rows are covered by tests/tui_gateway/test_session_profile_move.py, which shares
    # this one adopt primitive: appending a message here would import the agent stack, and that
    # import reads the REAL checkout (HomeIOGuard) when this file runs on its own.
    source, target, SessionDB = _homes(tmp_path, monkeypatch)
    with SessionDB(source / "state.db") as db:
        db.create_session("sid1", "cli")
        db.set_session_title("sid1", "AUTHORITY MOVE")

    result = _move(_connection(source), session_key="sid1", to_profile="bee")
    assert result == {"session_key": "sid1", "profile": "bee", "donor_retired": True}

    with SessionDB(target / "state.db") as db:
        assert db.get_session("sid1")["title"] == "AUTHORITY MOVE"

    with SessionDB(source / "state.db") as db:
        row = db.get_session("sid1")
        assert (row["end_reason"], row["archived"]) == ("adopted_by_profile", 1)


def test_refusals(tmp_path, monkeypatch):
    from hermes_state import SessionDB

    source, target, _ = _homes(tmp_path, monkeypatch)
    with SessionDB(source / "state.db") as db:
        db.create_session("sid1", "cli")
    with SessionDB(source / "state.db") as db:
        db.create_session("dup", "cli")
    with SessionDB(target / "state.db") as db:
        db.create_session("dup", "cli")

    def reason(conn, **params):
        from hermes_state_runtime import RuntimeStoreError

        with pytest.raises(RuntimeStoreError) as exc:
            _move(conn, **params)
        return exc.value.reason

    assert reason(_connection(source), session_key="sid1", to_profile="default") == "invalid_params"
    assert reason(_connection(source), session_key="nope", to_profile="bee") == "not_found"
    assert reason(_connection(source), session_key="dup", to_profile="bee") == "admission_conflict"
    assert reason(_connection(source, capabilities=()), session_key="sid1", to_profile="bee") == "permission_denied"
    assert reason(_connection(source, sessions={"sid1": object()}), session_key="sid1",
                  to_profile="bee") == "session_busy"
    assert reason(_connection(source), session_key="sid1", to_profile="../escape") == "invalid_params"
