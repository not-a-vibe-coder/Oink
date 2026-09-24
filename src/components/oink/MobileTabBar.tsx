import { Link, useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { NavItem } from "@/components/oink/AppShell";

/**
 * The phone nav: a solid pill floating above the home indicator, Safari-style.
 *
 * Four sections ride in the pill; the rest wait behind the plus. Tapping it grows the pill
 * upward into a tray, and only then does it turn to glass — collapsed, it is an opaque
 * object you can find with your thumb without reading through it. A glass lens marks the
 * open section and slides between slots with a slight overshoot; when the open section
 * lives in the tray, the lens rests on the plus.
 */
export function MobileTabBar({ primary, more }: { primary: NavItem[]; more: NavItem[] }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);

  const isActive = (item: NavItem) => (item.exact ? pathname === item.to : pathname.startsWith(item.to));

  // Slots: primary[0], primary[1], plus, primary[2], primary[3].
  const slots = [primary[0], primary[1], null, primary[2], primary[3]];
  const activeSlot = slots.findIndex((item) => item !== null && isActive(item));
  const lensSlot = activeSlot >= 0 ? activeSlot : more.some(isActive) ? 2 : -1;

  // Navigating anywhere folds the tray back down.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="tabbar-scrim" data-open={open} aria-hidden="true" onClick={() => setOpen(false)} />
      <nav className="tabbar" data-open={open} aria-label="Wallet sections">
        <div className="tabbar-tray" id="tabbar-more" inert={!open}>
          <div className="tabbar-tray-inner">
            {more.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="tabbar-more-item"
                data-active={isActive(item)}
                aria-current={isActive(item) ? "page" : undefined}
              >
                <span className="dock-icon">
                  <img src={item.icon} alt="" className="dock-still" draggable={false} />
                  {item.animated && (
                    <img src={item.animated} alt="" className="dock-animated" draggable={false} />
                  )}
                </span>
                <span className="tabbar-more-label">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="tabbar-row" style={{ "--lens-slot": lensSlot } as CSSProperties}>
          {lensSlot >= 0 && <span className="glass-lens tabbar-lens" aria-hidden="true" />}
          {slots.map((item, index) =>
            item === null ? (
              <button
                key="more"
                type="button"
                className="tabbar-item tabbar-plus"
                aria-label={open ? "Fewer sections" : "More sections"}
                aria-expanded={open}
                aria-controls="tabbar-more"
                data-active={lensSlot === 2}
                onClick={() => setOpen((value) => !value)}
              >
                <Plus size={26} strokeWidth={1.6} aria-hidden="true" />
              </button>
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className="tabbar-item"
                data-active={lensSlot === index}
                aria-current={lensSlot === index ? "page" : undefined}
                aria-label={item.label}
              >
                <span className="dock-icon" data-flip={item.flip || undefined}>
                  <img src={item.icon} alt="" draggable={false} />
                </span>
              </Link>
            ),
          )}
        </div>
      </nav>
    </>
  );
}
