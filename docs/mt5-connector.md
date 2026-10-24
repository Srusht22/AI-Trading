# Connecting your MetaTrader 5 demo account (read-only)

This guide connects the MetaTrader 5 (MT5) terminal on **your Windows
computer** to TradePilot AI so the website can show your real demo balance,
equity, prices, price history, open positions and pending orders.

What it does **not** do: it cannot place, change, cancel or close orders, run
Expert Advisors, or turn on automated trading. It only reads.

> **Status of verification.** The connector has been tested end to end with an
> automated stand-in for MT5 (a "test fixture"), against the real TradePilot
> server code and database. It has **not yet been run against a real MT5
> terminal** — the first real check is the steps below on your computer.
> If anything differs from this guide, `check` and `logs` (§7) show why.

---

## 1. What you need

| | |
| --- | --- |
| Windows 10 or 11 (64-bit) | the computer where MT5 runs |
| MetaTrader 5 | from your broker or [metatrader5.com](https://www.metatrader5.com); logged into a **demo** account |
| Python **3.12 or 3.13, 64-bit** | [python.org/downloads/windows](https://www.python.org/downloads/windows/) — tick *Add python.exe to PATH* when installing |
| The `connector` folder of the TradePilot project | download the project (ZIP or `git clone`) onto that computer |
| TradePilot open in your browser | signed in as the workspace owner |

No administrator rights, open ports, port forwarding or background services
are needed. The connector only makes outgoing HTTPS requests to TradePilot.

**Where is TradePilot running?** The connector sends its key only over
HTTPS, or over plain HTTP to the same computer (`127.0.0.1`/`localhost`).
So either use a hosted TradePilot address that starts with `https://`, or,
for local testing, run TradePilot's development stack (`npm run build &&
npm run pages:dev`, address `http://127.0.0.1:8788`) on the same Windows
computer. A plain-`http` address of another computer is refused on purpose.

## 2. Prepare MT5 (in MetaTrader 5)

1. Open MetaTrader 5.
2. *File › Login to Trade Account* and log into your **demo** account. Your
   password stays inside MT5 — TradePilot never asks for it, and you should
   never type it into the website, a file, a command or an AI chat.
3. Check the bottom-right corner of MT5 shows a connection (not "No
   connection").
4. Optional: in *Market Watch*, show the symbols you want to follow. The
   connector can also add a symbol to Market Watch itself (this only makes
   MT5 deliver its prices; it changes no trading setting).

If your broker gives you an *investor* (read-only) password, logging MT5 in
with it is even safer: the connector only needs to read.

## 3. Install the connector (on the Windows computer)

Open PowerShell in the `connector` folder (in Explorer: open the folder,
then *File › Open Windows PowerShell*) and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

This:

* finds 64-bit Python 3.12/3.13;
* creates a private virtual environment in `connector\.venv`;
* installs the two pinned dependencies — MetaQuotes' official
  [`MetaTrader5`](https://pypi.org/project/MetaTrader5/) package 5.0.6231
  and `numpy` 2.5.3 — with `--require-hashes`, so pip refuses anything that
  is not the exact published file;
* runs the local check (§7).

**Updating later:** replace the `connector` folder with the new version and run
`setup.ps1` again. It re-uses the environment and installs what the new
`requirements.txt` pins. Your pairing is kept (it lives elsewhere, §8).

## 4. Pair the connector (website, then computer)

1. **Website:** *Connections & VPS › Connect MetaTrader 5 › Step 3 › Create
   pairing code*. Give the computer a name. A code like
   `D25E-9E4E-0A6F-23DB-833C` appears together with the exact command. It works
   **once** and expires after **10 minutes**.
2. **Computer** (PowerShell in the `connector` folder):

   ```powershell
   .\tradepilot-connector.cmd pair --api-url https://your-tradepilot-address --code D25E-9E4E-0A6F-23DB-833C
   ```

   The connector creates its own secret key, registers only a fingerprint of
   it with the code, and stores the key encrypted for your Windows user
   (Windows DPAPI). The key is never printed and never passes through the
   website. Step 3 on the website turns green.

   If MT5 is installed somewhere unusual, add
   `--terminal-path "C:\Path\To\MetaTrader 5\terminal64.exe"`.

## 5. Start it and confirm the demo account

```powershell
.\tradepilot-connector.cmd start
```

Leave this window open — the connector runs while it is open. Within a few
seconds the window shows lines like:

```
Attached to the running MetaTrader 5 terminal.
Demo account ****821 on YourBroker-Demo verified.
Publishing live data for ****821 (YourBroker-Demo).
Published 312 symbols offered by the broker.
```

In the website, **Step 4 › Verify the demo account** shows the broker server,
the account number with only its last three digits, the account currency, the
detected account type, the terminal build and the time of the last
verification. "Demo verified" appears **only** after the connector's
authenticated report says MT5 itself classifies the account as demo
(`ACCOUNT_TRADE_MODE_DEMO`). A server name containing "Demo" is not taken as
proof.

If the account is real or contest, the website shows **"Blocked: not a demo
account"** and no data from that account is sent or stored.

## 6. Confirm real data in the website

1. **Choose symbols** (Step 5): search the list your broker offers — names
   are exactly as the broker writes them (e.g. `EURUSD.r`, `EURUSDm`,
   `GER40`). Pick up to 8 and save. Prices start within about 10 seconds.
2. **First account snapshot:** *Dashboard › Demo account & market* shows
   balance, equity, floating profit/loss, margin, free margin and margin level
   in your account's currency, with "Updated … ago". Compare them with MT5's
   *Toolbox › Trade* tab — they are MT5's own values, not calculations.
3. **A real quote update:** the price table shows bid, ask, spread, the
   broker's tick time and a **Live** badge. When MT5 receives a new tick the
   website updates without reloading. If the market is quiet or closed the
   price stays put and is marked **Not current** after a minute — it never
   moves on its own.
4. **Price history:** the chart loads recent M1/M5/M15/H1 bars from MT5 (the
   connector reads them when you open the chart, up to 200 bars). The dot is
   the latest tick. *Refresh history* reads them again.
5. **Positions and orders:** *Demo Trading* lists open positions, pending
   orders and (on request) recent deals, as snapshots with their time.

**Broker time zone.** MT5 reports times in the broker's server time zone. The
connector works out the difference to UTC from live ticks (Step 6 shows e.g.
"UTC+3 (estimated)"). On a first start with a closed market it cannot, and the
website says so. You can set it yourself in
`%LOCALAPPDATA%\TradePilot\Connector\config.json`:
`"broker_utc_offset_minutes": 180` (for UTC+3), then restart the connector.

## 7. When something is wrong

Run the local check — it explains each problem in plain English and prints no
secrets:

```powershell
.\tradepilot-connector.cmd check
```

```
[ OK ] Python: 3.12.7 (64-bit)
[ OK ] Windows: Windows-11-10.0.22631-SP0
[ OK ] MetaTrader5 package: 5.0.6231
[ OK ] MetaTrader 5 terminal: attached
[ OK ] Terminal version: build 5200
[ OK ] Broker connection: connected
[ OK ] Account: Demo account ****821 on YourBroker-Demo verified.
[ OK ] TradePilot server: https://your-tradepilot-address
[ OK ] Pairing: agent … ; token stored in Windows DPAPI (current user)
```

Other useful commands:

```powershell
.\tradepilot-connector.cmd status        # address, agent, last known state (never the key)
.\tradepilot-connector.cmd logs -n 100   # recent log lines (secrets are redacted)
```

| What you see | What to do |
| --- | --- |
| *MetaTrader 5 is not running, or this connector cannot attach to it* | Open MT5. If it is installed in an unusual place, use `--terminal-path`. Run MT5 and the connector as the same Windows user. |
| *No account is logged in* | MT5 › *File › Login to Trade Account*. |
| *MT5 is open but not connected to the broker* | Check your internet connection and MT5's connection status. |
| *Connection blocked: this is a REAL-money account* | Log MT5 into a demo account. TradePilot will not connect to real accounts. |
| Website: *Blocked: different account* | MT5 switched to another account. Switch back, or in Step 4 choose *Use the newly logged-in demo account* (the previous account's stored data is deleted). |
| Website: *Connector unavailable* | The connector window is closed, the PC is asleep, or the internet is down. Start it again. |
| Website: *Authentication error* / log says it was revoked | The key was revoked. Run `reset`, then pair again with a new code. |
| *Pairing failed: the pairing code is invalid, expired or already used* | Create a new code (codes work once, for 10 minutes). |
| Symbol shows no price | The symbol may be disabled by your broker or the market closed. Check MT5's Market Watch. |
| *Refusing to send the connector token over plain HTTP* | Use the `https://` address, or run TradePilot locally on this computer. |

Problems recover by themselves when fixed: the connector retries with
increasing pauses (up to 1 minute), re-attaches to MT5, and **verifies the demo
account again** before sending anything.

## 8. Stopping, disconnecting, revoking, removing

| You want to… | Where | How |
| --- | --- | --- |
| Stop the program | computer | `Ctrl+C` in its window, or `.\tradepilot-connector.cmd stop` from another window. The website shows it offline within ~45 s. |
| Restart it | computer | `.\tradepilot-connector.cmd start` |
| Stop the website accepting data (keep pairing) | website | *Connections › Step 7 › Disconnect data feed*. The program may still be running — the website cannot stop a program on your PC. *Reconnect* re-verifies the account. |
| Permanently invalidate the connector's key | website | *Step 7 › Revoke connector* (or, on a trusted machine with the service-role key: `npm run agent:revoke -- <agent-id>`). |
| Remove its configuration from the PC | computer | `.\tradepilot-connector.cmd reset` — deletes the stored key and settings from `%LOCALAPPDATA%\TradePilot\Connector`. Revoke it in the website too. |

Only one connector can run per Windows user at a time (a second `start` says
so and exits).

## 9. Where things are stored

| Location | Contents |
| --- | --- |
| `%LOCALAPPDATA%\TradePilot\Connector\config.json` | TradePilot address, agent id/name, optional `terminal_path` and `broker_utc_offset_minutes` (not secret) |
| `%LOCALAPPDATA%\TradePilot\Connector\secrets.bin` | the connector key and an installation secret, encrypted with Windows DPAPI for your user |
| `%LOCALAPPDATA%\TradePilot\Connector\state.json` | last known status (not secret) |
| `%LOCALAPPDATA%\TradePilot\Connector\connector.log` | redacted log, rotated at 1 MB |
| TradePilot database | masked account (last 3 digits), broker server/company, currency, leverage, the account values, prices, bars and positions you see in the website — never your password, your full account number or your account holder name |

The full account number is replaced by a fingerprint computed on your PC
(HMAC with the installation secret). TradePilot can tell when the terminal
switches to a different account, but cannot work out the account number from
the fingerprint.

## 10. Resource use

Defaults (change them in *Step 6 › Update intervals*): prices checked every 2 s
and sent only when a new tick arrives; account every 10 s (sent when changed,
at least once a minute); equity history point every minute; heartbeat every
20 s. In a busy market this is up to ~68,000 small requests a day to the
TradePilot API, within the free Cloudflare allowance of 100,000; a 5 s price
interval roughly halves it. Nothing runs while your computer or MT5 is off —
the connector is not a 24/7 service.
