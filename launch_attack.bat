@echo off
REM ── SentinelAI Attack Launcher ──
REM This batch file is the attack entry point.
REM It runs as its own process tree, SEPARATE from any IDE or chat tool.
REM The agent sees this as an independent process = correct attribution.

cd /d "%~dp0..\simulator"
python simulate.py --profile fast --run-id %1
