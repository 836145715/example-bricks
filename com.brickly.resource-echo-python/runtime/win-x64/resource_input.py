def open_input_resource(resources, input_value):
    resource_ref = input_value.get("resource") if isinstance(input_value, dict) else None
    if not isinstance(resource_ref, dict):
        raise ValueError("resource is required")
    return resources.open(resource_ref)
