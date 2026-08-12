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


if __name__ == "__main__":
    unittest.main()
