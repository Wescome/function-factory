"""
Restoration module for atom synthesis pipeline.

Provides mechanisms to recover from atom synthesis failures by tracking
failure state, applying retry policies, and restoring atoms to a queue
for re-synthesis.
"""

import time
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Callable

logger = logging.getLogger(__name__)


class AtomStatus(Enum):
    PENDING = "pending"
    SYNTHESIZING = "synthesizing"
    FAILED = "failed"
    RESTORED = "restored"
    COMPLETED = "completed"


@dataclass
class Atom:
    id: str
    type: str
    title: str
    status: AtomStatus = AtomStatus.PENDING
    retry_count: int = 0
    max_retries: int = 3
    last_error: Optional[str] = None
    metadata: Dict = field(default_factory=dict)


class RestorationError(Exception):
    """Raised when restoration of an atom fails irrecoverably."""
    pass


class AtomSynthesisRestorer:
    """
    Restores atom synthesis functionality after failures.

    Tracks atom states, applies retry logic with exponential backoff,
    and re-queues failed atoms for synthesis.
    """

    def __init__(self, max_retries: int = 3, base_delay: float = 1.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self._atoms: Dict[str, Atom] = {}
        self._failure_log: List[Dict] = []
        self._restoration_hooks: List[Callable[[Atom], None]] = []

    def register_atom(self, atom: Atom) -> None:
        """Register an atom for tracking and potential restoration."""
        if atom.id in self._atoms:
            logger.warning("Atom %s already registered; updating state.", atom.id)
        self._atoms[atom.id] = atom
        logger.info("Registered atom %s (%s).", atom.id, atom.type)

    def record_failure(self, atom_id: str, error_message: str) -> None:
        """
        Record a synthesis failure for the given atom.

        Transitions the atom to FAILED status and logs the incident.
        """
        atom = self._get_atom(atom_id)
        atom.status = AtomStatus.FAILED
        atom.last_error = error_message
        atom.retry_count += 1

        entry = {
            "atom_id": atom_id,
            "error": error_message,
            "retry_count": atom.retry_count,
            "timestamp": time.time(),
        }
        self._failure_log.append(entry)
        logger.error("Failure recorded for atom %s: %s", atom_id, error_message)

    def can_restore(self, atom_id: str) -> bool:
        """Check if the atom is eligible for restoration."""
        try:
            atom = self._get_atom(atom_id)
        except RestorationError:
            return False
        return atom.retry_count < self.max_retries

    def restore(self, atom_id: str) -> Atom:
        """
        Restore a failed atom for re-synthesis.

        Applies delay based on retry count, transitions status to RESTORED,
        and notifies any registered restoration hooks.
        """
        atom = self._get_atom(atom_id)

        if atom.status != AtomStatus.FAILED:
            raise RestorationError(
                f"Cannot restore atom {atom_id}: expected status FAILED, got {atom.status.value}"
            )

        if atom.retry_count >= self.max_retries:
            raise RestorationError(
                f"Atom {atom_id} has exceeded maximum retries ({self.max_retries})."
            )

        delay = self._calculate_delay(atom.retry_count)
        if delay > 0:
            logger.info("Applying restoration delay of %.2fs for atom %s.", delay, atom_id)
            time.sleep(delay)

        atom.status = AtomStatus.RESTORED
        atom.last_error = None

        logger.info(
            "Atom %s restored successfully (attempt %d/%d).",
            atom_id,
            atom.retry_count,
            self.max_retries,
        )

        for hook in self._restoration_hooks:
            try:
                hook(atom)
            except Exception as e:
                logger.exception("Restoration hook failed for atom %s: %s", atom_id, e)

        return atom

    def restore_all(self) -> List[Atom]:
        """Attempt to restore all atoms currently in FAILED status."""
        failed_ids = [
            atom_id
            for atom_id, atom in self._atoms.items()
            if atom.status == AtomStatus.FAILED
        ]
        restored: List[Atom] = []
        for atom_id in failed_ids:
            try:
                restored.append(self.restore(atom_id))
            except RestorationError as e:
                logger.error("Failed to restore atom %s: %s", atom_id, e)
        return restored

    def on_restored(self, hook: Callable[[Atom], None]) -> None:
        """Register a callback to be invoked when an atom is restored."""
        self._restoration_hooks.append(hook)

    def get_failure_report(self) -> List[Dict]:
        """Return a copy of the failure log for analysis."""
        return list(self._failure_log)

    def _get_atom(self, atom_id: str) -> Atom:
        if atom_id not in self._atoms:
            raise RestorationError(f"Atom {atom_id} is not registered.")
        return self._atoms[atom_id]

    def _calculate_delay(self, retry_count: int) -> float:
        """Calculate exponential backoff delay."""
        return self.base_delay * (2 ** (retry_count - 1))


def create_default_restorer() -> AtomSynthesisRestorer:
    """Factory function to create a restorer with sensible defaults."""
    return AtomSynthesisRestorer(max_retries=3, base_delay=1.0)
