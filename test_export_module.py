"""Tests for export module public API surface."""

from export_module import ExtractionConfidence


def test_extraction_confidence_is_exported() -> None:
    """Verify that the ExtractionConfidence type is successfully included in exports."""
    assert ExtractionConfidence is not None
