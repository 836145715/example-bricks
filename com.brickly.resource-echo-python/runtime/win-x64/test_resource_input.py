import unittest

from resource_input import open_input_resource


class FakeResources:
    def __init__(self):
        self.opened = []

    def open(self, ref):
        self.opened.append(ref)
        return {"handle": ref}


class ResourceInputTest(unittest.TestCase):
    def test_opens_plain_resource_ref(self):
        resources = FakeResources()
        ref = {"kind": "brickly.resource", "resourceId": "res_python", "accessToken": "token"}
        self.assertEqual(open_input_resource(resources, {"resource": ref}), {"handle": ref})
        self.assertEqual(resources.opened, [ref])

    def test_rejects_missing_resource_before_open(self):
        with self.assertRaisesRegex(ValueError, "resource is required"):
            open_input_resource(FakeResources(), {})

    def test_already_open_handle_is_not_opened_again(self):
        resources = FakeResources()
        handle = type("Handle", (), {"stream": lambda self: None})()
        self.assertIs(open_input_resource(resources, {"resource": handle}), handle)
        self.assertEqual(resources.opened, [])

    def test_event_envelope_is_opened(self):
        from resource_input import open_event_payload

        resources = FakeResources()
        ref = {"kind": "brickly.resource", "resourceId": "res_event"}
        self.assertEqual(
            open_event_payload(resources, {"encoding": "json", "resource": ref}),
            {"handle": ref},
        )
        self.assertEqual(resources.opened, [ref])


if __name__ == "__main__":
    unittest.main()
