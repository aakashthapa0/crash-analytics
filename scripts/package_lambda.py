"""Build the API-only Lambda ZIP with Linux x86_64 / Python 3.13 dependencies.

Run from any directory: python scripts/package_lambda.py
The build is deliberately outside source control. No AWS credentials are read.
"""
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'dist' / 'lambda.zip'


def main():
    # Verify the cleaned database snapshot exists before packaging
    if not (ROOT / 'data' / 'crashes.sqlite').exists():
        raise SystemExit('Build data/crashes.sqlite before packaging')

    # Stage dependencies and application files in an ephemeral OS temporary directory
    # so no build/ clutter lingers in the workspace.
    with tempfile.TemporaryDirectory() as temp_dir:
        target = Path(temp_dir)

        # Download pre-built Linux x86_64 wheels for Python 3.13;
        # this ensures native C extensions (Pydantic Core) work in AWS Lambda even when built on macOS.
        subprocess.run([
            sys.executable, '-m', 'pip', 'install', '--requirement', str(ROOT / 'requirements.txt'),
            '--target', str(target), '--platform', 'manylinux2014_x86_64',
            '--platform', 'manylinux_2_28_x86_64', '--implementation', 'cp',
            '--python-version', '3.13', '--only-binary=:all:', '--no-compile',
        ], check=True)

        # Copy application packages and data snapshot, excluding pycache and raw data files
        # Preserve the deployed crash_app.api.handler entry point during code-only updates.
        shutil.copytree(ROOT / 'backend', target / 'crash_app',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        shutil.copytree(ROOT / 'data', target / 'data',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.csv', 'raw'))

        # Create the final distribution zip with maximum compression for quick Lambda cold starts
        ARCHIVE.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(ARCHIVE, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(target.rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                    archive.write(path, path.relative_to(target))
        print(f'Lambda archive: {ARCHIVE} ({ARCHIVE.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
