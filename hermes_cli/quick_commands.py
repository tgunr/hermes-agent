"""Shared ``quick_commands`` (``type: exec``) argument substitution.

Quick commands run shell snippets from config.yaml. The user's typed args must be
injected into ``$1``/``$@`` placeholders — otherwise they expand to empty in the
subprocess shell and commands like /route, /classify, /optimize, /am receive no prompt.

Used by all three dispatch paths: ``cli.py`` (``_run_quick_command``),
``gateway/run_inbound.py`` (``_hm_dispatch_quick_and_plugin_commands``), and
``tui_gateway/methods_tools.py`` (``_dispatch_quick``).
"""

from __future__ import annotations

__all__ = ["substitute_quick_command_args"]


def substitute_quick_command_args(cmd: str, arg: str) -> str:
    """Return *cmd* with ``$1``/``$@`` replaced by the shell-quoted *arg*.

    The config may wrap ``$1`` in quotes (e.g. ``"...$1"`` or ``'$1'``); replace the
    entire quoted form so ``shlex.quote()`` output (single-quoted) isn't nested
    inside double quotes where single quotes become literal characters.

    ``$1`` = whole arg as ONE argument; ``$@`` = each word as its own argument
    (for subcommand-style scripts like ``am.py search <query>``).
    """
    if not arg:
        return cmd
    import shlex
    quoted_one = shlex.quote(arg)
    quoted_all = " ".join(shlex.quote(w) for w in shlex.split(arg))
    # Replace quoted forms first (full match including surrounding quotes)
    cmd = cmd.replace('"$1"', quoted_one).replace('"$@"', quoted_all)
    cmd = cmd.replace("'$1'", quoted_one).replace("'$@'", quoted_all)
    # Fallback: bare $1/$@ (no quotes in config)
    cmd = cmd.replace("$1", quoted_one).replace("$@", quoted_all)
    return cmd
