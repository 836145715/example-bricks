import threading

from brickly import BricklyRuntime

from resource_ops import inspect_resource, pattern_chunks, require_size, transformed_chunks
from resource_input import open_input_resource


BRICK_ID = "com.brickly.resource-echo-python"
brick = BricklyRuntime(BRICK_ID)
last_event = None


@brick.on_command("inspect")
def inspect(_ctx, input_value):
    return inspect_resource(open_input_resource(brick.resources, input_value))


@brick.on_command("produce")
def produce(_ctx, input_value):
    size_bytes = require_size(input_value.get("sizeBytes"))
    return brick.resources.create_from(
        pattern_chunks(size_bytes, input_value.get("chunkBytes", 64 * 1024), input_value.get("byte", 0x61)),
        expected_size_bytes=size_bytes,
        mime_type=input_value.get("mimeType", "application/octet-stream"),
        name=input_value.get("name", f"python-{size_bytes}.bin"),
        ttl_ms=input_value.get("ttlMs"),
    )


@brick.on_command("transform")
def transform(_ctx, input_value):
    resource = open_input_resource(brick.resources, input_value)
    return brick.resources.create_from(
        transformed_chunks(resource, input_value.get("mask", 0x20)),
        expected_size_bytes=resource.ref["sizeBytes"],
        mime_type=resource.ref.get("mimeType", "application/octet-stream"),
        name=f"python-transformed-{resource.ref.get('name', 'resource.bin')}",
    )


@brick.on_command("relay")
def relay(ctx, input_value):
    target_alias = str(input_value.get("targetAlias", ""))
    if not target_alias:
        raise ValueError("targetAlias is required")
    target_input = dict(input_value.get("targetInput") or {})
    target_input["resource"] = input_value.get("resource")
    return ctx.dependencies.require(target_alias).invoke(
        input_value.get("targetCommandId", "inspect"), target_input
    )


@brick.on_command("hold")
def hold(ctx, input_value):
    cancelled = threading.Event()
    ctx.on_cancel(cancelled.set)
    return inspect_resource(
        open_input_resource(brick.resources, input_value),
        delay_ms=int(input_value.get("delayMs", 25)),
        cancelled=cancelled.is_set,
    )


@brick.on_command("event-last")
def event_last(_ctx, _input_value):
    return last_event


def on_probe(payload, _envelope):
    global last_event
    try:
        if not isinstance(payload, dict):
            raise ValueError("event payload is required")
        last_event = {"runtime": "python", "received": True, "probeId": payload.get("probeId")}
    except Exception as error:
        last_event = {"runtime": "python", "errorCode": getattr(error, "code", "INTERNAL_ERROR")}


brick.events.on("resource-lab:probe", on_probe)
brick.start()
