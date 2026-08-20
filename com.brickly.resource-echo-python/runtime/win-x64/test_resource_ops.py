import contextlib
import hashlib
import unittest

from resource_ops import inspect_resource, pattern_chunks


class FakeResource:
    ref = type("Ref", (), {"mime_type": "text/plain"})()

    @contextlib.contextmanager
    def stream(self):
        yield iter((b"hello ", b"resource"))


class ResourceOpsTest(unittest.TestCase):
    def test_inspect_counts_chunks_bytes_and_hash(self):
        self.assertEqual(
            inspect_resource(FakeResource(), "python"),
            {
                "runtime": "python",
                "sizeBytes": 14,
                "chunkCount": 2,
                "sha256": hashlib.sha256(b"hello resource").hexdigest(),
                "mimeType": "text/plain",
            },
        )

    def test_pattern_chunks_are_bounded(self):
        chunks = list(pattern_chunks(1024 * 1024 + 17, 64 * 1024, 0x61))
        self.assertEqual(sum(map(len, chunks)), 1024 * 1024 + 17)
        self.assertEqual(len(chunks), 17)
        self.assertTrue(all(len(chunk) <= 64 * 1024 for chunk in chunks))
        self.assertEqual(chunks[0][0], 0x61)


if __name__ == "__main__":
    unittest.main()
