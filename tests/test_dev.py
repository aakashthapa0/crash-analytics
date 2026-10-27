"""The local launcher must clean up a running server when its peer fails."""
import os
import subprocess
import sys

import pytest

from scripts import dev


@pytest.mark.skipif(os.name != 'posix', reason='The launcher targets macOS/Linux')
@pytest.mark.parametrize('failure', ['server_exit', 'spawn_error'])
def test_launcher_stops_started_servers_on_failure(monkeypatch, failure):
    popen = subprocess.Popen
    servers = []

    def start(command, **options):
        if servers and failure == 'spawn_error':
            raise FileNotFoundError('npm')
        program = 'import time; time.sleep(60)' if not servers else 'raise SystemExit(7)'
        server = popen([sys.executable, '-c', program], **options)
        servers.append(server)
        return server

    monkeypatch.setattr(dev.subprocess, 'Popen', start)
    monkeypatch.setattr(dev.signal, 'signal', lambda *args: None)
    try:
        if failure == 'spawn_error':
            with pytest.raises(FileNotFoundError):
                dev.main()
        else:
            assert dev.main() == 7
        assert servers and all(server.poll() is not None for server in servers)
    finally:
        for server in servers:
            if server.poll() is None:
                server.kill()
            server.wait()
