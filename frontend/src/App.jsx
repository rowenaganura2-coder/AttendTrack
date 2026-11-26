import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./components/Toast";
import AppShell from "./components/AppShell";
import { Spinner } from "./components/ui";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import ClassesPage from "./pages/ClassesPage";
import ClassPage from "./pages/ClassPage";
import SessionView from "./pages/SessionView";
import CalendarPage from "./pages/CalendarPage";
import JoinPage from "./pages/JoinPage";
import ScanPage from "./pages/ScanPage";

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/?next=${next}`} replace />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function InstructorOnly({ children }) {
  const { user } = useAuth();
  return user?.role === "instructor" ? children : <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route element={<Protected />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/classes" element={<ClassesPage />} />
              <Route path="/classes/:id" element={<ClassPage />} />
              <Route
                path="/sessions/:id"
                element={
                  <InstructorOnly>
                    <SessionView />
                  </InstructorOnly>
                }
              />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/join" element={<JoinPage />} />
              <Route path="/scan" element={<ScanPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
