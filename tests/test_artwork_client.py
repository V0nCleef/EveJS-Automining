"""Author-run cache/RPC tests; native GPU rendering is deliberately separate."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest

root = Path(__file__).resolve().parents[1]
jobs = ('mining', 'hauling', 'boosting', 'pve')
manifest = json.loads((root / 'assets/jobs/manifest.json').read_text())
bodies = {job: (root / 'assets/jobs' / (job + '.png')).read_bytes() for job in jobs}


class ArtworkTests(unittest.TestCase):
    def fixture(self, folder, corrupt=False):
        queue, calls, updates = [], [], []
        session = NS(charid=42)
        class Remote:
            def AutoMiningJobArtwork(self, *args):
                calls.append(args)
                if not args:
                    return json.dumps(dict(success=True, artwork=manifest))
                job, digest, offset = args
                body = bodies[job][offset:offset + 128 * 1024]
                if corrupt:
                    body = b'x' + body[1:]
                return json.dumps(dict(success=True, job=job, sha256=digest, offset=offset,
                                       bytes=manifest[job]['bytes'], chunk=base64.b64encode(body).decode()))
        env = dict(long=int, session=session, sm=NS(RemoteSvc=lambda _: Remote()), _am_json=json,
                   _am_uthread=NS(new=lambda f: queue.append(f)),
                   _am_blue=NS(paths=NS(ResolvePathForWriting=lambda p: str(folder / p.split('cache:/')[1])),
                               pyos=NS(synchro=NS(SleepWallclock=lambda _: None))))
        exec((root / 'client/artwork.py').read_text(), env)
        window = NS(destroyed=False, ApplyJobArtwork=lambda paths: updates.append(dict(paths)))
        return env, window, queue, calls, updates

    def test_background_load_exact_approved_pngs_then_reopen_without_rpc(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            env, window, queue, calls, updates = self.fixture(folder)
            env['_am_load_job_artwork'](window)
            self.assertEqual(calls, [])
            env['_am_load_job_artwork'](window)
            self.assertEqual(len(queue), 1)
            queue.pop()()
            self.assertFalse(env['_am_art_busy'])
            self.assertEqual(set(env['_am_art_paths']), set(jobs))
            for job, resource in env['_am_art_paths'].items():
                body = (folder / resource.split('cache:/')[1]).read_bytes()
                self.assertEqual(body, bodies[job])
                self.assertEqual(hashlib.sha256(body).hexdigest(), manifest[job]['sha256'])
            self.assertEqual(len(updates), 6)
            before = len(calls)
            env['_am_load_job_artwork'](window)
            self.assertEqual(len(calls), before)
            self.assertEqual(queue, [])
            # A new client session verifies its disk cache but fetches no chunks.
            env2, window2, queue2, calls2, _ = self.fixture(folder)
            env2['_am_load_job_artwork'](window2)
            queue2.pop()()
            self.assertEqual(calls2, [()])

    def test_bad_chunks_keep_native_fallback_and_leave_no_file(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            env, window, queue, _, _ = self.fixture(folder, corrupt=True)
            env['_am_load_job_artwork'](window)
            queue.pop()()
            self.assertFalse(env['_am_art_busy'])
            self.assertEqual(env['_am_art_paths'], {})
            self.assertEqual(list(folder.rglob('*.png')), [])

    def test_changed_character_and_closed_window_are_not_updated(self):
        with tempfile.TemporaryDirectory() as directory:
            env, window, queue, calls, updates = self.fixture(Path(directory))
            env['_am_load_job_artwork'](window)
            window.destroyed = True
            env['session'].charid = None
            queue.pop()()
            self.assertEqual(calls, [()])
            self.assertEqual(updates, [{}])
            self.assertEqual(env['_am_art_paths'], {})

    def test_corrupt_disk_cache_is_repaired_with_atomic_write_and_no_temp_left(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            filename = folder / ('Pictures/AutoMining/jobs/mining-' + manifest['mining']['sha256'] + '.png')
            filename.parent.mkdir(parents=True)
            filename.write_bytes(b'broken')
            env, window, queue, _, _ = self.fixture(folder)
            env['_am_load_job_artwork'](window)
            queue.pop()()
            self.assertEqual(filename.read_bytes(), bodies['mining'])
            self.assertEqual(list(folder.rglob('*.tmp-*')), [])


if __name__ == '__main__':
    unittest.main()
