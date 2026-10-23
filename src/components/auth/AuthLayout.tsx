import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { FlaskConical, Scale, ShieldCheck, UserCheck } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { TooltipProvider } from '@/components/ui';
import { pageVariants } from '@/lib/motion';

const principles = [
  { icon: ShieldCheck, title: 'Demo money only', text: 'Built for simulated trading and research.' },
  { icon: UserCheck, title: 'You approve changes', text: 'No new or modified robot runs without you.' },
  { icon: Scale, title: 'Risk before profit', text: 'Every result shows drawdown and assumptions.' },
];

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  useEffect(() => {
    document.title = `${title} · TradePilot AI`;
  }, [title]);

  return (
    <TooltipProvider>
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <aside className="bg-panel border-line-soft relative hidden overflow-hidden border-r lg:flex lg:flex-col lg:justify-between lg:p-12">
          <div aria-hidden className="grid-texture pointer-events-none absolute inset-0 opacity-80" />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-24 size-[28rem] rounded-full opacity-60 blur-3xl"
            style={{ background: 'radial-gradient(circle, var(--tp-accent-soft), transparent 70%)' }}
          />
          <Link to="/" className="relative flex items-center gap-2.5 self-start rounded-md">
            <LogoMark size={34} />
            <Wordmark className="text-base" />
          </Link>
          <div className="relative max-w-md">
            <p className="eyebrow">Personal research workspace</p>
            <h2 className="text-fg mt-3 text-3xl font-semibold tracking-[-0.02em]">
              Research, test and understand Forex robots — <span className="brand-text">with discipline.</span>
            </h2>
            <ul className="mt-10 space-y-5">
              {principles.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <span className="bg-accent-soft text-accent flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <p.icon className="size-4" aria-hidden />
                  </span>
                  <span>
                    <span className="text-fg block text-sm font-medium">{p.title}</span>
                    <span className="text-fg-3 block text-sm">{p.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-fg-3 relative flex items-center gap-2 text-xs">
            <FlaskConical className="text-warning size-3.5" aria-hidden /> Demo environment · no real-money trading
          </p>
        </aside>

        <main className="relative flex flex-col px-4 py-6 sm:px-8">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5 rounded-md lg:invisible">
              <LogoMark size={30} />
              <Wordmark />
            </Link>
            <ThemeToggle />
          </div>
          <div className="flex flex-1 items-center justify-center py-10">
            <motion.div variants={pageVariants} initial="initial" animate="animate" className="w-full max-w-[25rem]">
              <h1 className="text-fg text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
              {description && <div className="text-fg-2 mt-2 text-base leading-relaxed">{description}</div>}
              <div className="mt-8">{children}</div>
              {footer && <div className="text-fg-2 border-line-soft mt-8 border-t pt-6 text-sm">{footer}</div>}
            </motion.div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
