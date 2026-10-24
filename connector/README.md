# TradePilot AI — read-only MetaTrader 5 connector

Runs on your Windows computer next to MetaTrader 5, reads your **demo** account
and market data through the official `MetaTrader5` Python package, and sends it
to TradePilot over HTTPS. It cannot place, change or close orders.

Step-by-step guide: [../docs/mt5-connector.md](../docs/mt5-connector.md).

```
powershell -ExecutionPolicy Bypass -File .\setup.ps1     # install / update
.\tradepilot-connector.cmd pair --api-url https://<your TradePilot> --code XXXX-XXXX-XXXX-XXXX-XXXX
.\tradepilot-connector.cmd start                           # Ctrl+C or `stop` to end
```

Developers: `python -m pip install -r requirements-dev.txt && python -m pytest -q tests`
(the tests replace MT5 with a test double and run on any OS).
