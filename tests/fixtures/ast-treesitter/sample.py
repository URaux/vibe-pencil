import os
import sys
from pathlib import Path
from typing import List, Optional

GREETING = "hello"
_private = 42

def greet(name: str) -> str:
    return f"{GREETING}, {name}"

async def fetch_config(path: str) -> Optional[str]:
    return None

class Logger:
    def __init__(self):
        self.entries: List[str] = []

    def log(self, msg: str) -> None:
        self.entries.append(msg)

class _Hidden:
    pass
