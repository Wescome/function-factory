"""
Test failure detection for atom synthesis.

Verifies that the system can detect and report atom synthesis failures.
"""

import pytest
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum


class SynthesisStatus(Enum):
    SUCCESS = "success"
    FAILURE = "failure"


@dataclass
class SynthesisResult:
    atom_id: str
    status: SynthesisStatus
    error: Optional[str] = None


class FailureDetector:
    """Detects failed atom synthesis results."""

    def detect(self, results: List[SynthesisResult]) -> List[SynthesisResult]:
        return [result for result in results if result.status == SynthesisStatus.FAILURE]


class TestFailureDetection:
    """Tests for atom synthesis failure detection."""

    def test_detects_single_failure(self) -> None:
        results = [
            SynthesisResult(atom_id="atom-001", status=SynthesisStatus.SUCCESS),
            SynthesisResult(
                atom_id="atom-002", status=SynthesisStatus.FAILURE, error="Compilation failed"
            ),
        ]
        detector = FailureDetector()
        failures = detector.detect(results)

        assert len(failures) == 1
        assert failures[0].atom_id == "atom-002"
        assert failures[0].error == "Compilation failed"

    def test_detects_multiple_failures(self) -> None:
        results = [
            SynthesisResult(
                atom_id="atom-003", status=SynthesisStatus.FAILURE, error="Timeout"
            ),
            SynthesisResult(
                atom_id="atom-004", status=SynthesisStatus.FAILURE, error="Syntax error"
            ),
        ]
        detector = FailureDetector()
        failures = detector.detect(results)

        assert len(failures) == 2
        assert {f.atom_id for f in failures} == {"atom-003", "atom-004"}

    def test_no_false_positives_for_successful_atoms(self) -> None:
        results = [
            SynthesisResult(atom_id="atom-005", status=SynthesisStatus.SUCCESS),
            SynthesisResult(atom_id="atom-006", status=SynthesisStatus.SUCCESS),
        ]
        detector = FailureDetector()
        failures = detector.detect(results)

        assert failures == []

    def test_empty_results(self) -> None:
        detector = FailureDetector()
        failures = detector.detect([])

        assert failures == []
