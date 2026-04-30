"""Test governor agent initialization."""

import pytest

from governor_agent import GovernorAgent


def test_governor_agent_initialization():
    """Verify the Governor Agent is successfully initialized after synthesis."""
    agent = GovernorAgent()
    assert agent is not None
    assert isinstance(agent, GovernorAgent)
