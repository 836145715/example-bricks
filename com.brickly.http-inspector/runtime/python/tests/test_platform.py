import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from system_proxy import ProxyOwnershipError, ProxySnapshot, SystemProxyManager, restore_proxy


def test_restore_proxy_only_when_current_value_is_owned():
    calls = []
    snapshot = ProxySnapshot(original={"enabled": False, "server": ""}, applied={"enabled": True, "server": "127.0.0.1:8899"})
    restore_proxy(snapshot, lambda: {"enabled": True, "server": "127.0.0.1:8899"}, lambda value: calls.append(value))
    assert calls == [snapshot.original]


def test_restore_proxy_refuses_to_overwrite_third_party_change():
    snapshot = ProxySnapshot(original={"enabled": False}, applied={"enabled": True, "server": "127.0.0.1:8899"})
    try:
        restore_proxy(snapshot, lambda: {"enabled": True, "server": "other:8080"}, lambda _: None)
    except ProxyOwnershipError as exc:
        assert exc.code == "PROXY_OWNERSHIP_LOST"
    else:
        raise AssertionError("expected ownership error")


def test_system_proxy_manager_restores_only_its_owned_configuration():
    state = {"enabled": False, "server": "", "port": 0}
    applied = {"enabled": True, "server": "127.0.0.1", "port": 8899}
    manager = SystemProxyManager(
        read=lambda: dict(state),
        apply=lambda value: state.update(value),
    )

    manager.enable(8899)
    assert state == applied
    manager.restore()
    assert state == {"enabled": False, "server": "", "port": 0}


def test_system_proxy_manager_does_not_overwrite_changes_made_by_another_proxy():
    state = {"enabled": False, "server": "", "port": 0}
    manager = SystemProxyManager(
        read=lambda: dict(state),
        apply=lambda value: state.update(value),
    )

    manager.enable(8899)
    state.update({"server": "127.0.0.1", "port": 7890})
    try:
        manager.restore()
    except ProxyOwnershipError:
        pass
    else:
        raise AssertionError("expected ownership error")
