"""Tests for the permutation generator. Run: python -m pytest tests/"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.permutations import generate_permutations


def test_basic_name():
    out = generate_permutations("Jamie", "Lee", "notion.so")
    assert "jamie.lee@notion.so" in out
    assert "jlee@notion.so" in out
    assert "jamie@notion.so" in out
    assert out[0] == "jamie.lee@notion.so"  # highest priority
    assert all("@notion.so" in e for e in out)
    assert len(out) == len(set(out)), "duplicates returned"


def test_diacritics():
    out = generate_permutations("José", "Garcia", "example.com")
    # All output should be ASCII lowercase
    assert all(e.isascii() for e in out)
    assert "jose.garcia@example.com" in out
    assert "jgarcia@example.com" in out


def test_compound_first_name():
    out = generate_permutations("Mary Jane", "Smith", "example.com")
    # Should produce both compound and single-token versions
    assert "maryjane.smith@example.com" in out
    assert "mary.smith@example.com" in out


def test_compound_last_name():
    out = generate_permutations("Maria", "Garcia Lopez", "example.com")
    assert "maria.garcialopez@example.com" in out
    # Also includes last-token-only form
    assert "maria.lopez@example.com" in out


def test_hyphenated_last_name():
    out = generate_permutations("Anne", "Smith-Jones", "example.com")
    assert "anne.smithjones@example.com" in out
    assert "anne.jones@example.com" in out


def test_middle_name():
    out = generate_permutations("John", "Doe", "example.com", middle_name="Quincy")
    assert "john.q.doe@example.com" in out
    assert "jqdoe@example.com" in out


def test_apostrophe_stripped():
    out = generate_permutations("Sean", "O'Brien", "example.com")
    assert "sean.obrien@example.com" in out


def test_domain_with_at_prefix():
    out = generate_permutations("Jamie", "Lee", "@notion.so")
    assert all(e.endswith("@notion.so") for e in out)


def test_missing_name_raises():
    import pytest

    with pytest.raises(ValueError):
        generate_permutations("", "Lee", "example.com")
    with pytest.raises(ValueError):
        generate_permutations("Jamie", "", "example.com")


def test_invalid_domain_raises():
    import pytest

    with pytest.raises(ValueError):
        generate_permutations("Jamie", "Lee", "nodot")


if __name__ == "__main__":
    # Lightweight runner if pytest isn't installed
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
