"""The API archive must run without frontend files or a frontend build."""
import subprocess
import sys
import zipfile
from unittest.mock import patch

from scripts import package_lambda


def test_api_package_runs_without_frontend(tmp_path, monkeypatch):
    archive_path = tmp_path / 'lambda.zip'
    monkeypatch.setattr(package_lambda, 'ARCHIVE', archive_path)
    # Dependency installation is unchanged; exercise payload packaging without network access.
    with patch.object(package_lambda.subprocess, 'run') as install:
        package_lambda.main()
        install.assert_called_once()

    extracted = tmp_path / 'extracted'
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        assert 'crash_app/api.py' in names
        assert 'data/crashes.sqlite' in names
        assert not any(name.startswith('frontend/') for name in names)
        archive.extractall(extracted)

    # A fresh process imports the packaged API, not the checkout's cached modules.
    subprocess.run([
        sys.executable, '-I', '-c',
        "import sys; sys.path.insert(0, sys.argv[1]); "
        "from crash_app.api import app, handler; "
        "from fastapi.testclient import TestClient; "
        "client = TestClient(app); "
        "assert client.get('/health').json() == {'status': 'ok'}; "
        "assert client.get('/api/v1/severity').json()['total_crashes'] == 24261; "
        "assert client.get('/').status_code == 404", str(extracted),
    ], cwd=extracted, check=True, capture_output=True, text=True)
