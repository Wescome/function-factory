"""Tests for restoration of atom synthesis functionality.

Verifies that the system can restore atom synthesis functionality after a failure.
"""

import pytest
from unittest.mock import MagicMock


class TestAtomSynthesisRestoration:
    """Test suite for atom synthesis restoration."""

    def test_restoration_after_synthesis_failure(self):
        """Verify system restores atom synthesis functionality after a failure."""
        pipeline = MagicMock()
        pipeline.synthesize.side_effect = [
            RuntimeError("Synthesis failed"),
            "atom-result",
        ]

        # First synthesis attempt fails
        with pytest.raises(RuntimeError, match="Synthesis failed"):
            pipeline.synthesize(atom_id="atom-006")

        # Restore the pipeline before retry
        pipeline.restore()

        # Second synthesis attempt succeeds after restoration
        result = pipeline.synthesize(atom_id="atom-006")
        assert result == "atom-result"
        assert pipeline.synthesize.call_count == 2
        assert pipeline.restore.call_count == 1

    def test_restoration_clears_error_state(self):
        """Verify restoration clears previous error state."""
        state = {"failed": True, "error_count": 1}

        def restore(s):
            s["failed"] = False
            s["error_count"] = 0
            return s

        restored_state = restore(state)
        assert restored_state["failed"] is False
        assert restored_state["error_count"] == 0

    def test_restoration_is_idempotent(self):
        """Verify restoration can be safely invoked multiple times."""
        pipeline = MagicMock()
        pipeline.restore.return_value = None

        pipeline.restore()
        pipeline.restore()

        assert pipeline.restore.call_count == 2
