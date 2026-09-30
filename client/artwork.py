# Download only the four fixed job banners, after the HUD is usable. Native
# cache paths are content-addressed; images stay outside login/state polling.
_am_art_paths = {}
_am_art_busy = False
_am_art_window = None


def _am_load_job_artwork(window):
    global _am_art_window, _am_art_busy
    _am_art_window = window
    window.ApplyJobArtwork(_am_art_paths)
    if len(_am_art_paths) == 4 or _am_art_busy:
        return
    _am_art_busy = True
    _am_uthread.new(_am_fetch_job_artwork)


def _am_fetch_job_artwork():
    global _am_art_busy
    import base64
    import hashlib
    import os
    import re
    limit = 4 * 1024 * 1024
    jobs = ('mining', 'hauling', 'boosting', 'pve')
    char = getattr(session, 'charid', None)

    def cached(filename, size, digest):
        try:
            with open(filename, 'rb') as source:
                body = source.read(limit + 1)
            return len(body) == size and hashlib.sha256(body).hexdigest() == digest
        except (IOError, OSError):
            return False

    try:
        remote = sm.RemoteSvc('miningScanMgr')
        reply = _am_json.loads(remote.AutoMiningJobArtwork())
        rows = reply.get('artwork', {})
        if not char or not reply.get('success') or set(rows) != set(jobs):
            return
        for job in jobs:
            if getattr(session, 'charid', None) != char:
                return
            row = rows[job]
            size, digest = row.get('bytes'), row.get('sha256', '')
            if not isinstance(size, (int, long)) or isinstance(size, bool) or not 24 <= size <= limit or not re.match(r'^[a-f0-9]{64}$', digest):
                return
            resource = 'cache:/Pictures/AutoMining/jobs/%s-%s.png' % (job, digest)
            filename = _am_blue.paths.ResolvePathForWriting(resource)
            if not cached(filename, size, digest):
                chunks, offset = [], 0
                while offset < size:
                    if getattr(session, 'charid', None) != char:
                        return
                    data = _am_json.loads(remote.AutoMiningJobArtwork(job, digest, offset))
                    encoded = data.get('chunk', '')
                    if not data.get('success') or data.get('job') != job or data.get('sha256') != digest or data.get('offset') != offset or data.get('bytes') != size or len(encoded) > 174764 or not re.match(r'^[A-Za-z0-9+/]+={0,2}$', encoded):
                        raise ValueError('Invalid artwork chunk')
                    chunk = base64.b64decode(encoded)
                    if len(chunk) != min(128 * 1024, size - offset):
                        raise ValueError('Invalid artwork size')
                    chunks.append(chunk)
                    offset += len(chunk)
                    _am_blue.pyos.synchro.SleepWallclock(1)
                body = b''.join(chunks)
                if not body.startswith(b'\x89PNG\r\n\x1a\n') or hashlib.sha256(body).hexdigest() != digest:
                    raise ValueError('Invalid artwork hash')
                folder = os.path.dirname(filename)
                if not os.path.isdir(folder):
                    try:
                        os.makedirs(folder)
                    except OSError:
                        if not os.path.isdir(folder):
                            raise
                temporary = filename + '.tmp-%s' % os.getpid()
                try:
                    with open(temporary, 'wb') as target:
                        target.write(body)
                    if not cached(filename, size, digest):
                        if os.path.exists(filename):
                            os.remove(filename)
                        try:
                            os.rename(temporary, filename)
                        except OSError:
                            if not cached(filename, size, digest):
                                raise
                finally:
                    if os.path.exists(temporary):
                        os.remove(temporary)
            _am_art_paths[job] = resource
            if _am_art_window and not getattr(_am_art_window, 'destroyed', False):
                _am_art_window.ApplyJobArtwork({job: resource})
    except Exception:
        print('AUTOMINING_ARTWORK:UNAVAILABLE')
    finally:
        _am_art_busy = False
