def open_input_resource(resources, input_value):
    resource = input_value.get("resource") if isinstance(input_value, dict) else None
    if _is_handle(resource):
        return resource
    if not isinstance(resource, dict):
        raise ValueError("resource is required")
    return resources.open(resource)


def open_event_payload(resources, payload):
    if _is_handle(payload):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("resource"), dict):
        return resources.open(payload["resource"])
    raise ValueError("event payload must include a resource")


def _is_handle(value):
    return value is not None and callable(getattr(value, "stream", None))
