#!/usr/bin/env python3
"""Compatibility executable for the single hardened native backend."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().with_name("navish-browser-safe.py")), run_name="__main__")
