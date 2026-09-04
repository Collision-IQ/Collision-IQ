"""Run the fixture tests with or without pytest:  python -m collision_iq.tests.run_tests"""
import inspect, tempfile, pathlib, traceback, sys
from . import test_fixture_21011 as T
from . import test_fixture_frk2 as T2
from . import test_nomenclature as T3
from . import test_fixture_frk3 as T4

def main():
    M = T.parse_mitchell(T.MITCH)
    passed = failed = 0
    for mod in (T, T2, T3, T4):
      for name, fn in inspect.getmembers(mod, inspect.isfunction):
        if not name.startswith("test_"): continue
        kw = {}
        if "M" in inspect.signature(fn).parameters: kw["M"] = M
        if "tmp_path" in inspect.signature(fn).parameters: kw["tmp_path"] = pathlib.Path(tempfile.mkdtemp())
        try:
            fn(**kw); passed += 1; print("PASS", name)
        except Exception:
            failed += 1; print("FAIL", name); traceback.print_exc()
    print(f"{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
