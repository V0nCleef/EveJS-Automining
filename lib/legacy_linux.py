"""Bounded legacy CCP archive operations and a read-only Linux client guard."""
from pathlib import Path
import ntpath
import os
import shutil
import stat
import sys
import tempfile
import zipfile

ENTRY = "eve/client/script/ui/eveCommands.pyj"
LIMIT = 2 * 1024**3


def regular(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Client archive operation requires ordinary files")
    return info


def inventory(archive):
    entries = archive.infolist()
    if len(entries) > 50000 or sum(e.file_size for e in entries) > LIMIT:
        raise ValueError("Client archive exceeds its size limit")
    names = [e.filename for e in entries]
    if len(set(names)) != len(names) or any(e.flag_bits & 1 for e in entries):
        raise ValueError("Client archive has duplicate or encrypted entries")
    entry = archive.getinfo(ENTRY)
    if entry.file_size > 32 * 1024**2:
        raise ValueError("Client command module exceeds its size limit")
    return entries


def stamp(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def read_entry(archive, output):
    if regular(archive).st_size > 512 * 1024**2:
        raise ValueError("Client archive exceeds its compressed size limit")
    if output.exists() or output.is_symlink():
        regular(output)
    with zipfile.ZipFile(archive) as source:
        inventory(source)
        with source.open(ENTRY) as content, output.open("wb") as stream:
            shutil.copyfileobj(content, stream, 1024 * 1024)


def replace_entry(archive, replacement):
    before = regular(archive)
    if before.st_size > 512 * 1024**2:
        raise ValueError("Client archive exceeds its compressed size limit")
    if regular(replacement).st_size > 32 * 1024**2:
        raise ValueError("Replacement client module exceeds its size limit")
    descriptor, name = tempfile.mkstemp(prefix=".automining-zip-", dir=archive.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w+b") as stream, zipfile.ZipFile(archive) as source:
            entries = inventory(source)
            with zipfile.ZipFile(stream, "w", allowZip64=True) as destination:
                destination.comment = source.comment
                for entry in entries:
                    with (replacement.open("rb") if entry.filename == ENTRY else source.open(entry)) as content:
                        with destination.open(entry, "w", force_zip64=True) as target:
                            shutil.copyfileobj(content, target, 1024 * 1024)
            stream.flush()
            os.fsync(stream.fileno())
        if stamp(regular(archive)) != stamp(before):
            raise ValueError("Client archive changed while preparing replacement")
        temporary.chmod(stat.S_IMODE(before.st_mode))
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)


def existing_executable(path):
    try:
        resolved = path.resolve(strict=True)
        return resolved if resolved.is_file() else None
    except (OSError, ValueError):
        return None


def wine_path(value, folder):
    """Resolve an actual EVE argv path, including Wine drive mappings."""
    if value.startswith("/"):
        return existing_executable(Path(value))
    drive, tail = ntpath.splitdrive(value)
    if drive:
        environment = {}
        try:
            for field in (folder / "environ").read_bytes().split(b"\0"):
                key, separator, data = field.partition(b"=")
                if separator and key == b"WINEPREFIX":
                    environment[key] = data.decode()
        except (OSError, UnicodeError):
            pass
        if drive.lower() == "z:":
            return existing_executable(Path("/" + tail.replace("\\", "/").lstrip("/")))
        prefix = environment.get(b"WINEPREFIX")
        if prefix:
            mapped = Path(prefix) / "dosdevices" / drive.lower()
            if mapped.exists():
                return existing_executable(mapped / tail.replace("\\", "/").lstrip("/"))
        return None
    try:
        current = (folder / "cwd").resolve(strict=True)
    except OSError:
        return None
    if "/" in value or "\\" in value:
        return existing_executable(current / value.replace("\\", "/"))
    # A basename with no usable path cannot prove that another client is safe.
    candidate = current / value
    return existing_executable(candidate)


def ensure_stopped(root):
    root = root.resolve(strict=True)
    for folder in Path("/proc").iterdir():
        if not folder.name.isdigit() or int(folder.name) == os.getpid():
            continue
        try:
            comm = (folder / "comm").read_text().strip().lower()
        except FileNotFoundError:
            continue
        except OSError as error:
            raise ValueError("Cannot verify that EVE clients are stopped") from error
        try:
            arguments = [p.decode() for p in (folder / "cmdline").read_bytes().split(b"\0") if p]
        except FileNotFoundError:
            continue
        except (OSError, UnicodeError) as error:
            if comm == "exefile.exe":
                raise ValueError("Cannot verify that EVE clients are stopped") from error
            continue
        candidates = [p for p in arguments if ntpath.basename(p).lower() == "exefile.exe"]
        if not candidates and comm != "exefile.exe":
            continue
        resolved = [wine_path(p, folder) for p in candidates]
        # Wine resolves Windows spelling without Unix case sensitivity. Even an
        # existing path may retain different spelling on a case-insensitive
        # mount; use physical identity without folding distinct Unix directories.
        try:
            selected = not resolved or any(p is None or any(
                root.samefile(parent) for parent in (p, *p.parents)) for p in resolved)
        except OSError as error:
            raise ValueError("Cannot verify that EVE clients are stopped") from error
        if selected:
            raise ValueError("Close EVE clients using this client installation before applying AutoMining client changes.")


def main():
    action, *arguments = sys.argv[1:]
    if action == "stopped" and len(arguments) == 1:
        ensure_stopped(Path(arguments[0]))
    elif action == "read" and len(arguments) == 2:
        read_entry(*(Path(p) for p in arguments))
    elif action == "replace" and len(arguments) == 2:
        replace_entry(*(Path(p) for p in arguments))
    else:
        raise ValueError("Unsupported Linux archive operation")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
