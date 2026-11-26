import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, CalendarDays, KeyRound, LayoutDashboard, LogOut, Menu, ScanLine, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { initials } from "../lib/api";
import Brand from "./Brand";
import ThemeToggle from "./ThemeToggle";

function NavItem({ to, icon: Icon, children, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === "/classes"}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
          isActive ? "bg-gold text-gold-ink shadow-gold" : "text-muted hover:bg-accent-soft hover:text-ink"
        }`
      }
    >
      <Icon size={18} /> {children}
    </NavLink>
  );
}

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const liveSessionView = location.pathname.startsWith("/sessions/");
  const classDetailsView = /^\/classes\/\d+$/.test(location.pathname);

  useEffect(() => setOpen(false), [location.pathname]);

  const doLogout = async () => {
    await logout();
    navigate("/");
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-6">
      <Brand compact />

      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-strong p-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">
          {initials(user.full_name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold capitalize">{user.full_name}</p>
          <span className="chip mt-1 bg-gold-soft capitalize text-gold-text">{user.role}</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1.5">
        <NavItem to="/dashboard" icon={LayoutDashboard}>
          Dashboard
        </NavItem>
        <NavItem to="/classes" icon={BookOpen}>
          Classes
        </NavItem>
        <NavItem to="/calendar" icon={CalendarDays}>
          Attendance calendar
        </NavItem>
        {user.role === "student" && (
          <>
            <NavItem to="/join" icon={KeyRound}>
              Join a class
            </NavItem>
            <NavItem to="/scan" icon={ScanLine}>
              Scan QR
            </NavItem>
          </>
        )}
      </nav>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-5">
        <button onClick={doLogout} className="btn btn-ghost flex-1">
          <LogOut size={16} /> Log out
        </button>
        <ThemeToggle />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-[290px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[290px] border-r border-line bg-surface backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 backdrop-blur-xl lg:hidden">
        <Brand compact />
        <button onClick={() => setOpen(true)} className="btn btn-ghost px-3" aria-label="Open menu">
          <Menu size={18} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade bg-bg/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[290px] animate-rise border-r border-line bg-bg">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 rounded-full p-2 text-muted hover:text-ink"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className={liveSessionView || classDetailsView
        ? "mx-auto w-full max-w-7xl px-6 py-6"
        : "mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12"}
      >
        {children}
      </main>
    </div>
  );
}
