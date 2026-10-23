import {
  Activity,
  BarChart3,
  Bot,
  FlaskConical,
  History,
  LayoutDashboard,
  type LucideIcon,
  PlugZap,
  Settings,
  Sparkles,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** One-line, plain-English purpose. Used for page subtitles and search. */
  description: string;
  keywords?: string[];
}

/** Primary navigation, in the order it appears in the sidebar. */
export const primaryNav: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: LayoutDashboard,
    description: 'An at-a-glance view of your research workspace.',
    keywords: ['home', 'overview'],
  },
  {
    id: 'robots',
    label: 'My Robots',
    path: '/robots',
    icon: Bot,
    description: 'Your library of existing and custom trading robots (Expert Advisors).',
    keywords: ['expert advisor', 'ea', 'library', 'import'],
  },
  {
    id: 'strategy-lab',
    label: 'Strategy Lab',
    path: '/strategy-lab',
    icon: FlaskConical,
    description: 'Turn a trading idea into a written plan, then into robot code.',
    keywords: ['create', 'build', 'mql5', 'code', 'idea'],
  },
  {
    id: 'backtesting',
    label: 'Backtesting',
    path: '/backtesting',
    icon: History,
    description: 'See how a robot would have behaved on historical prices.',
    keywords: ['test', 'history', 'strategy tester', 'report'],
  },
  {
    id: 'demo-trading',
    label: 'Demo Trading',
    path: '/demo-trading',
    icon: Activity,
    description: 'Watch robots trade on a simulated broker account with virtual money.',
    keywords: ['positions', 'orders', 'simulated', 'paper'],
  },
  {
    id: 'analytics',
    label: 'Analytics & Risk',
    path: '/analytics',
    icon: BarChart3,
    description: 'Judge performance by its risks, not just its profit.',
    keywords: ['drawdown', 'win rate', 'profit factor', 'compare'],
  },
  {
    id: 'ai-analyst',
    label: 'AI Analyst',
    path: '/ai-analyst',
    icon: Sparkles,
    description: 'Ask questions about your results in plain English.',
    keywords: ['chat', 'assistant', 'explain'],
  },
  {
    id: 'connections',
    label: 'Connections & VPS',
    path: '/connections',
    icon: PlugZap,
    description: 'Link the website to MetaTrader 5 through a Windows connector.',
    keywords: ['mt5', 'metatrader', 'vps', 'connector', 'terminal'],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    description: 'Preferences for appearance, display, notifications and more.',
    keywords: ['preferences', 'theme', 'appearance'],
  },
];

export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === '/') return primaryNav[0];
  return primaryNav.find((item) => item.path !== '/' && pathname.startsWith(item.path));
}
