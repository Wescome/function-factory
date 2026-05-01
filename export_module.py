from enum import Enum
from typing import Any, Dict, List


class ExtractionConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


def export_data(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Export data including ExtractionConfidence typing information.
    """
    return {
        "version": "1.0",
        "schema": {
            "confidence": {
                "type": "ExtractionConfidence",
                "values": [e.value for e in ExtractionConfidence],
            }
        },
        "records": records,
    }


__all__ = ["ExtractionConfidence", "export_data"]
