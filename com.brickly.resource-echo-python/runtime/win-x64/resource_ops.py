import hashlib


def inspect_resource(resource, runtime="python", delay_ms=0, cancelled=None):
    if resource is None or not callable(getattr(resource, "stream", None)):
        raise ValueError("resource is required")
    digest = hashlib.sha256()
    size_bytes = 0
    chunk_count = 0
    with resource.stream() as chunks:
        for chunk in chunks:
            if cancelled and cancelled():
                error = RuntimeError("cancelled")
                error.code = "CANCELLED"
                raise error
            digest.update(chunk)
            size_bytes += len(chunk)
            chunk_count += 1
            if delay_ms > 0:
                import time
                time.sleep(delay_ms / 1000)
    return {
        "runtime": runtime,
        "sizeBytes": size_bytes,
        "chunkCount": chunk_count,
        "sha256": digest.hexdigest(),
        "mimeType": _mime_type(resource),
    }


def pattern_chunks(size_bytes, chunk_bytes=64 * 1024, byte=0x61):
    size_bytes = require_size(size_bytes)
    if not isinstance(chunk_bytes, int) or chunk_bytes <= 0:
        raise ValueError("chunkBytes is invalid")
    pattern = bytes((byte & 0xFF,)) * min(chunk_bytes, max(1, size_bytes))
    remaining = size_bytes
    while remaining > 0:
        length = min(remaining, len(pattern))
        yield pattern[:length]
        remaining -= length


def transformed_chunks(resource, mask=0x20):
    with resource.stream() as chunks:
        for chunk in chunks:
            yield bytes(value ^ mask for value in chunk)


def require_size(value):
    if isinstance(value, bool):
        raise ValueError("sizeBytes is invalid")
    size_bytes = int(value)
    if size_bytes < 0:
        raise ValueError("sizeBytes is invalid")
    return size_bytes


def _mime_type(resource):
    ref = getattr(resource, "ref", {})
    if isinstance(ref, dict):
        return ref.get("mimeType", "application/octet-stream")
    return getattr(ref, "mime_type", "application/octet-stream")
