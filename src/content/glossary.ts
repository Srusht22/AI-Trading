/**
 * Plain-English definitions for specialist terms. Each entry answers one
 * question in beginner-friendly language and is surfaced next to the term
 * via <Term> and in global search.
 */
export interface GlossaryEntry {
  term: string;
  short?: string;
  definition: string;
  /** Optional second sentence for readers who want more detail. */
  more?: string;
}

export const glossary = {
  ea: {
    term: 'Expert Advisor (EA)',
    short: 'EA',
    definition: 'A program that follows trading rules automatically inside MetaTrader.',
    more: 'TradePilot calls these “robots”. An EA can open, manage and close trades without you clicking anything.',
  },
  mt5: {
    term: 'MetaTrader 5 (MT5)',
    short: 'MT5',
    definition: 'A popular trading platform from MetaQuotes. It runs Expert Advisors and has a built-in Strategy Tester.',
  },
  mql5: {
    term: 'MQL5',
    definition: 'The programming language used to write Expert Advisors for MetaTrader 5.',
  },
  backtest: {
    term: 'Backtest',
    definition: 'A simulation that replays historical prices to show how a robot would have traded in the past.',
    more: 'Good past results do not guarantee future results. A backtest is evidence, not a promise.',
  },
  forwardTest: {
    term: 'Forward test',
    definition:
      'Testing a strategy on a later period of market data that was not used to develop or optimise it.',
    more: 'It checks whether results hold up on data the strategy has never “seen”.',
  },
  drawdown: {
    term: 'Maximum drawdown',
    short: 'Max DD',
    definition: 'The largest fall in account value from a previous peak during the measured period.',
    more: 'A 20% maximum drawdown means that at its worst, the account was 20% below its highest point so far.',
  },
  profitFactor: {
    term: 'Profit factor',
    definition: 'Total money won divided by total money lost. Above 1.0 means winners outweighed losers.',
    more: 'A profit factor of 1.5 means every $1 lost was matched by $1.50 won, before considering risk.',
  },
  winRate: {
    term: 'Win rate',
    definition: 'The percentage of trades that closed in profit.',
    more: 'A high win rate can still lose money if the losing trades are much larger than the winners.',
  },
  equity: {
    term: 'Equity',
    definition: 'Your balance plus or minus the profit or loss of trades that are still open.',
  },
  balance: {
    term: 'Balance',
    definition: 'The money in the account from closed trades only. Open trades do not change it until they close.',
  },
  equityCurve: {
    term: 'Equity curve',
    definition: 'A line chart of account value over time. Smooth, steady curves usually indicate more consistent strategies.',
  },
  netProfit: {
    term: 'Net profit',
    definition: 'Total profit after all losing trades and trading costs have been subtracted.',
  },
  stopLoss: {
    term: 'Stop-loss',
    definition: 'An instruction that closes a trade automatically if the price moves a set distance against you.',
  },
  lotSize: {
    term: 'Lot size',
    definition: 'How large a trade is. One standard lot is 100,000 units of the base currency.',
  },
  positionSizing: {
    term: 'Position sizing',
    definition: 'The rule that decides how large each trade should be, often based on how much you are willing to risk.',
  },
  timeframe: {
    term: 'Timeframe',
    definition: 'How much time each price bar (candle) on the chart represents, for example 1 hour (H1).',
  },
  symbol: {
    term: 'Symbol',
    definition: 'The market being traded, such as EURUSD (euro against US dollar).',
  },
  testModel: {
    term: 'Test model',
    definition: 'How precisely the Strategy Tester reconstructs price movement inside each bar.',
    more: '“Every tick based on real ticks” is the most realistic and the slowest. “Open prices only” is fastest but rough.',
  },
  spread: {
    term: 'Spread',
    definition: 'The difference between the buy and sell price. It is a cost paid on every trade.',
  },
  tradingCosts: {
    term: 'Trading costs',
    definition: 'Spread, commission and swap (overnight interest) combined. These quietly reduce profit.',
  },
  exposure: {
    term: 'Exposure',
    definition: 'How much of your account is at risk in open trades at once, and in which currencies.',
  },
  losingStreak: {
    term: 'Losing streak',
    definition: 'The largest number of losing trades in a row. It shows how much patience a strategy demands.',
  },
  avgWinLoss: {
    term: 'Average win / average loss',
    definition: 'The typical size of a winning trade compared with a typical losing trade.',
  },
  connector: {
    term: 'Windows connector',
    definition: 'A small program running on Windows beside MT5. It reads your demo account and prices from MT5 and sends them to this website over HTTPS.',
    more: 'In this version it is read-only: it cannot place, change or close trades. Your MT5 password never leaves MT5.',
  },
  vps: {
    term: 'VPS',
    definition: 'A Virtual Private Server: a Windows computer rented in a data centre that can run MT5 24 hours a day.',
  },
  heartbeat: {
    term: 'Heartbeat',
    definition: 'A small “I’m still here” signal the connector sends regularly so the website knows the link is healthy.',
  },
  demoAccount: {
    term: 'Demo account',
    definition: 'A broker account that uses virtual money. Trades are simulated and no real money is at risk.',
  },
  strategyCandidate: {
    term: 'Strategy candidate',
    definition: 'A strategy idea that is being researched and tested, but has not been approved for use.',
  },
  optimisation: {
    term: 'Optimisation',
    definition: 'Automatically trying many parameter combinations to find the best-performing settings on past data.',
    more: 'Over-optimised strategies often fit the past perfectly and fail on new data. This is called curve-fitting.',
  },
  pendingOrder: {
    term: 'Pending order',
    definition: 'An order waiting to be triggered when price reaches a level you chose in advance.',
  },
  margin: {
    term: 'Margin',
    definition: 'The part of your account the broker sets aside as a deposit while trades are open.',
    more: 'Free margin is what is left for new trades. Margin level is equity divided by used margin, as a percentage; brokers close trades if it falls too low.',
  },
  bidAsk: {
    term: 'Bid and ask',
    definition: 'Bid is the price you can sell at, ask the price you can buy at. The difference is the spread.',
  },
  tick: {
    term: 'Tick',
    definition: 'A single price update from the broker. Quiet or closed markets produce few or no ticks, so a price can be minutes or days old.',
  },
  position: {
    term: 'Position',
    definition: 'A trade that is currently open in the account. Its profit or loss changes with the price until it is closed.',
  },
  deal: {
    term: 'Deal',
    definition: 'A completed transaction in the account history: a trade opening or closing, or a balance operation such as a deposit.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof glossary;
