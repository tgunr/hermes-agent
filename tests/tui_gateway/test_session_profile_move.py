"""``session.profile.move``: move one stored session between two profiles' state.db files.

The verb is the profile-side twin of ``session.workspace.move``: the desktop's session menu grows a
"Move to profile" submenu, and the backend must (a) carry the whole compression lineage, (b) archive
the source rows (never delete — an accidental move stays recoverable), and (c) refuse the cases that
would corrupt a store: a busy session, a retry that would silently re-adopt, and a no-op move.
"""

import pytest


@pytest.fixture
def homes(tmp_path, monkeypatch):
    from tui_gateway import server

    launch = tmp_path / "root"
    bee = launch / "profiles" / "bee"
    bee.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setattr(server, "_hermes_home", launch)
    monkeypatch.setattr(server, "_db", None)
    return server, launch, bee


def _move(server, **params):
    return server._methods["session.profile.move"](1, params)


def test_moves_session_and_archives_the_source(homes):
    from hermes_state import SessionDB

    server, launch, bee = homes
    with SessionDB(launch / "state.db") as db:
        db.create_session("sid1", "cli")
        db.set_session_title("sid1", "MOVE ME")
        db.append_message("sid1", "user", "hello")
        db.append_message("sid1", "assistant", "hi there")

    res = _move(server, session_key="sid1", to_profile="bee")
    assert "error" not in res, res
    assert res["result"] == {"session_key": "sid1", "profile": "bee", "donor_retired": True}

    with SessionDB(bee / "state.db") as db:
        assert db.get_session("sid1")["title"] == "MOVE ME"
        assert [m["content"] for m in db.get_messages("sid1")] == ["hello", "hi there"]

    # Source rows stay put (recoverable in the Archived view) — retirement archives, never deletes.
    with SessionDB(launch / "state.db") as db:
        assert db.get_session("sid1")["end_reason"] == "adopted_by_profile"
        assert db.get_session("sid1")["archived"] == 1
        assert len(db.get_messages("sid1", include_inactive=True)) == 2


def test_refuses_a_second_move_of_the_same_id(homes):
    from hermes_state import SessionDB

    server, launch, bee = homes
    with SessionDB(launch / "state.db") as db:
        db.create_session("sid1", "cli")
    with SessionDB(bee / "state.db") as db:
        db.create_session("sid1", "cli")

    res = _move(server, session_key="sid1", to_profile="bee")
    assert res["error"]["code"] == 4000
    assert "already exists in profile 'bee'" in res["error"]["message"]


def test_refuses_a_move_to_the_same_profile(homes):
    from hermes_state import SessionDB

    server, launch, _bee = homes
    with SessionDB(launch / "state.db") as db:
        db.create_session("sid1", "cli")

    res = _move(server, session_key="sid1", to_profile="default")
    assert res["error"]["code"] == 4000
    assert "already belongs to profile" in res["error"]["message"]


def test_unknown_session_and_missing_params(homes):
    server, _launch, _bee = homes
    assert _move(server, to_profile="bee")["error"]["code"] == 4007
    assert _move(server, session_key="sid1")["error"]["code"] == 4006
    assert _move(server, session_key="nope", to_profile="bee")["error"]["code"] == 4007


def test_refuses_while_the_session_is_running(homes, monkeypatch):
    import threading

    from hermes_state import SessionDB

    server, launch, bee = homes
    with SessionDB(launch / "state.db") as db:
        db.create_session("sid1", "cli")
    monkeypatch.setitem(server._sessions, "runtime1", {
        "session_key": "sid1", "running": True, "history": [], "history_lock": threading.Lock()})

    res = _move(server, session_key="sid1", to_profile="bee")
    assert res["error"]["code"] == 4009
    with SessionDB(bee / "state.db") as db:
        assert db.get_session("sid1") is None
