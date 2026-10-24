"""The connector must not be able to trade. Two independent guards:
1. a static scan of the source for trading calls;
2. the runtime allow-list wrapper refuses anything but read functions."""
import ast
import re
from pathlib import Path

import pytest

from tradepilot_connector.terminal import ALLOWED_MT5_FUNCTIONS, ForbiddenOperation, ReadOnlyMt5

PACKAGE = Path(__file__).resolve().parents[1] / "tradepilot_connector"
FORBIDDEN = {"order_send", "order_check", "order_calc_margin", "order_calc_profit", "login", "Buy", "Sell", "Close",
             "_RawOrder", "market_book_add", "TRADE_ACTION_DEAL", "TRADE_ACTION_PENDING", "TRADE_ACTION_SLTP",
             "TRADE_ACTION_MODIFY", "TRADE_ACTION_REMOVE", "TRADE_ACTION_CLOSE_BY"}


def source_files():
    return sorted(PACKAGE.glob("*.py"))


def test_source_contains_no_trading_calls():
    for path in source_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # Docstrings may *describe* what is forbidden; only code and string data are checked.
        docstrings = {
            id(n.body[0].value)
            for n in ast.walk(tree)
            if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef))
            and n.body and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)
        }
        for node in ast.walk(tree):
            name = node.attr if isinstance(node, ast.Attribute) else node.id if isinstance(node, ast.Name) else None
            assert name not in FORBIDDEN, f"{path.name} references {name}"
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                assert not re.search(r"\b(order_send|order_check|TRADE_ACTION_)", node.value), f"{path.name}: {node.value!r}"


def test_metatrader5_is_only_imported_through_the_wrapper():
    for path in source_files():
        text = path.read_text(encoding="utf-8")
        imports = re.findall(r"^\s*(?:import|from)\s+MetaTrader5\b.*$", text, flags=re.M)
        if path.name == "terminal.py":
            assert len(imports) == 1
        elif path.name == "cli.py":
            assert all("noqa" in line for line in imports)  # `check` only reads __version__
        else:
            assert imports == [], f"{path.name} imports MetaTrader5 directly"


def test_allow_list_is_read_only():
    assert not (ALLOWED_MT5_FUNCTIONS & FORBIDDEN)


class FakeModule:
    TIMEFRAME_M1 = 1
    ACCOUNT_TRADE_MODE_DEMO = 0

    def order_send(self, *a):  # pragma: no cover - must never be reached
        raise AssertionError("order_send reached")

    def Buy(self, *a):  # noqa: N802 # pragma: no cover
        raise AssertionError("Buy reached")

    def account_info(self):
        return None


@pytest.mark.parametrize("name", ["order_send", "order_check", "Buy", "Sell", "Close", "login", "_RawOrder", "market_book_add"])
def test_wrapper_refuses_trading_functions(name):
    with pytest.raises(ForbiddenOperation):
        getattr(ReadOnlyMt5(FakeModule()), name)


def test_wrapper_allows_reads_and_constants():
    w = ReadOnlyMt5(FakeModule())
    assert w.account_info() is None
    assert w.TIMEFRAME_M1 == 1
